// Pure helpers for how a multi-storey level looks and is navigated: floor
// names, the floor-pill hint, ceilings, camera clearance, lighting and which
// floors to draw. No three.js here, so scripts/validate.ts can test them.
import { pointInOBB } from './collision';
import type { FloorDef, LevelDef } from './layout';
import { DEFAULT_FLOOR } from './layout';

/** Thickness of a deck slab (m). Its underside is the ceiling of the floor below. */
export const SLAB = 0.3;
/** Camera stays this far from any surface it would otherwise sit in (m). */
export const CAM_MARGIN = 0.35;
/** Closest the chase camera may get to the car before it gives up pulling in (m). */
export const CAM_MIN_DIST = 1.6;

/** Floors sorted from the lowest. */
function sorted(floors: FloorDef[]): FloorDef[] {
  return [...floors].sort((a, b) => a.y - b.y);
}

/** Short floor name: 'G' for the ground floor, '1', '2' above it, 'B1', 'B2' below. */
export function floorLabel(def: LevelDef, id: string): string {
  const floors = sorted(def.floors ?? []);
  const f = floors.find((x) => x.id === id);
  if (!f) return 'G';
  const ground = floors.find((x) => x.id === DEFAULT_FLOOR)?.y ?? 0;
  if (f.y === ground) return 'G';
  if (f.y > ground) return String(floors.filter((x) => x.y > ground && x.y <= f.y).length);
  return `B${floors.filter((x) => x.y < ground && x.y >= f.y).length}`;
}

/** Sign text painted at a ramp end, e.g. "Level 2 ↑" or "Ground ↓". */
export function rampSignText(def: LevelDef, toId: string, up: boolean): string {
  const l = floorLabel(def, toId);
  return `${l === 'G' ? 'Ground' : l.startsWith('B') ? `Basement ${l.slice(1)}` : `Level ${l}`} ${up ? '↑' : '↓'}`;
}

/** The floor the car is on; a ramp counts as the floor it is nearer to. */
export function floorOfLayer(def: LevelDef, layer: string, y: number): string {
  const floors = def.floors ?? [];
  if (floors.some((f) => f.id === layer)) return layer;
  let best = floors[0]?.id ?? DEFAULT_FLOOR;
  let bestD = Infinity;
  for (const f of floors) {
    const d = Math.abs(f.y - y);
    if (d < bestD) {
      bestD = d;
      best = f.id;
    }
  }
  return best;
}

export interface FloorHud {
  /** Pill text, e.g. "Floor 1", or null for a flat level (no pill). */
  pill: string | null;
  /** Direction to the target floor, or null when already on it. */
  dir: 'up' | 'down' | null;
  /** Hint shown next to the pill, e.g. "▲ Floor 2". */
  hint: string;
}

export function floorHud(def: LevelDef, layer: string, y: number): FloorHud {
  if (!def.floors) return { pill: null, dir: null, hint: '' };
  const here = floorOfLayer(def, layer, y);
  const target = def.target.floor ?? def.floors[0].id;
  const label = (id: string): string => (floorLabel(def, id) === 'G' ? 'Ground' : `Floor ${floorLabel(def, id)}`);
  const pill = `🅿 ${label(here)}`;
  if (here === target) return { pill, dir: null, hint: '' };
  const ty = def.floors.find((f) => f.id === target)?.y ?? 0;
  const up = ty > y;
  return { pill, dir: up ? 'up' : 'down', hint: `${up ? '▲' : '▼'} ${label(target)}` };
}

/** Underside height of the lowest deck above (x, z) that is higher than `y` + clearance, or null if open sky. */
export function ceilingAbove(def: LevelDef, x: number, z: number, y: number): number | null {
  let best: number | null = null;
  for (const f of def.floors ?? []) {
    const under = f.y - SLAB;
    if (under < y + 1.5) continue; // not above the car's roof
    if (!f.area.some((a) => pointInOBB(x, z, a))) continue;
    if (best === null || under < best) best = under;
  }
  return best;
}

/**
 * Where the camera ends up when something blocks the line from the car to the
 * wanted spot. `hit` is the distance to the first surface along that line (or
 * null for a clear line): pull in short of it, but never inside the minimum.
 */
export function clampCameraDistance(
  wanted: number,
  hit: number | null,
  margin = CAM_MARGIN,
  min = CAM_MIN_DIST,
): number {
  if (hit === null || hit >= wanted) return wanted;
  return Math.max(Math.min(min, wanted), hit - margin);
}

export interface LightTarget {
  sun: number;
  hemi: number;
  /** Background / fog brightness 0 (black) .. 1 (sky). */
  sky: number;
}

/** Outdoor sun, covered decks (sun off, flat indoor light), underground (darker still). */
export function lightTarget(covered: boolean, underground: boolean): LightTarget {
  if (underground) return { sun: 0, hemi: 0.75, sky: 0.12 };
  if (covered) return { sun: 0, hemi: 1.25, sky: 0.45 };
  return { sun: 2.2, hemi: 1.1, sky: 1 };
}

/** Whether a floor (height `y`) is drawn: floors above the car vanish in the top-down view. */
export function floorShown(y: number, carY: number, topDown: boolean): boolean {
  return !topDown || y <= carY + 0.5;
}
