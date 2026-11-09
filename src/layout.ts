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
  /** Floor or ramp id this obstacle stands on. Defaults to the first floor. */
  floor?: string;
}

/** An obstacle's footprint plus the floor or ramp it is on. */
export interface LayeredOBB extends OBB {
  layer: string;
}

/** Id of the implicit floor of a level that declares no floors. */
export const DEFAULT_FLOOR = 'ground';

/** A storey: its height and outline (a union of boxes). */
export interface FloorDef {
  id: string;
  y: number;
  area: OBB[];
  /**
   * A landing joins two ramp segments of a curved ramp (a spiral): a surface to
   * stand on, but not a storey the player counts, so it gets no floor number.
   */
  landing?: boolean;
}

/**
 * A ramp joining two floors. Its local +z axis runs from the `from` floor
 * (at -l/2, height of that floor) to the `to` floor (at +l/2).
 */
export interface RampDef {
  id: string;
  from: string;
  to: string;
  x: number;
  z: number;
  rot: number;
  w: number;
  l: number;
}

/** A painted road arrow pointing along `rot` (the same heading convention as a car). */
export interface ArrowDef {
  x: number;
  z: number;
  rot: number;
}

/** A parking bay. rot is the heading the car must face when parked. */
export interface BayDef {
  x: number;
  z: number;
  rot: number;
  w: number;
  l: number;
  /** Floor the car must be on to park here. Defaults to the first floor. */
  floor?: string;
}

/** Seconds to finish in for 3 stars and for 2 stars (0 < three < two < time). */
export interface StarTimes {
  three: number;
  two: number;
}

/** The themed location (world) a level belongs to; see src/worlds.ts. */
export type LocationId = 'open-air' | 'multi-storey' | 'industrial' | 'twilight';

export interface LevelDef {
  /** Permanent id (kebab-case). Saved progress is keyed by it, so never change or reuse one. */
  id: string;
  name: string;
  /** The world this level is listed under. Levels are kept in world order (see `LEVELS`). */
  location: LocationId;
  hint: string;
  lot: { w: number; l: number };
  spawn: { x: number; z: number; rot: number };
  target: BayDef;
  /** If true the car may face either way inside the bay. */
  bothWays: boolean;
  /** Time limit in seconds. Finishing within it earns at least 1 star. */
  time: number;
  /** Star thresholds in seconds; see `starsForTime`. */
  stars: StarTimes;
  obstacles: ObstacleDef[];
  /** Decorative painted bays (lines on three sides, closed at local +z). */
  bays?: BayDef[];
  /** Storeys. Omitted for a flat level: one floor at y = 0 covering the lot. */
  floors?: FloorDef[];
  /** Lighting: `dusk` is a low orange sun, a dim sky and long shadows. Defaults to `day`. */
  theme?: 'day' | 'dusk';
  /** Id of the vehicle the player drives (src/vehicles.ts). Defaults to the hatchback. */
  vehicle?: string;
  /** Painted one-way arrows on the asphalt (decorative: they show the way to drive, they do not block you). */
  arrows?: ArrowDef[];
  /** Ramps joining floors. Their side kerbs and the floor-edge kerbs are generated. */
  ramps?: RampDef[];
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
