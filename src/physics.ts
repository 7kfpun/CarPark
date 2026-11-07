import { sat, type OBB } from './collision';
import {
  ACCEL,
  BRAKE,
  CAR_L,
  CAR_W,
  HANDBRAKE,
  MAX_FWD,
  MAX_REV,
  MAX_STEER,
  REV_ACCEL,
  ROLL_DRAG,
  STEER_RATE,
  STEER_RETURN,
  WHEELBASE,
} from './config';

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

  reset(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.v = 0;
    this.steer = 0;
    this.braking = false;
  }

  get obb(): OBB {
    return { x: this.x, z: this.z, hw: CAR_W / 2, hl: CAR_L / 2, rot: this.heading };
  }

  step(dt: number, c: Controls): void {
    // Steering: less lock at speed, smooth towards the target.
    const speedFactor = 1 - Math.min(Math.abs(this.v) / MAX_FWD, 1) * 0.35;
    const target = c.steer * MAX_STEER * speedFactor;
    const rate = c.steer === 0 ? STEER_RETURN : STEER_RATE;
    const ds = target - this.steer;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, ds));

    // Longitudinal.
    this.braking = false;
    if (c.throttle > 0) {
      if (this.v < -0.05) {
        this.v = towardZero(this.v, BRAKE * dt);
        this.braking = true;
      } else this.v += ACCEL * c.throttle * dt;
    } else if (c.throttle < 0) {
      if (this.v > 0.05) {
        this.v = towardZero(this.v, BRAKE * dt);
        this.braking = true;
      } else this.v += REV_ACCEL * c.throttle * dt;
    } else {
      this.v = towardZero(this.v, ROLL_DRAG * dt);
    }
    if (c.handbrake) {
      this.v = towardZero(this.v, HANDBRAKE * dt);
      this.braking = true;
    }
    this.v = Math.max(-MAX_REV, Math.min(MAX_FWD, this.v));

    // Integrate around the rear axle.
    const half = WHEELBASE / 2;
    let rx = this.x - Math.sin(this.heading) * half;
    let rz = this.z - Math.cos(this.heading) * half;
    rx += Math.sin(this.heading) * this.v * dt;
    rz += Math.cos(this.heading) * this.v * dt;
    // Positive steer turns right, which is decreasing heading.
    this.heading -= (this.v / WHEELBASE) * Math.tan(this.steer) * dt;
    this.x = rx + Math.sin(this.heading) * half;
    this.z = rz + Math.cos(this.heading) * half;
  }

  /**
   * Push the car out of any overlapping obstacle and bounce it back.
   * Returns the highest speed at which the car was driving into something
   * (0 if it merely touched or nothing was hit).
   */
  resolveCollisions(obstacles: OBB[]): number {
    let impact = 0;
    for (let iter = 0; iter < 3; iter++) {
      let touched = false;
      for (const o of obstacles) {
        const c = sat(this.obb, o);
        if (!c) continue;
        touched = true;
        this.x += c.nx * c.depth;
        this.z += c.nz * c.depth;
        const fx = Math.sin(this.heading) * this.v;
        const fz = Math.cos(this.heading) * this.v;
        if (fx * c.nx + fz * c.nz < 0) {
          impact = Math.max(impact, Math.abs(this.v));
          this.v *= -0.25;
        }
      }
      if (!touched) break;
    }
    return impact;
  }
}
