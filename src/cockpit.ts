import * as THREE from 'three';
import { CAR_W } from './config';
import { EYE } from './views';

const dashMat = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.85 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.7 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.8 });

/** Wheel turn per radian of front-wheel angle (a real steering ratio is about 15:1; this reads well on screen). */
export const WHEEL_RATIO = 3.5;

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * A simple interior drawn in code: dashboard, steering wheel and A / B
 * pillars with a roof header. Local axes match the car (x left, y up, z
 * forward). Shown only in the cockpit view, together with hiding the body
 * shell; it adds no render passes.
 */
export class Cockpit {
  readonly group = new THREE.Group();
  private readonly wheel = new THREE.Group();

  constructor() {
    const hw = CAR_W / 2;
    const g = this.group;
    // Dashboard and cowl, with the instrument hood in front of the driver.
    g.add(part(new THREE.BoxGeometry(CAR_W - 0.1, 0.26, 0.5), dashMat, 0, 0.66, 0.7));
    g.add(part(new THREE.BoxGeometry(0.5, 0.1, 0.2), trimMat, EYE.x, 0.82, 0.55));
    g.add(part(new THREE.BoxGeometry(CAR_W - 0.1, 0.12, 1.1), trimMat, 0, 0.55, 0.2));
    // Door tops, so the lower window edge is visible.
    for (const s of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.1, 0.1, 1.9), trimMat, s * (hw - 0.05), 0.78, -0.25));
    // Steering wheel on a short column, tilted towards the driver; the rim turns with the steering input.
    const col = new THREE.Group();
    col.position.set(EYE.x, 0.86, 0.4);
    col.rotation.x = -2.62; // wheel faces the driver, tilted up 30 degrees
    col.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), trimMat, 0, 0, -0.15).rotateX(Math.PI / 2));
    this.wheel.position.z = 0;
    this.wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 28), wheelMat));
    this.wheel.add(part(new THREE.BoxGeometry(0.3, 0.03, 0.03), wheelMat, 0, 0, 0));
    this.wheel.add(part(new THREE.BoxGeometry(0.03, 0.14, 0.03), wheelMat, 0, -0.07, 0));
    col.add(this.wheel);
    g.add(col);
    // A pillars lean back from the cowl, B pillars stand behind the driver, a header joins the top.
    for (const s of [-1, 1]) {
      const a = part(new THREE.BoxGeometry(0.05, 0.62, 0.07), pillarMat, s * (hw - 0.03), 1.12, 0.74);
      a.rotation.x = -0.45;
      g.add(a);
      g.add(part(new THREE.BoxGeometry(0.07, 0.66, 0.09), pillarMat, s * (hw - 0.05), 1.2, -0.95));
    }
    g.add(part(new THREE.BoxGeometry(CAR_W - 0.1, 0.06, 0.12), pillarMat, 0, 1.55, 0.1));
    g.visible = false;
    g.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Turn the wheel to match the front-wheel angle (positive = right = clockwise from the driver's seat). */
  setSteer(steer: number): void {
    this.wheel.rotation.z = -steer * WHEEL_RATIO;
  }
}
