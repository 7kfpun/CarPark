import * as THREE from 'three';
import { CAR_L, CAR_W, WHEELBASE, WHEEL_R } from './config';
import { carTemplate, MODEL_SHARED, PLAYER_MODEL, type CarTemplate } from './carModels';
import { CarPhysics } from './physics';

export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  frontPivots: THREE.Object3D[];
  spinners: THREE.Object3D[];
  brakeMat: THREE.MeshStandardMaterial;
  reverseMat: THREE.MeshStandardMaterial;
  /** Lamps are overlays on a textured model: hide them when off so the painted lamps show. */
  overlayLamps: boolean;
}

const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 20);
wheelGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.3, 12);
hubGeo.rotateZ(Math.PI / 2);
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.8, roughness: 0.3 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2633, metalness: 0.4, roughness: 0.15 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });

/** Geometries/materials shared by every car; never dispose these per level. */
const BOX_SHARED = new Set<object>([wheelGeo, hubGeo, tyreMat, hubMat, glassMat, headMat, trimMat]);
export const CAR_SHARED = { has: (o: object): boolean => BOX_SHARED.has(o) || MODEL_SHARED.has(o) };

function box(w: number, h: number, l: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function lampMaterials(): Pick<CarModel, 'brakeMat' | 'reverseMat'> {
  return {
    brakeMat: new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff1a1a, emissiveIntensity: 0.25 }),
    reverseMat: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 }),
  };
}

/**
 * Fit a loaded model to the car's physics footprint (CAR_W x CAR_L). The body
 * is scaled per axis; wheels sit outside the scaled group with a round scale so
 * they stay circular while spinning.
 */
function modelCar(t: CarTemplate): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const size = t.box.getSize(new THREE.Vector3());
  const centre = t.box.getCenter(new THREE.Vector3());
  const sx = CAR_W / size.x;
  const sz = CAR_L / size.z;
  const sy = sx; // keep the height and wheel size in proportion with the width
  const toCar = (p: THREE.Vector3) =>
    new THREE.Vector3((p.x - centre.x) * sx, (p.y - t.box.min.y) * sy, (p.z - centre.z) * sz);

  const shell = t.body.clone();
  shell.scale.set(sx, sy, sz);
  shell.position.copy(toCar(new THREE.Vector3(0, 0, 0)));
  body.add(shell);

  const frontPivots: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  for (const w of t.wheels) {
    const pivot = new THREE.Group();
    pivot.position.copy(toCar(w.pos));
    const spin = new THREE.Group();
    const mesh = w.mesh.clone();
    // Round in the spin plane; tyre width stays near the model's own so wheels don't bulge out.
    mesh.scale.set(1.1, sy, sy);
    spin.add(mesh);
    pivot.add(spin);
    root.add(pivot);
    spinners.push(spin);
    if (w.front) frontPivots.push(pivot);
  }

  // Brake / reverse lamp overlays on the rear face, only shown when lit.
  const lamps = lampMaterials();
  const rearZ = -CAR_L / 2 - 0.02;
  const lampY = size.y * sy * 0.5;
  for (const side of [-1, 1]) {
    body.add(box(0.34, 0.13, 0.03, lamps.brakeMat, side * (CAR_W / 2 - 0.32), lampY, rearZ));
    body.add(box(0.14, 0.1, 0.03, lamps.reverseMat, side * (CAR_W / 2 - 0.62), lampY, rearZ));
  }
  lamps.brakeMat.visible = false;
  lamps.reverseMat.visible = false;
  return { root, body, frontPivots, spinners, ...lamps, overlayLamps: true };
}

/** A car model: the loaded 3D model if available, otherwise the built-in box car. */
export function createCarModel(color: number, model?: string): CarModel {
  const t = model ? carTemplate(model) : undefined;
  return t ? modelCar(t) : boxCar(color);
}

function boxCar(color: number): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });
  body.add(box(CAR_W, 0.55, CAR_L, paint, 0, 0.6, 0));
  body.add(box(CAR_W * 0.86, 0.5, CAR_L * 0.5, glassMat, 0, 1.12, -0.25));
  body.add(box(CAR_W * 0.88, 0.06, CAR_L * 0.46, paint, 0, 1.4, -0.25));
  body.add(box(CAR_W + 0.04, 0.16, 0.12, trimMat, 0, 0.42, CAR_L / 2));
  body.add(box(CAR_W + 0.04, 0.16, 0.12, trimMat, 0, 0.42, -CAR_L / 2));

  for (const sx of [-1, 1]) {
    body.add(box(0.36, 0.14, 0.05, headMat, sx * (CAR_W / 2 - 0.3), 0.72, CAR_L / 2 + 0.01));
  }
  const { brakeMat, reverseMat } = lampMaterials();
  for (const sx of [-1, 1]) {
    body.add(box(0.36, 0.14, 0.05, brakeMat, sx * (CAR_W / 2 - 0.3), 0.72, -CAR_L / 2 - 0.01));
    body.add(box(0.14, 0.1, 0.05, reverseMat, sx * (CAR_W / 2 - 0.62), 0.72, -CAR_L / 2 - 0.01));
  }

  const frontPivots: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (CAR_W / 2 - 0.12), WHEEL_R, (sz * WHEELBASE) / 2);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, tyreMat);
      tyre.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      spin.add(tyre, hub);
      pivot.add(spin);
      root.add(pivot);
      spinners.push(spin);
      if (sz === 1) frontPivots.push(pivot);
    }
  }
  return { root, body, frontPivots, spinners, brakeMat, reverseMat, overlayLamps: false };
}

/** The player's car: physics + model kept in sync. */
export class PlayerCar {
  readonly physics = new CarPhysics();
  readonly model = createCarModel(0xffb81c, PLAYER_MODEL);

  sync(dt: number): void {
    const p = this.physics;
    const m = this.model;
    m.root.position.set(p.x, p.y, p.z);
    m.root.rotation.order = 'YXZ'; // heading first, then tilt about the car's own x axis
    m.root.rotation.y = p.heading;
    m.root.rotation.x = -p.pitch; // nose up on a climb
    for (const f of m.frontPivots) f.rotation.y = -p.steer;
    for (const s of m.spinners) s.rotation.x += (p.v * dt) / WHEEL_R;
    // Slight body roll for feel.
    const roll = THREE.MathUtils.clamp(p.v * Math.tan(p.steer) * 0.012, -0.05, 0.05);
    m.body.rotation.z = THREE.MathUtils.lerp(m.body.rotation.z, roll, 0.15);
    const reversing = p.v < -0.05;
    m.brakeMat.emissiveIntensity = p.braking ? 2.2 : 0.25;
    m.reverseMat.emissiveIntensity = reversing ? 1.6 : 0;
    if (m.overlayLamps) {
      m.brakeMat.visible = p.braking;
      m.reverseMat.visible = reversing;
    }
  }
}
