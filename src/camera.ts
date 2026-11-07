import * as THREE from 'three';
import { wrapAngle } from './collision';

export type CamMode = 'chase' | 'top';

interface Target {
  x: number;
  z: number;
  heading: number;
}

export class CameraRig {
  mode: CamMode = 'chase';
  private camHeading = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private orbitT = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  toggle(): CamMode {
    this.mode = this.mode === 'chase' ? 'top' : 'chase';
    return this.mode;
  }

  private desired(t: Target): void {
    if (this.mode === 'chase') {
      const fx = Math.sin(this.camHeading);
      const fz = Math.cos(this.camHeading);
      this.pos.set(t.x - fx * 7.5, 3.8, t.z - fz * 7.5);
      this.look.set(t.x + fx * 1.5, 0.6, t.z + fz * 1.5);
    } else {
      this.pos.set(t.x, 34, t.z - 10);
      this.look.set(t.x, 0, t.z);
    }
  }

  snap(t: Target): void {
    this.camHeading = t.heading;
    this.desired(t);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt: number, t: Target): void {
    this.camHeading += wrapAngle(t.heading - this.camHeading) * (1 - Math.exp(-dt * 3.5));
    this.desired(t);
    const k = 1 - Math.exp(-dt * (this.mode === 'chase' ? 6 : 4));
    this.camera.position.lerp(this.pos, k);
    this.camera.lookAt(this.look);
  }

  /** Slow orbit used behind the menu. */
  orbit(dt: number, cx: number, cz: number, r: number): void {
    this.orbitT += dt * 0.08;
    this.camera.position.set(cx + Math.sin(this.orbitT) * r, r * 0.55, cz + Math.cos(this.orbitT) * r);
    this.camera.lookAt(cx, 0, cz);
  }
}
