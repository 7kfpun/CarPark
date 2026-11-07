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
  return (
    o.hw * Math.abs(a1[0] * ax[0] + a1[1] * ax[1]) +
    o.hl * Math.abs(a2[0] * ax[0] + a2[1] * ax[1])
  );
}

/** Separating-axis test. Returns the minimum-translation contact, or null. */
export function sat(a: OBB, b: OBB): Contact | null {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  let best: Contact | null = null;
  for (const ax of [...axes(a), ...axes(b)]) {
    const dist = dx * ax[0] + dz * ax[1];
    const overlap = radius(a, ax) + radius(b, ax) - Math.abs(dist);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const sign = dist >= 0 ? 1 : -1;
      best = { depth: overlap, nx: ax[0] * sign, nz: ax[1] * sign };
    }
  }
  return best;
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
    out.push([
      o.x + ax[0] * o.hw * sx + az[0] * o.hl * sz,
      o.z + ax[1] * o.hw * sx + az[1] * o.hl * sz,
    ]);
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

export function expand(o: OBB, m: number): OBB {
  return { ...o, hw: o.hw + m, hl: o.hl + m };
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
