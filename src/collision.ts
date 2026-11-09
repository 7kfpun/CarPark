// 2D oriented bounding boxes on the XZ ground plane.
// rot follows THREE's rotation.y: local +z maps to (sin rot, cos rot),
// local +x maps to (cos rot, -sin rot).
export interface OBB {
  x: number;
  z: number;
  hw: number; // half extent along local x
  hl: number; // half extent along local z
  rot: number;
}

export interface Contact {
  depth: number;
  nx: number; // normal pointing from b towards a
  nz: number;
}

type Vec = [number, number];

function axes(o: OBB): [Vec, Vec] {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return [
    [c, -s],
    [s, c],
  ];
}

function radius(o: OBB, ax: Vec): number {
  const [a1, a2] = axes(o);
  return o.hw * Math.abs(a1[0] * ax[0] + a1[1] * ax[1]) + o.hl * Math.abs(a2[0] * ax[0] + a2[1] * ax[1]);
}

/**
 * Separating-axis test. Returns the minimum-translation contact, or null.
 * The normal is the axis of least overlap, oriented from b towards a. When
 * the centres (nearly) coincide along that axis the orientation is ambiguous;
 * then (hx, hz), a preferred push direction for a (e.g. against its motion),
 * decides, falling back to +axis.
 *
 * Runs every physics step against every obstacle, so it allocates nothing
 * unless there is a contact, and boxes whose bounding circles are apart are
 * rejected before any trigonometry.
 */
export function sat(a: OBB, b: OBB, hx = 0, hz = 0): Contact | null {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  // Broad phase: disjoint bounding circles cannot overlap.
  const reach = Math.hypot(a.hw, a.hl) + Math.hypot(b.hw, b.hl);
  if (dx * dx + dz * dz > reach * reach) return null;

  const ca = Math.cos(a.rot);
  const sa = Math.sin(a.rot);
  const cb = Math.cos(b.rot);
  const sb = Math.sin(b.rot);
  let depth = 0;
  let nx = 0;
  let nz = 0;
  let bestDist = 0;
  let found = false;
  // Axes in the original order: a.x, a.z, b.x, b.z.
  for (let i = 0; i < 4; i++) {
    const ax = i === 0 ? ca : i === 1 ? sa : i === 2 ? cb : sb;
    const az = i === 0 ? -sa : i === 1 ? ca : i === 2 ? -sb : cb;
    const dist = dx * ax + dz * az;
    const ra = a.hw * Math.abs(ca * ax - sa * az) + a.hl * Math.abs(sa * ax + ca * az);
    const rb = b.hw * Math.abs(cb * ax - sb * az) + b.hl * Math.abs(sb * ax + cb * az);
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    if (!found || overlap < depth - 1e-9) {
      found = true;
      depth = overlap;
      nx = ax;
      nz = az;
      bestDist = dist;
    }
  }
  let sign = bestDist >= 0 ? 1 : -1;
  if (Math.abs(bestDist) < 1e-4) {
    const h = hx * nx + hz * nz;
    sign = h < 0 ? -1 : 1;
  }
  return { depth, nx: nx * sign, nz: nz * sign };
}

/** Parking-sensor bands: [margin around the car (m), beep interval (s)], nearest first. */
export const SENSOR_BANDS = [
  [0.25, 0.09],
  [0.6, 0.22],
  [1.1, 0.45],
] as const;

/** Beep interval of the closest sensor band that touches an obstacle, or 0. */
export function sensorInterval(car: OBB, obstacles: readonly OBB[]): number {
  for (const [margin, interval] of SENSOR_BANDS) {
    const e: OBB = { x: car.x, z: car.z, hw: car.hw + margin, hl: car.hl + margin, rot: car.rot };
    for (const o of obstacles) if (sat(e, o)) return interval;
  }
  return 0;
}

export function corners(o: OBB): Vec[] {
  const [ax, az] = axes(o);
  const out: Vec[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    out.push([o.x + ax[0] * o.hw * sx + az[0] * o.hl * sz, o.z + ax[1] * o.hw * sx + az[1] * o.hl * sz]);
  }
  return out;
}

export function pointInOBB(px: number, pz: number, o: OBB): boolean {
  const [ax, az] = axes(o);
  const dx = px - o.x;
  const dz = pz - o.z;
  const lx = dx * ax[0] + dz * ax[1];
  const lz = dx * az[0] + dz * az[1];
  return Math.abs(lx) <= o.hw && Math.abs(lz) <= o.hl;
}

/**
 * Representative contact point of an overlap between a and b with contact
 * normal n (pointing from b towards a). Uses the deepest corners of a inside
 * b, else the deepest corners of b inside a, averaging corners at (almost) the
 * same depth so flush contacts sit mid-edge and produce no torque. Falls back
 * to a's support point against the normal for edge-edge crossings.
 */
export function contactPoint(a: OBB, b: OBB, n: Contact): Vec {
  const pick = (pts: Vec[], dir: number): Vec | null => {
    let best = Infinity;
    for (const p of pts) best = Math.min(best, dir * (p[0] * n.nx + p[1] * n.nz));
    if (best === Infinity) return null;
    let sx = 0;
    let sz = 0;
    let k = 0;
    for (const p of pts) {
      if (dir * (p[0] * n.nx + p[1] * n.nz) <= best + 0.02) {
        sx += p[0];
        sz += p[1];
        k++;
      }
    }
    return [sx / k, sz / k];
  };
  const eb = expand(b, 1e-4);
  const ea = expand(a, 1e-4);
  const inB = corners(a).filter((p) => pointInOBB(p[0], p[1], eb));
  const pa = pick(inB, 1);
  if (pa) return pa;
  const inA = corners(b).filter((p) => pointInOBB(p[0], p[1], ea));
  const pb = pick(inA, -1);
  if (pb) return pb;
  const r = radius(a, [n.nx, n.nz]);
  return [a.x - n.nx * r, a.z - n.nz * r];
}

export function expand(o: OBB, m: number): OBB {
  return { ...o, hw: o.hw + m, hl: o.hl + m };
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
