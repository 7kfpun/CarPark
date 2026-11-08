import type { OBB } from './collision';
import { CAR_L, CAR_W } from './config';

export type ObstacleKind = 'car' | 'wall' | 'cone' | 'pillar';

export interface ObstacleDef {
  kind: ObstacleKind;
  x: number;
  z: number;
  rot?: number;
  w?: number;
  l?: number;
  h?: number;
  color?: number;
  /** Parked cars: which car model to show (index into the model list). */
  variant?: number;
}

/** A parking bay. rot is the heading the car must face when parked. */
export interface BayDef {
  x: number;
  z: number;
  rot: number;
  w: number;
  l: number;
}

export interface LevelDef {
  /** Permanent id (kebab-case). Saved progress is keyed by it, so never change or reuse one. */
  id: string;
  name: string;
  hint: string;
  lot: { w: number; l: number };
  spawn: { x: number; z: number; rot: number };
  target: BayDef;
  /** If true the car may face either way inside the bay. */
  bothWays: boolean;
  time: number;
  par: number;
  obstacles: ObstacleDef[];
  /** Decorative painted bays (lines on three sides, closed at local +z). */
  bays?: BayDef[];
}

export function obstacleDims(o: ObstacleDef): { w: number; l: number; h: number } {
  switch (o.kind) {
    case 'car':
      return { w: CAR_W, l: CAR_L, h: 1.5 };
    case 'cone':
      return { w: 0.5, l: 0.5, h: 0.75 };
    case 'pillar':
      return { w: o.w ?? 0.8, l: o.l ?? 0.8, h: o.h ?? 3 };
    case 'wall':
      return { w: o.w ?? 1, l: o.l ?? 1, h: o.h ?? 1.2 };
  }
}

export function obstacleOBB(o: ObstacleDef): OBB {
  const d = obstacleDims(o);
  return { x: o.x, z: o.z, hw: d.w / 2, hl: d.l / 2, rot: o.rot ?? 0 };
}

const BORDER = 0.6;

export function boundaryWalls(lot: { w: number; l: number }): ObstacleDef[] {
  const hw = lot.w / 2;
  const hl = lot.l / 2;
  const h = 0.6;
  return [
    { kind: 'wall', x: 0, z: hl + BORDER / 2, w: lot.w + BORDER * 2, l: BORDER, h },
    { kind: 'wall', x: 0, z: -hl - BORDER / 2, w: lot.w + BORDER * 2, l: BORDER, h },
    { kind: 'wall', x: hw + BORDER / 2, z: 0, w: BORDER, l: lot.l, h },
    { kind: 'wall', x: -hw - BORDER / 2, z: 0, w: BORDER, l: lot.l, h },
  ];
}

export function allObstacles(def: LevelDef): ObstacleDef[] {
  return [...def.obstacles, ...boundaryWalls(def.lot)];
}

export function bayOBB(b: BayDef): OBB {
  return { x: b.x, z: b.z, hw: b.w / 2, hl: b.l / 2, rot: b.rot };
}
