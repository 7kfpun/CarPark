import * as THREE from 'three';
import { CAR_L, CAR_W, WHEELBASE, WHEEL_R } from './config';
import { DEFAULT_VEHICLE, vehicleOf, type VehicleDef } from './vehicles';
import { carTemplate, MODEL_SHARED, type CarTemplate } from './carModels';
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
  /** Radius of the road wheels (m), for the spin rate. */
  wheelRadius: number;
}

/** The parts of a vehicle a model is fitted to. */
export type Dims = Pick<VehicleDef, 'length' | 'width' | 'wheelbase'>;

/** Size of a parked (obstacle) car: the same as the hatchback. */
const PARKED_DIMS: Dims = { length: CAR_L, width: CAR_W, wheelbase: WHEELBASE };

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
function modelCar(t: CarTemplate, d: Dims): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const size = t.box.getSize(new THREE.Vector3());
  const centre = t.box.getCenter(new THREE.Vector3());
  const sx = d.width / size.x;
  const sz = d.length / size.z;
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
  const rearZ = -d.length / 2 - 0.02;
  const lampY = size.y * sy * 0.5;
  for (const side of [-1, 1]) {
    body.add(box(0.34, 0.13, 0.03, lamps.brakeMat, side * (d.width / 2 - 0.32), lampY, rearZ));
    body.add(box(0.14, 0.1, 0.03, lamps.reverseMat, side * (d.width / 2 - 0.62), lampY, rearZ));
  }
  lamps.brakeMat.visible = false;
  lamps.reverseMat.visible = false;
  return { root, body, frontPivots, spinners, ...lamps, overlayLamps: true, wheelRadius: WHEEL_R * sy };
}

/** A parked car's model: the loaded 3D model if available, otherwise the built-in box car. */
export function createCarModel(color: number, model?: string): CarModel {
  const t = model ? carTemplate(model) : undefined;
  return t ? modelCar(t, PARKED_DIMS) : boxCar(color, PARKED_DIMS);
}

/** The player's vehicle: its loaded model, or a coloured body built in code for the larger types. */
export function createVehicleModel(v: VehicleDef): CarModel {
  if (v.shape === 'model') {
    const t = v.model ? carTemplate(v.model) : undefined;
    return t ? modelCar(t, v) : boxCar(v.color, v);
  }
  return codedVehicle(v);
}

function wheelsFor(root: THREE.Group, d: Dims, radius: number, inset: number) {
  const geo = new THREE.CylinderGeometry(radius, radius, radius * 0.78, 20);
  geo.rotateZ(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.82, 12);
  hubG.rotateZ(Math.PI / 2);
  const frontPivots: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  for (const [z, front] of [
    [d.wheelbase / 2, true],
    [-d.wheelbase / 2, false],
  ] as const) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (d.width / 2 - inset), radius, z);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(geo, tyreMat);
      tyre.castShadow = true;
      spin.add(tyre, new THREE.Mesh(hubG, hubMat));
      pivot.add(spin);
      root.add(pivot);
      spinners.push(spin);
      if (front) frontPivots.push(pivot);
    }
  }
  return { frontPivots, spinners };
}

/** Lamps on the front and rear faces; the rear ones light up with braking and reversing. */
function addLamps(body: THREE.Group, d: Dims, y: number, headY = y): Pick<CarModel, 'brakeMat' | 'reverseMat'> {
  for (const sx of [-1, 1])
    body.add(box(0.36, 0.14, 0.05, headMat, sx * (d.width / 2 - 0.3), headY, d.length / 2 + 0.01));
  const { brakeMat, reverseMat } = lampMaterials();
  for (const sx of [-1, 1]) {
    body.add(box(0.36, 0.14, 0.05, brakeMat, sx * (d.width / 2 - 0.3), y, -d.length / 2 - 0.01));
    body.add(box(0.14, 0.1, 0.05, reverseMat, sx * (d.width / 2 - 0.62), y, -d.length / 2 - 0.01));
  }
  return { brakeMat, reverseMat };
}

/** Minibus, city bus and box truck: simple painted boxes with glass, scaled to the vehicle's own size. */
function codedVehicle(v: VehicleDef): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color: v.color, metalness: 0.25, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1f1, metalness: 0.1, roughness: 0.6 });
  const W = v.width;
  const L = v.length;
  const radius = v.shape === 'minibus' ? 0.4 : 0.5;
  if (v.shape === 'truck') {
    const cabL = 2.2;
    const cargoL = L - cabL - 0.1;
    body.add(box(W * 0.9, 0.35, L, trimMat, 0, radius + 0.1, 0)); // chassis
    body.add(box(W, 2.0, cabL, paint, 0, 1.45, L / 2 - cabL / 2)); // cab
    body.add(box(W * 0.88, 0.8, 0.06, glassMat, 0, 1.95, L / 2 + 0.01)); // windscreen
    body.add(box(W + 0.02, 0.7, cabL * 0.5, glassMat, 0, 1.95, L / 2 - cabL * 0.45)); // side windows
    body.add(box(W, 2.8, cargoL, white, 0, 1.95, -L / 2 + cargoL / 2)); // cargo box
    body.add(box(W + 0.04, 0.12, cargoL, paint, 0, 0.62, -L / 2 + cargoL / 2)); // stripe along the sill
  } else {
    const bus = v.shape === 'bus';
    const lowerH = bus ? 1.3 : 1.0;
    const glassH = bus ? 1.0 : 0.75;
    const lowerY = radius + lowerH / 2 - 0.05;
    const glassY = lowerY + lowerH / 2 + glassH / 2;
    body.add(box(W, lowerH, L, paint, 0, lowerY, 0));
    body.add(box(W + 0.02, glassH, L * 0.92, glassMat, 0, glassY, -L * 0.02));
    body.add(box(W * 0.9, glassH, 0.06, glassMat, 0, glassY, L / 2 + 0.01)); // windscreen
    body.add(box(W * 0.98, 0.14, L * 0.98, bus ? white : paint, 0, glassY + glassH / 2 + 0.07, 0)); // roof
    body.add(box(W + 0.04, 0.16, 0.12, trimMat, 0, 0.5, L / 2));
    body.add(box(W + 0.04, 0.16, 0.12, trimMat, 0, 0.5, -L / 2));
  }
  const { frontPivots, spinners } = wheelsFor(root, v, radius, 0.1);
  const lamps = addLamps(body, v, 0.85);
  return { root, body, frontPivots, spinners, ...lamps, overlayLamps: false, wheelRadius: radius };
}

function boxCar(color: number, d: Dims): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });
  body.add(box(d.width, 0.55, d.length, paint, 0, 0.6, 0));
  body.add(box(d.width * 0.86, 0.5, d.length * 0.5, glassMat, 0, 1.12, -0.25));
  body.add(box(d.width * 0.88, 0.06, d.length * 0.46, paint, 0, 1.4, -0.25));
  body.add(box(d.width + 0.04, 0.16, 0.12, trimMat, 0, 0.42, d.length / 2));
  body.add(box(d.width + 0.04, 0.16, 0.12, trimMat, 0, 0.42, -d.length / 2));
  const lamps = addLamps(body, d, 0.72);

  const frontPivots: THREE.Object3D[] = [];
  const spinners: THREE.Object3D[] = [];
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (d.width / 2 - 0.12), WHEEL_R, (sz * d.wheelbase) / 2);
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
  return { root, body, frontPivots, spinners, ...lamps, overlayLamps: false, wheelRadius: WHEEL_R };
}

/** The player's vehicle: physics + model kept in sync. Switching vehicles swaps both. */
export class PlayerCar {
  physics: CarPhysics;
  model: CarModel;
  vehicle: VehicleDef;
  private readonly models = new Map<string, CarModel>();

  constructor(vehicle: VehicleDef = vehicleOf(DEFAULT_VEHICLE)) {
    this.vehicle = vehicle;
    this.physics = new CarPhysics(vehicle);
    this.model = this.modelFor(vehicle);
  }

  private modelFor(v: VehicleDef): CarModel {
    let m = this.models.get(v.id);
    if (!m) this.models.set(v.id, (m = createVehicleModel(v)));
    return m;
  }

  /** Drive `v` from now on. Returns true when the model changed (the caller swaps it in the scene). */
  use(v: VehicleDef): boolean {
    if (v === this.vehicle) return false;
    this.vehicle = v;
    this.physics = new CarPhysics(v);
    this.model = this.modelFor(v);
    return true;
  }

  sync(dt: number): void {
    const p = this.physics;
    const m = this.model;
    m.root.position.set(p.x, p.y, p.z);
    m.root.rotation.order = 'YXZ'; // heading first, then tilt about the car's own x axis
    m.root.rotation.y = p.heading;
    m.root.rotation.x = -p.pitch; // nose up on a climb
    for (const f of m.frontPivots) f.rotation.y = -p.steer;
    for (const s of m.spinners) s.rotation.x += (p.v * dt) / m.wheelRadius;
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
