// Parking-lot scenery layout: pure data, no three.js. level.ts turns each list into one InstancedMesh.
// Everything here is decoration: it never adds a collision shape, and everything that stands up lies
// outside the lot walls (see `detailProblems`).
import type { ArrowDef, BayDef } from './layout';

export interface Spot {
  x: number;
  z: number;
  rot: number;
}
export interface Tree extends Spot {
  scale: number;
}
export interface Wear extends Spot {
  w: number;
  l: number;
}
export interface Detail {
  trees: Tree[];
  /** Light poles (the lamp arm points at +z of `rot`, i.e. over the lot). */
  poles: Spot[];
  /** Fence posts; `rails` are the horizontal bars between them. */
  posts: Spot[];
  rails: (Spot & { l: number })[];
  bollards: Spot[];
  /** Storm drains flush with the asphalt, just inside the lot walls. */
  drains: Spot[];
  /** Scuffed patches over the painted lines and arrows. */
  wear: Wear[];
}

/** Lot walls are 0.3 m thick (src/floors.ts); the kerb apron and everything standing starts beyond them. */
export const WALL_T = 0.3;
export const APRON_W = 1.4;
export const FENCE_OFFSET = WALL_T + APRON_W + 0.6;
export const POST_STEP = 3;

/** Deterministic RNG so decoration is stable per level. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export interface DetailInput {
  lot: { w: number; l: number };
  bays?: BayDef[];
  arrows?: ArrowDef[];
}

/** Trees around the lot (same placement as before the instancing change). */
function trees(lot: { w: number; l: number }, index: number): Tree[] {
  const { w, l } = lot;
  const rand = rng(1234 + index * 97);
  const out: Tree[] = [];
  for (let i = 0; i < 60; i++) {
    const side = Math.floor(rand() * 4);
    const along = (rand() - 0.5) * (side < 2 ? w + 30 : l + 30);
    const dist = 4 + rand() * 14;
    out.push({
      x: side < 2 ? along : (side === 2 ? 1 : -1) * (w / 2 + dist),
      z: side < 2 ? (side === 0 ? 1 : -1) * (l / 2 + dist) : along,
      rot: 0,
      scale: 0.7 + rand() * 0.7,
    });
  }
  return out;
}

function wear(def: DetailInput, index: number): Wear[] {
  const rand = rng(777 + index * 31);
  const out: Wear[] = [];
  for (const b of def.bays ?? []) {
    const [sin, cos] = [Math.sin(b.rot), Math.cos(b.rot)];
    for (let i = 0; i < 3; i++) {
      // A scuff on one of the three painted sides, in the bay's local frame.
      const side = Math.floor(rand() * 3);
      const along = (rand() - 0.5) * 0.8;
      const [lx, lz, w, l] =
        side === 2
          ? [along * b.w, b.l / 2, 0.3 + rand() * 0.5, 0.2]
          : [(side === 0 ? -1 : 1) * (b.w / 2), along * b.l, 0.2, 0.3 + rand() * 0.6];
      out.push({ x: b.x + lx * cos + lz * sin, z: b.z - lx * sin + lz * cos, rot: b.rot, w, l });
    }
  }
  for (const a of def.arrows ?? []) {
    for (let i = 0; i < 4; i++) {
      const lx = (rand() - 0.5) * 1.4;
      const lz = (rand() - 0.5) * 3;
      const [sin, cos] = [Math.sin(a.rot), Math.cos(a.rot)];
      out.push({
        x: a.x + lx * cos + lz * sin,
        z: a.z - lx * sin + lz * cos,
        rot: a.rot,
        w: 0.25 + rand() * 0.4,
        l: 0.25 + rand() * 0.5,
      });
    }
  }
  return out;
}

/** Layout of the scenery of a flat lot; multi-storey levels only get trees and wear (`flat: false`). */
export function detailLayout(def: DetailInput, index: number, flat: boolean): Detail {
  const { w, l } = def.lot;
  const d: Detail = {
    trees: trees(def.lot, index),
    poles: [],
    posts: [],
    rails: [],
    bollards: [],
    drains: [],
    wear: wear(def, index),
  };
  if (!flat) return d;
  const hx = w / 2 + FENCE_OFFSET;
  const hz = l / 2 + FENCE_OFFSET;
  // Fence: posts every ~3 m round the rectangle, a rail between each pair.
  const side = (x0: number, z0: number, x1: number, z1: number, rot: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / POST_STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (i < n) d.posts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rot });
      if (i < n) {
        const m = (i + 0.5) / n;
        d.rails.push({ x: x0 + (x1 - x0) * m, z: z0 + (z1 - z0) * m, rot, l: len / n });
      }
    }
  };
  side(-hx, -hz, hx, -hz, Math.PI / 2);
  side(hx, -hz, hx, hz, 0);
  side(hx, hz, -hx, hz, Math.PI / 2);
  side(-hx, hz, -hx, -hz, 0);
  // Light poles: just inside the fence, on the long sides; the arm reaches over the lot.
  const px = w / 2 + WALL_T + APRON_W / 2;
  const pz = l / 2 + WALL_T + APRON_W / 2;
  const nz = Math.max(1, Math.round(l / 14));
  for (let i = 0; i < nz; i++) {
    const z = ((i + 0.5) / nz - 0.5) * l;
    d.poles.push({ x: px, z, rot: -Math.PI / 2 }, { x: -px, z, rot: Math.PI / 2 });
  }
  if (w >= 24) d.poles.push({ x: 0, z: pz, rot: Math.PI }, { x: 0, z: -pz, rot: 0 });
  // Bollards at the lot corners, on the apron.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.bollards.push({ x: sx * px, z: sz * pz, rot: 0 });
  // Drains along the two long walls, just inside the lot.
  const nd = Math.max(1, Math.round(l / 10));
  for (let i = 0; i < nd; i++) {
    const z = ((i + 0.5) / nd - 0.5) * l;
    d.drains.push({ x: w / 2 - 0.35, z, rot: 0 }, { x: -w / 2 + 0.35, z, rot: 0 });
  }
  return d;
}

/** Things wrong with a layout: standing detail inside the lot, or wear off the asphalt. Empty when fine. */
export function detailProblems(def: DetailInput, d: Detail): string[] {
  const { w, l } = def.lot;
  const inside = (s: Spot, margin: number): boolean => Math.abs(s.x) < w / 2 + margin && Math.abs(s.z) < l / 2 + margin;
  const out: string[] = [];
  const standing: [string, Spot[]][] = [
    ['pole', d.poles],
    ['post', d.posts],
    ['bollard', d.bollards],
    ['tree', d.trees],
  ];
  for (const [name, list] of standing)
    if (list.some((s) => inside(s, WALL_T))) out.push(`${name} inside the lot walls`);
  if (d.wear.some((s) => !inside(s, 0.6))) out.push('wear off the lot');
  return out;
}
