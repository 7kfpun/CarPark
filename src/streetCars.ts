import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { StreetBody } from './layout';

/**
 * Parked street cars drawn in code (no model files, so nothing to download or cache): a rounded body
 * extruded from a side profile, a glass greenhouse with paint pillars and roof, alloy wheels on
 * soft tyres, lamps, grille, mirrors and plates. Geometry is built once per body type and shared;
 * only the paint colour differs per car. Each car is four meshes (paint, glass, detail, lamps)
 * plus a soft contact shadow.
 *
 * Car space: x across (width 1.9 m), y up, z forward (length 4.2 m), the same footprint as every
 * other parked car, so collisions are unchanged.
 */
const DEF_W = 1.9;
const DEF_L = 4.2;
const BEVEL = 0.06;
const WHEEL_Z = 1.3;

type Pt = [number, number]; // [z, y]

interface Spec {
  /** Lower body outline (rear to front along the top, then back along the sill). */
  body: Pt[];
  /** Greenhouse outline (a trapezoid sitting on the body). */
  cabin: Pt[];
  /** Radius of the corner rounding on the body outline. */
  round: number;
  /** Ride height of the sill (m). */
  sill: number;
  /** Roof rails (SUV, wagon). */
  rails?: boolean;
  /** Open load bed behind the cab. */
  bed?: boolean;
  /** Footprint (m); defaults to the standard parked car, 1.9 x 4.2. */
  w?: number;
  l?: number;
  /** Axle positions along z and tyre radius (defaults: wheelbase 2.6, 0.352). */
  axles?: number[];
  tyreR?: number;
  /** Height where the glass starts (defaults to the body's top at the doors). */
  belt?: number;
  /** Solid paint panels over the glass between these z values (a van's cargo area). */
  panels?: [number, number][];
  /** Extra vertical pillars at these z values (a bus's window frames). */
  pillars?: number[];
  /** A paint cap above the glass up to this height (a bus's roof). */
  roofCap?: number;
  /** Buses and vans: no car-style door handles and shut lines. */
  boxy?: boolean;
}

const E = DEF_L / 2 - BEVEL; // outline end, the bevel brings it to the full length
const SPECS: Record<StreetBody, Spec> = {
  sedan: {
    body: [
      [-E, 0.3],
      [-E, 0.84],
      [-1.8, 0.99],
      [-1.2, 1.01],
      [1.2, 0.96],
      [1.85, 0.9],
      [E, 0.74],
      [E, 0.3],
    ],
    cabin: [
      [-1.3, 0.99],
      [-0.85, 1.46],
      [0.5, 1.47],
      [1.2, 0.97],
    ],
    round: 0.16,
    sill: 0.3,
  },
  hatchback: {
    body: [
      [-E, 0.3],
      [-E, 0.92],
      [-1.9, 1.0],
      [1.15, 0.96],
      [1.85, 0.88],
      [E, 0.72],
      [E, 0.3],
    ],
    cabin: [
      [-1.95, 0.99],
      [-1.55, 1.52],
      [0.35, 1.53],
      [1.1, 0.97],
    ],
    round: 0.14,
    sill: 0.3,
  },
  wagon: {
    body: [
      [-E, 0.3],
      [-E, 0.9],
      [-1.9, 1.0],
      [1.2, 0.97],
      [1.85, 0.9],
      [E, 0.74],
      [E, 0.3],
    ],
    cabin: [
      [-1.98, 0.99],
      [-1.9, 1.5],
      [0.3, 1.52],
      [1.1, 0.98],
    ],
    round: 0.12,
    sill: 0.3,
    rails: true,
  },
  suv: {
    body: [
      [-E, 0.4],
      [-E, 1.04],
      [-1.95, 1.12],
      [1.3, 1.1],
      [1.9, 1.02],
      [E, 0.84],
      [E, 0.4],
    ],
    cabin: [
      [-1.97, 1.1],
      [-1.88, 1.76],
      [0.55, 1.78],
      [1.25, 1.1],
    ],
    round: 0.14,
    sill: 0.4,
    rails: true,
  },
  van: {
    body: [
      [-2.45, 0.42],
      [-2.45, 1.1],
      [-2.2, 1.14],
      [1.6, 1.1],
      [2.2, 1.0],
      [2.45, 0.85],
      [2.45, 0.42],
    ],
    cabin: [
      [-2.4, 1.1],
      [-2.4, 2.12],
      [1.0, 2.14],
      [1.75, 1.12],
    ],
    round: 0.14,
    sill: 0.42,
    w: 2.0,
    l: 5.0,
    axles: [-1.55, 1.7],
    panels: [[-2.45, -0.6]],
    boxy: true,
  },
  bus: {
    body: [
      [-4.44, 0.5],
      [-4.44, 1.5],
      [4.44, 1.5],
      [4.44, 0.62],
      [4.44, 0.5],
    ],
    cabin: [
      [-4.4, 1.5],
      [-4.4, 2.72],
      [4.4, 2.72],
      [4.4, 1.5],
    ],
    round: 0.16,
    sill: 0.5,
    w: 2.5,
    l: 9.0,
    axles: [-2.9, 3.1],
    tyreR: 0.5,
    belt: 1.5,
    pillars: [-3.3, -1.8, -0.3, 1.2, 2.7],
    roofCap: 3.0,
    boxy: true,
  },
  pickup: {
    body: [
      [-E, 0.4],
      [-E, 1.04],
      [1.2, 1.06],
      [1.9, 1.0],
      [E, 0.84],
      [E, 0.4],
    ],
    cabin: [
      [-0.45, 1.04],
      [-0.4, 1.7],
      [0.5, 1.72],
      [1.2, 1.04],
    ],
    round: 0.12,
    sill: 0.4,
    bed: true,
  },
};

/** Footprint (m) of a body type: what the collision box of that parked car must be. */
export function streetDims(kind: StreetBody): { w: number; l: number } {
  return { w: SPECS[kind].w ?? DEF_W, l: SPECS[kind].l ?? DEF_L };
}

/** A polygon with rounded corners as a THREE.Shape. */
function roundedShape(pts: Pt[], r: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = pts.length;
  pts.forEach((p, i) => {
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    const toward = (q: Pt): Pt => {
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const d = Math.hypot(dx, dy);
      const k = Math.min(r, d / 2.2) / d;
      return [p[0] + dx * k, p[1] + dy * k];
    };
    const a = toward(prev);
    const b = toward(next);
    if (i === 0) s.moveTo(a[0], a[1]);
    else s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  });
  s.closePath();
  return s;
}

/** Extrude a side-profile shape (z, y) across the car, centred on x = 0, with soft edges. */
function profile(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 8,
  });
  g.rotateY(-Math.PI / 2); // shape x -> car z, extrusion -> car -x
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

function tint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = src.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  src.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  src.deleteAttribute('uv');
  if (src !== g) g.dispose();
  return src;
}

function boxAt(w: number, h: number, l: number, x: number, y: number, z: number, rotX = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l);
  if (rotX) g.rotateX(rotX);
  return g.translate(x, y, z);
}

/** A box laid along the segment p0 -> p1 of a (z, y) outline, `width` across the car at x. */
function strut(p0: Pt, p1: Pt, thick: number, width: number, x: number): THREE.BufferGeometry {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const g = new THREE.BoxGeometry(width, thick, len + thick * 0.6);
  g.rotateX(-ang);
  return g.translate(x, (p0[1] + p1[1]) / 2, (p0[0] + p1[0]) / 2);
}

const DARK = 0x14161a;
const TYRE = 0x0e0e10;
const ALLOY = 0xb7bcc5;
const CHROME = 0xd5d9df;
const PLATE = 0xeeeeee;

/** One alloy wheel on a soft tyre, facing +x, centred at the origin. */
function wheelParts(): THREE.BufferGeometry[] {
  const tyre = new THREE.LatheGeometry(
    [
      [0.22, -0.11],
      [0.3, -0.113],
      [0.34, -0.09],
      [0.352, -0.04],
      [0.352, 0.04],
      [0.34, 0.09],
      [0.3, 0.113],
      [0.22, 0.11],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  );
  tyre.rotateZ(-Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [tint(tyre, TYRE)];
  const face = (g: THREE.BufferGeometry, x: number) => g.rotateY(Math.PI / 2).translate(x, 0, 0);
  parts.push(tint(face(new THREE.CircleGeometry(0.235, 24), 0.108), DARK)); // dish
  parts.push(tint(face(new THREE.RingGeometry(0.19, 0.235, 24), 0.112), ALLOY)); // rim lip
  for (let k = 0; k < 5; k++) {
    const spoke = new THREE.BoxGeometry(0.012, 0.19, 0.04).translate(0.113, 0.105, 0);
    spoke.rotateX((k * 2 * Math.PI) / 5);
    parts.push(tint(spoke, ALLOY));
  }
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12).rotateZ(-Math.PI / 2).translate(0.115, 0, 0);
  parts.push(tint(hub, CHROME));
  return parts;
}

interface Built {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  detail: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
}

function build(kind: StreetBody): Built {
  const s = SPECS[kind];
  const STREET_W = s.w ?? DEF_W;
  const STREET_L = s.l ?? DEF_L;
  const HL = STREET_L / 2;
  const k = STREET_W / DEF_W; // lateral scale of the lamps and trim
  const axles = s.axles ?? [-WHEEL_Z, WHEEL_Z];
  const TYRE_R = s.tyreR ?? 0.352;
  const paintParts: THREE.BufferGeometry[] = [];
  const detail: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];

  paintParts.push(profile(roundedShape(s.body, s.round), STREET_W, BEVEL));
  // Underbody and sills: keeps the gap under the car dark instead of see-through.
  detail.push(tint(boxAt(STREET_W - 0.24, 0.14, STREET_L - 0.3, 0, s.sill - 0.02, 0), DARK));

  // Greenhouse: glass with paint pillars and a roof panel proud of it.
  const gw = STREET_W - 0.34;
  const cabin = s.cabin;
  const glass = profile(roundedShape(cabin, 0.12), gw, 0.03);
  const pw = gw + 0.07;
  const [rb, rt, ft, fb] = cabin;
  const belt = s.belt ?? s.body[2][1];
  paintParts.push(strut(rt, ft, 0.07, pw - 0.02, 0)); // roof
  paintParts.push(strut(fb, ft, 0.09, pw, 0)); // windscreen header / A pillars
  paintParts.push(strut(rb, rt, 0.09, pw, 0)); // C pillars / tailgate edge
  if (!s.bed) {
    const mid = (rt[0] + ft[0]) / 2 - 0.15;
    const midY = cabin[1][1] - 0.02;
    paintParts.push(boxAt(pw, midY - belt, 0.08, 0, (midY + belt) / 2 - 0.02, mid)); // B pillar
  }
  for (const [z0, z1] of s.panels ?? [])
    paintParts.push(boxAt(pw, cabin[1][1] - belt, z1 - z0, 0, (cabin[1][1] + belt) / 2, (z0 + z1) / 2));
  for (const z of s.pillars ?? []) paintParts.push(boxAt(pw, cabin[1][1] - belt, 0.14, 0, (cabin[1][1] + belt) / 2, z));
  if (s.roofCap)
    paintParts.push(
      boxAt(pw + 0.02, s.roofCap - cabin[1][1] + 0.02, STREET_L - 0.1, 0, (s.roofCap + cabin[1][1]) / 2, 0),
    );
  if (s.rails)
    for (const sx of [-1, 1])
      detail.push(
        tint(
          boxAt(0.04, 0.05, rt[0] < ft[0] ? ft[0] - rt[0] - 0.3 : 1, sx * 0.72, rt[1] + 0.07, (rt[0] + ft[0]) / 2),
          DARK,
        ),
      );

  if (s.bed) {
    const top = s.body[2][1];
    detail.push(tint(boxAt(1.54, 0.03, 1.5, 0, top + 0.005, -1.3), DARK)); // bed liner
    detail.push(tint(boxAt(1.7, 0.1, 0.05, 0, top - 0.02, -E + 0.02), CHROME)); // tailgate handle strip
  }

  // Wheels and arches.
  const wheel = mergeGeometries(wheelParts(), false)!;
  wheel.scale(TYRE_R / 0.352, TYRE_R / 0.352, TYRE_R / 0.352);
  const archR = TYRE_R + 0.048;
  const wheelY = TYRE_R;
  for (const sx of [-1, 1])
    for (const z of axles) {
      const w = wheel.clone();
      if (sx < 0) w.rotateY(Math.PI);
      detail.push(w.translate(sx * (STREET_W / 2 - 0.12), wheelY, z));
      // Dark arch on the flank behind the tyre.
      const lip = Math.asin((s.sill - 0.02 - wheelY) / archR);
      const arch = new THREE.CircleGeometry(archR, 24, -lip, Math.PI + 2 * lip);
      arch.rotateY(sx * (Math.PI / 2));
      detail.push(tint(arch.translate(sx * (STREET_W / 2 + 0.004), wheelY, z), DARK));
      // Arch liner: a dark half cylinder inside, so the wheel well has depth.
      const liner = new THREE.CylinderGeometry(archR - 0.03, archR - 0.03, 0.34, 20, 1, true, 0, Math.PI);
      liner.rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
      detail.push(tint(liner.translate(sx * (STREET_W / 2 - 0.19), wheelY, z), DARK));
    }

  // Front: grille, lower intake, plate, headlamps.
  const nose = s.body[s.body.length - 2][1];
  const frontY = (s.sill + nose) / 2;
  detail.push(tint(boxAt(0.78, 0.17, 0.05, 0, frontY + 0.06, HL + 0.005), DARK));
  detail.push(tint(boxAt(0.8, 0.02, 0.055, 0, frontY + 0.06, HL + 0.006), CHROME));
  detail.push(tint(boxAt(STREET_W - 0.4, 0.12, 0.06, 0, s.sill + 0.1, HL - 0.02), DARK));
  detail.push(tint(boxAt(0.5, 0.11, 0.02, 0, s.sill + 0.12, HL + 0.04), PLATE));
  for (const sx of [-1, 1]) {
    lamps.push(tint(boxAt(0.4, 0.1, 0.05, sx * 0.63 * k, nose - 0.08, HL), 0xfff3cf));
    lamps.push(tint(boxAt(0.12, 0.06, 0.05, sx * 0.8 * k, nose - 0.2, HL - 0.02), 0xff9a1f));
  }
  // Rear: tail lamps, plate, bumper.
  const tail = s.body[1][1];
  for (const sx of [-1, 1]) lamps.push(tint(boxAt(0.46, 0.12, 0.05, sx * 0.64 * k, tail - 0.1, -HL), 0xc4161c));
  detail.push(tint(boxAt(0.5, 0.11, 0.02, 0, tail - 0.28, -HL - 0.03), PLATE));
  detail.push(tint(boxAt(STREET_W - 0.3, 0.1, 0.06, 0, s.sill + 0.1, -HL + 0.02), DARK));

  // Flanks: door shut lines, handles, mirrors.
  const beltY = belt;
  for (const sx of [-1, 1]) {
    const x = sx * (STREET_W / 2 + 0.003);
    for (const z of s.boxy ? [] : [-0.45, 0.85])
      detail.push(tint(boxAt(0.012, beltY - s.sill - 0.08, 0.012, x, (beltY + s.sill) / 2, z), DARK));
    for (const z of s.boxy ? [] : [-0.2, 0.55])
      detail.push(tint(boxAt(0.02, 0.025, 0.16, x + sx * 0.005, beltY - 0.1, z), CHROME));
    detail.push(tint(boxAt(0.14, 0.1, 0.17, sx * (STREET_W / 2 + 0.04), belt + 0.12, cabin[3][0] - 0.28), DARK)); // mirror
    detail.push(tint(boxAt(0.02, 0.012, STREET_L - 0.7, sx * (STREET_W / 2 - 0.07), s.sill + 0.06, 0), CHROME)); // sill trim
  }

  const paint = mergeGeometries(
    paintParts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  )!;
  paintParts.forEach((p) => p.dispose());
  const det = mergeGeometries(detail, false)!;
  detail.forEach((p) => p.dispose());
  const lam = mergeGeometries(lamps, false)!;
  lamps.forEach((p) => p.dispose());
  return { paint, glass, detail: det, lamps: lam };
}

/** Everything built here is shared by every car and level: never dispose it per level. */
export const STREET_SHARED = new Set<object>();

const built = new Map<StreetBody, Built>();
const paints = new Map<number, THREE.Material>();
let shared: { glass: THREE.Material; detail: THREE.Material; lamps: THREE.Material; blob: THREE.Mesh } | null = null;

function keep<T extends object>(o: T): T {
  STREET_SHARED.add(o);
  return o;
}

function paintFor(color: number): THREE.Material {
  let m = paints.get(color);
  if (m) return m;
  // High: clear-coated paint. Low: the plain standard material (see setMaterialDetail), costing no more than before.
  const plain = keep(new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 }));
  const coat = keep(
    new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
  );
  coat.userData.base = plain;
  plain.userData.phys = coat;
  m = coat;
  paints.set(color, m);
  return m;
}

function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.65)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return keep(t);
}

function sharedParts(): NonNullable<typeof shared> {
  if (shared) return shared;
  const glass = keep(new THREE.MeshPhysicalMaterial({ color: 0x131b24, metalness: 0.6, roughness: 0.08 }));
  const detail = keep(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 }));
  const lamps = keep(
    new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.3 }),
  );
  const blobMat = keep(
    new THREE.MeshBasicMaterial({
      map: blobTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const blobGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.position.y = 0.012;
  blob.userData.noShadow = true;
  blob.renderOrder = 1;
  shared = { glass, detail, lamps, blob };
  return shared;
}

/** A parked street car of the given body type and paint colour, facing +z at the origin. */
export function buildStreetCar(kind: StreetBody, color: number): THREE.Group {
  let b = built.get(kind);
  if (!b) {
    b = build(kind);
    for (const g of Object.values(b)) keep(g);
    built.set(kind, b);
  }
  const sp = sharedParts();
  const root = new THREE.Group();
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    o.receiveShadow = true;
    root.add(o);
  };
  mesh(b.paint, paintFor(color));
  mesh(b.glass, sp.glass);
  mesh(b.detail, sp.detail);
  mesh(b.lamps, sp.lamps);
  const blob = sp.blob.clone();
  const d = streetDims(kind);
  blob.scale.set(d.w + 0.9, 1, d.l + 0.9);
  root.add(blob);
  return root;
}
