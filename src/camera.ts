import * as THREE from 'three';
import { wrapAngle } from './collision';
import { clampCameraDistance } from './storey';
import {
  advanceBlend,
  blendWeight,
  dragFreeLook,
  freePose,
  FREE_START,
  isRigid,
  reverseHold,
  viewPose,
  type CamMode,
  type FreeLook,
  type Pose,
  type ViewTarget,
} from './views';
import { vehicleOf, type VehicleDef } from './vehicles';

export type { CamMode } from './views';

interface Target {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  steer: number;
  v: number;
}

export class CameraRig {
  private _mode: CamMode = 'chase';
  /** The vehicle being followed: sets camera distance, eye point and the corner views. */
  vehicle: VehicleDef = vehicleOf();
  private camHeading = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  /** Eased position for follow views (rigid views copy the wanted position). */
  private readonly cur = new THREE.Vector3();
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly lastLook = new THREE.Vector3();
  private blend = 1;
  private reversing = false;
  private free: FreeLook | null = null;
  private orbitT = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly blockers: THREE.Object3D[] = [];
  /** Surfaces the chase camera must not enter (empty on flat levels). */
  solids: THREE.Object3D[] = [];
  /** Follows prefers-reduced-motion: a view switch is then instant. */
  reduced: () => boolean = () => false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  get mode(): CamMode {
    return this._mode;
  }

  /** Switch view; the camera blends from where it is now. A no-op when already there. */
  set mode(m: CamMode) {
    if (m === this._mode) return;
    this._mode = m;
    this.fromPos.copy(this.camera.position);
    this.fromLook.copy(this.lastLook);
    this.blend = this.reduced() ? 1 : 0;
    this.camera.near = m === 'cockpit' ? 0.04 : 0.1;
    this.camera.updateProjectionMatrix();
  }

  /** Blend progress of the current switch, 0..1. */
  get progress(): number {
    return this.blend;
  }

  get freeLook(): boolean {
    return this.free !== null;
  }

  /** Start orbiting the car (paused or finished), or stop. */
  setFreeLook(on: boolean): void {
    if (on && !this.free) {
      this.free = { ...FREE_START };
      this.fromPos.copy(this.camera.position);
      this.fromLook.copy(this.lastLook);
      this.blend = this.reduced() ? 1 : 0;
    } else if (!on && this.free) {
      this.free = null;
      this.fromPos.copy(this.camera.position);
      this.fromLook.copy(this.lastLook);
      this.blend = this.reduced() ? 1 : 0;
    }
  }

  dragFree(dyaw: number, dpitch: number, ddist = 0): void {
    if (this.free) this.free = dragFreeLook(this.free, dyaw, dpitch, ddist);
  }

  private desired(t: Target): void {
    const vt: ViewTarget = {
      x: t.x,
      y: t.y,
      z: t.z,
      heading: isRigid(this._mode) ? t.heading : this.camHeading,
      pitch: t.pitch,
      steer: t.steer,
    };
    const p: Pose = this.free ? freePose(this.free, t) : viewPose(this._mode, vt, this.reversing, this.vehicle);
    this.pos.set(p.px, p.py, p.pz);
    this.look.set(p.lx, p.ly, p.lz);
  }

  /**
   * Pull `p` toward the car until nothing solid sits between them: a ceiling
   * or wall in the way brings the camera closer and lower instead of letting
   * it sit inside the geometry. Hidden floors never block.
   */
  private clear(t: Target, p: THREE.Vector3): void {
    if (this._mode !== 'chase' || this.free || this.solids.length === 0) return;
    this.origin.set(t.x, t.y + 1.2, t.z);
    this.dir.copy(p).sub(this.origin);
    const wanted = this.dir.length();
    if (wanted < 1e-3) return;
    this.dir.divideScalar(wanted);
    this.blockers.length = 0;
    for (const o of this.solids) if (o.visible) this.blockers.push(o);
    this.ray.set(this.origin, this.dir);
    this.ray.far = wanted;
    const hit = this.ray.intersectObjects(this.blockers, true)[0];
    const d = clampCameraDistance(wanted, hit ? hit.distance : null);
    if (d < wanted) p.copy(this.origin).addScaledVector(this.dir, d);
  }

  private apply(): void {
    if (this.blend < 1) {
      const w = blendWeight(this.blend);
      this.camera.position.copy(this.fromPos).lerp(this.cur, w);
      this.lastLook.copy(this.fromLook).lerp(this.look, w);
    } else {
      this.camera.position.copy(this.cur);
      this.lastLook.copy(this.look);
    }
    this.camera.lookAt(this.lastLook);
  }

  snap(t: Target): void {
    this.camHeading = t.heading;
    this.reversing = false;
    this.free = null;
    this.blend = 1;
    this.desired(t);
    this.clear(t, this.pos);
    this.cur.copy(this.pos);
    this.camera.position.copy(this.pos);
    this.camera.near = this._mode === 'cockpit' ? 0.04 : 0.1;
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  update(dt: number, t: Target): void {
    this.camHeading += wrapAngle(t.heading - this.camHeading) * (1 - Math.exp(-dt * 3.5));
    this.reversing = reverseHold(this.reversing, t.v);
    this.blend = advanceBlend(this.blend, dt, this.reduced());
    this.desired(t);
    this.clear(t, this.pos);
    if (isRigid(this._mode) && !this.free) this.cur.copy(this.pos);
    else this.cur.lerp(this.pos, 1 - Math.exp(-dt * (this._mode === 'chase' && !this.free ? 6 : 4)));
    this.clear(t, this.cur); // the eased position must not drift through a deck either
    this.apply();
  }

  /** Slow orbit used behind the menu. */
  orbit(dt: number, cx: number, cz: number, r: number): void {
    this.orbitT += dt * 0.08;
    this.camera.position.set(cx + Math.sin(this.orbitT) * r, r * 0.55, cz + Math.cos(this.orbitT) * r);
    this.camera.lookAt(cx, 0, cz);
    this.lastLook.set(cx, 0, cz);
    this.cur.copy(this.camera.position);
  }
}
