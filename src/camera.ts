import * as THREE from 'three';
import { wrapAngle } from './collision';
import { clampCameraDistance } from './storey';
import { vehicleOf, type VehicleDef } from './vehicles';

export type CamMode = 'chase' | 'top';

interface Target {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export class CameraRig {
  mode: CamMode = 'chase';
  /** Sets how far back and high the chase camera sits. */
  vehicle: VehicleDef = vehicleOf();
  private camHeading = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private orbitT = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly blockers: THREE.Object3D[] = [];
  /** Surfaces the chase camera must not enter (empty on flat levels). */
  solids: THREE.Object3D[] = [];

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  toggle(): CamMode {
    this.mode = this.mode === 'chase' ? 'top' : 'chase';
    return this.mode;
  }

  private desired(t: Target): void {
    if (this.mode === 'chase') {
      const fx = Math.sin(this.camHeading);
      const fz = Math.cos(this.camHeading);
      this.pos.set(
        t.x - fx * this.vehicle.camDistance,
        t.y + this.vehicle.camHeight,
        t.z - fz * this.vehicle.camDistance,
      );
      this.look.set(t.x + fx * 1.5, t.y + 0.6, t.z + fz * 1.5);
    } else {
      this.pos.set(t.x, t.y + 34 + this.vehicle.camHeight - 3.8, t.z - 10);
      this.look.set(t.x, t.y, t.z);
    }
  }

  /**
   * Pull `p` toward the car until nothing solid sits between them: a ceiling
   * or wall in the way brings the camera closer and lower instead of letting
   * it sit inside the geometry. Hidden floors never block.
   */
  private clear(t: Target, p: THREE.Vector3): void {
    if (this.mode !== 'chase' || this.solids.length === 0) return;
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

  snap(t: Target): void {
    this.camHeading = t.heading;
    this.desired(t);
    this.clear(t, this.pos);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt: number, t: Target): void {
    this.camHeading += wrapAngle(t.heading - this.camHeading) * (1 - Math.exp(-dt * 3.5));
    this.desired(t);
    this.clear(t, this.pos);
    const k = 1 - Math.exp(-dt * (this.mode === 'chase' ? 6 : 4));
    this.camera.position.lerp(this.pos, k);
    this.clear(t, this.camera.position); // the eased position must not drift through a deck either
    this.camera.lookAt(this.look);
  }

  /** Slow orbit used behind the menu. */
  orbit(dt: number, cx: number, cz: number, r: number): void {
    this.orbitT += dt * 0.08;
    this.camera.position.set(cx + Math.sin(this.orbitT) * r, r * 0.55, cz + Math.cos(this.orbitT) * r);
    this.camera.lookAt(cx, 0, cz);
  }
}
