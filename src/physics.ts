import { contactPoint, sat, type OBB } from './collision';
import type { Surfaces } from './floors';
import { DEFAULT_FLOOR, type LayeredOBB } from './layout';
import {
  BRAKE,
  COLLISION_YAW_TIME,
  CONTACT_MEMORY,
  HANDBRAKE,
  MAX_COLLISION_YAW,
  RESTITUTION,
  RESTITUTION_FULL,
  RESTITUTION_MIN,
  SCRAPE_FRICTION,
  ROLL_DRAG,
  SLOPE_GRAVITY,
  STEER_RETURN,
  STEP,
  WALL_FRICTION,
} from './config';
import { vehicleOf, type VehicleDef } from './vehicles';

/** Below this tilt (rad) the car counts as being on the flat. */
const FLAT_PITCH = 0.01;

export interface Controls {
  throttle: number; // -1..1 (negative = brake / reverse)
  steer: number; // -1..1 (positive = right)
  handbrake: boolean;
}

function towardZero(v: number, amount: number): number {
  if (v > 0) return Math.max(0, v - amount);
  return Math.min(0, v + amount);
}

/** Kinematic bicycle model: the car pivots around its rear axle. */
export class CarPhysics {
  x = 0;
  z = 0;
  heading = 0;
  v = 0;
  steer = 0;
  braking = false;
  /** Height of the car's centre above the ground plane (m). */
  y = 0;
  /** Nose-up tilt (rad), from the surface under the front and rear axles. */
  pitch = 0;
  /** Floor or ramp the car is on; only obstacles on it (or level with it) can be hit. */
  layer = DEFAULT_FLOOR;
  /** Radius of gyration squared of the body (I / m for a uniform box). */
  private readonly gyration2: number;
  /** resolveCollisions call count, and the call each obstacle was last touched. */
  private calls = 0;
  private lastContact = new WeakMap<OBB, number>();

  constructor(readonly vehicle: VehicleDef = vehicleOf()) {
    this.gyration2 = (vehicle.width ** 2 + vehicle.length ** 2) / 12;
    this.box = { x: 0, z: 0, hw: vehicle.width / 2, hl: vehicle.length / 2, rot: 0 };
  }

  reset(x: number, z: number, heading: number, surfaces?: Surfaces): void {
    this.layer = surfaces?.startLayer ?? DEFAULT_FLOOR;
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.v = 0;
    this.steer = 0;
    this.braking = false;
    this.lastContact = new WeakMap();
    this.pitch = 0;
    this.y = 0;
    this.settle(surfaces);
  }

  /** Scratch box reused by resolveCollisions so each read does not allocate. */
  private readonly box: OBB;

  get obb(): OBB {
    return { x: this.x, z: this.z, hw: this.vehicle.width / 2, hl: this.vehicle.length / 2, rot: this.heading };
  }

  /** The car's current box in a shared object: use immediately, never keep it. */
  private currentBox(): OBB {
    const b = this.box;
    b.x = this.x;
    b.z = this.z;
    b.rot = this.heading;
    return b;
  }

  step(dt: number, c: Controls, surfaces?: Surfaces): void {
    const veh = this.vehicle;
    // Steering: less lock at speed, smooth towards the target.
    const speedFactor = 1 - Math.min(Math.abs(this.v) / veh.maxFwd, 1) * 0.35;
    const target = c.steer * veh.maxSteer * speedFactor;
    const rate = c.steer === 0 ? STEER_RETURN : veh.steerRate;
    const ds = target - this.steer;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, ds));

    // Longitudinal.
    this.braking = false;
    if (c.throttle > 0) {
      if (this.v < -0.05) {
        this.v = towardZero(this.v, BRAKE * dt);
        this.braking = true;
      } else this.v += veh.accel * c.throttle * dt;
    } else if (c.throttle < 0) {
      if (this.v > 0.05) {
        this.v = towardZero(this.v, BRAKE * dt);
        this.braking = true;
      } else this.v += veh.revAccel * c.throttle * dt;
    } else {
      // Coasting drag only holds the car on the flat; on a slope gravity wins.
      if (Math.abs(this.pitch) < FLAT_PITCH) this.v = towardZero(this.v, ROLL_DRAG * dt);
    }
    if (c.handbrake) {
      this.v = towardZero(this.v, HANDBRAKE * dt);
      this.braking = true;
    } else this.v -= SLOPE_GRAVITY * Math.sin(this.pitch) * dt; // uphill (pitch > 0) slows the car
    this.v = Math.max(-veh.maxRev, Math.min(veh.maxFwd, this.v));

    // Integrate around the rear axle.
    const half = this.vehicle.wheelbase / 2;
    let rx = this.x - Math.sin(this.heading) * half;
    let rz = this.z - Math.cos(this.heading) * half;
    rx += Math.sin(this.heading) * this.v * dt;
    rz += Math.cos(this.heading) * this.v * dt;
    // Positive steer turns right, which is decreasing heading.
    this.heading -= (this.v / this.vehicle.wheelbase) * Math.tan(this.steer) * dt;
    this.x = rx + Math.sin(this.heading) * half;
    this.z = rz + Math.cos(this.heading) * half;
    // The rear axle crossing a ramp's end line changes the layer.
    if (surfaces) this.layer = surfaces.layerAfter(this.layer, rx, rz);
    this.settle(surfaces);
  }

  /** Height and pitch from the surface under the axles. */
  private settle(surfaces?: Surfaces): void {
    if (!surfaces) return;
    const half = this.vehicle.wheelbase / 2;
    const fx = Math.sin(this.heading) * half;
    const fz = Math.cos(this.heading) * half;
    const yFront = surfaces.heightAt(this.layer, this.x + fx, this.z + fz);
    const yRear = surfaces.heightAt(this.layer, this.x - fx, this.z - fz);
    this.y = (yFront + yRear) / 2;
    this.pitch = Math.atan2(yFront - yRear, this.vehicle.wheelbase);
  }

  /** The obstacles this car can touch right now. */
  reachable(surfaces: Surfaces, obstacles: LayeredOBB[]): LayeredOBB[] {
    return surfaces.reachable(this.layer, this.x, this.z, obstacles);
  }

  /** Yaw rate of the kinematic model (rad/s, heading convention). */
  get yawRate(): number {
    return -(this.v / this.vehicle.wheelbase) * Math.tan(this.steer);
  }

  /**
   * Push the car out of any overlapping obstacle and respond to the contact.
   *
   * The velocity of the contact point is split along the contact normal n.
   * Only an approaching normal component is removed (and partly reflected on
   * hard hits); Coulomb friction trims the tangential part, so the car slides
   * along walls. The resulting centre velocity is projected back onto the
   * heading to get the new scalar speed. The normal impulse acting at the
   * contact's lever arm turns the car a little (clamped), so corner hits
   * glance off instead of jittering and flush contacts produce no torque.
   *
   * Returns the highest normal approach speed of a contact point (m/s), so
   * head-on hits report the full speed and shallow scrapes only a fraction.
   * Only new contacts count: an obstacle touched within the last
   * CONTACT_MEMORY calls is a sustained scrape or push, whose approach speed
   * is just the kinematic model re-driving into it each step.
   *
   * Pass `surfaces` on multi-floor levels so y and pitch follow the push-out.
   */
  resolveCollisions(obstacles: OBB[], surfaces?: Surfaces): number {
    let impact = 0;
    let yaw = 0;
    const call = ++this.calls;
    const freshNow = new Map<OBB, boolean>();
    for (let iter = 0; iter < 4; iter++) {
      let touched = false;
      for (const o of obstacles) {
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        // Prefer pushing the car back against its motion when ambiguous.
        const dir = this.v >= 0 ? 1 : -1;
        let c = sat(this.currentBox(), o, -fx * dir, -fz * dir);
        if (!c) continue;
        touched = true;
        let fresh = freshNow.get(o);
        if (fresh === undefined) {
          const last = this.lastContact.get(o);
          fresh = last === undefined || call - last > CONTACT_MEMORY;
          freshNow.set(o, fresh);
          this.lastContact.set(o, call);
        }

        // Contact point velocity: rear-axle velocity plus yaw about the rear
        // axle. perp(r) = d(point)/d(heading) for an offset r.
        const [px, pz] = contactPoint(this.currentBox(), o, c);
        const half = this.vehicle.wheelbase / 2;
        const ax = px - (this.x - fx * half);
        const az = pz - (this.z - fz * half);
        const w = this.yawRate;
        const vpx = fx * this.v + w * az;
        const vpz = fz * this.v - w * ax;
        const vn = vpx * c.nx + vpz * c.nz;

        if (vn < 0) {
          if (fresh) impact = Math.max(impact, -vn);
          const s = -vn;
          // Hard new hits bounce; gentle or sustained contacts just stop.
          const ramp = Math.min(1, Math.max(0, (s - RESTITUTION_MIN) / (RESTITUTION_FULL - RESTITUTION_MIN)));
          const j = (1 + (fresh ? RESTITUTION * ramp : 0)) * s;
          // Friction opposes the contact point's tangential slip. A sustained
          // contact's normal speed is regenerated every step by the no-slip
          // model, so it gets a much lower coefficient or scraping would brake
          // the car like a wall of glue.
          const mu = fresh ? WALL_FRICTION : SCRAPE_FRICTION;
          const tx = vpx - vn * c.nx;
          const tz = vpz - vn * c.nz;
          const tl = Math.hypot(tx, tz);
          const jt = tl > 1e-9 ? Math.min(mu * j, tl) / tl : 0;
          const Vx = fx * this.v + j * c.nx - jt * tx;
          const Vz = fz * this.v + j * c.nz - jt * tz;
          this.v = Vx * fx + Vz * fz;

          // Turn by the impulse's moment arm about the centre: arm/(k^2+arm^2)
          // is a rigid body's yaw response per unit impulse, applied over
          // COLLISION_YAW_TIME. The rotation pivots about the contact point,
          // so the contact stays closed instead of the nose being flicked off
          // the wall (which would rattle), and flush contacts (arm 0) never
          // turn. The yaw is clamped per call so nothing ever spins.
          const rx = px - this.x;
          const rz = pz - this.z;
          const arm = c.nx * rz - c.nz * rx;
          const want = (COLLISION_YAW_TIME * j * arm) / (this.gyration2 + arm * arm);
          // Never turn the heading past parallel to the surface: if the car is
          // driving into it, stop at tangency; if only the steering swings a
          // corner in, undo at most one step of that swing.
          let lim = want > 0 ? MAX_COLLISION_YAW - yaw : MAX_COLLISION_YAW + yaw;
          const base = dir * (fx * c.nx + fz * c.nz);
          const away = Math.sign(want) * dir * (fz * c.nx - fx * c.nz);
          if (away > 0) lim = Math.min(lim, base < 0 ? Math.asin(Math.min(1, -base)) : Math.abs(w) * STEP);
          const dh = Math.sign(want) * Math.max(0, Math.min(Math.abs(want), lim));
          if (dh !== 0) {
            yaw += dh;
            this.heading += dh;
            const cs = Math.cos(dh);
            const sn = Math.sin(dh);
            this.x = px - (rx * cs + rz * sn);
            this.z = pz - (-rx * sn + rz * cs);
            const after = sat(this.currentBox(), o, -fx * dir, -fz * dir);
            if (!after) continue;
            c = after;
          }
        }
        this.x += c.nx * c.depth;
        this.z += c.nz * c.depth;
      }
      if (!touched) break;
    }
    // Rotation may have nudged the car into a neighbour: settle positions only.
    const hx = -Math.sin(this.heading) * (this.v >= 0 ? 1 : -1);
    const hz = -Math.cos(this.heading) * (this.v >= 0 ? 1 : -1);
    for (let iter = 0; iter < 4; iter++) {
      let touched = false;
      for (const o of obstacles) {
        const c = sat(this.currentBox(), o, hx, hz);
        if (!c) continue;
        touched = true;
        this.x += c.nx * c.depth;
        this.z += c.nz * c.depth;
      }
      if (!touched) break;
    }
    // The push-out moved the car, so the height and pitch under the axles changed too.
    this.settle(surfaces);
    return impact;
  }
}
