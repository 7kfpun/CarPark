// Multi-storey geometry: which layer (floor or ramp) a point is on, how high
// that surface is, and which obstacles the car can touch from there.
// A flat level is one floor ('ground', y = 0), so it needs no description.
import { pointInOBB, type OBB } from './collision';
import { CAR_L, CAR_W, RAMP_MAX_SLOPE, WHEELBASE } from './config';
import {
  allObstacles,
  DEFAULT_FLOOR,
  obstacleOBB,
  type FloorDef,
  type LevelDef,
  type ObstacleDef,
  type RampDef,
  type LayeredOBB,
} from './layout';

/** An obstacle on another layer still blocks the car if its surface is this close (m). */
const LAYER_REACH = 0.5;
const KERB_H = 0.6;
const KERB_T = 0.3;
const EDGE_STEP = 0.25;

/** Local z (along the ramp, 'from' end at -l/2) and x of a point in a ramp's frame. */
function rampLocal(r: RampDef, x: number, z: number): [number, number] {
  const dx = x - r.x;
  const dz = z - r.z;
  const s = Math.sin(r.rot);
  const c = Math.cos(r.rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function rampOBB(r: RampDef): OBB {
  return { x: r.x, z: r.z, hw: r.w / 2, hl: r.l / 2, rot: r.rot };
}

export class Surfaces {
  readonly floors: FloorDef[];
  readonly ramps: RampDef[];
  private readonly floorY = new Map<string, number>();
  private readonly rampById = new Map<string, RampDef>();

  constructor(def: LevelDef) {
    this.floors = def.floors ?? [
      { id: DEFAULT_FLOOR, y: 0, area: [{ x: 0, z: 0, hw: def.lot.w / 2, hl: def.lot.l / 2, rot: 0 }] },
    ];
    this.ramps = def.ramps ?? [];
    for (const f of this.floors) this.floorY.set(f.id, f.y);
    for (const r of this.ramps) this.rampById.set(r.id, r);
  }

  /** The layer a level's spawn is on. */
  get startLayer(): string {
    return this.floors[0].id;
  }

  /** Height of a floor, or null if the id is a ramp or unknown. */
  floorHeight(id: string): number | null {
    return this.floorY.get(id) ?? null;
  }

  rampSlope(r: RampDef): number {
    const rise = this.endY(r.to) - this.endY(r.from);
    return Math.atan2(Math.abs(rise), r.l);
  }

  private endY(floor: string): number {
    return this.floorY.get(floor) ?? 0;
  }

  private rampHeight(r: RampDef, x: number, z: number): number {
    const [, lz] = rampLocal(r, x, z);
    const t = Math.max(0, Math.min(1, (lz + r.l / 2) / r.l));
    const y0 = this.endY(r.from);
    return y0 + (this.endY(r.to) - y0) * t;
  }

  /** Surface height at (x, z) for something travelling on `layer`. */
  heightAt(layer: string, x: number, z: number): number {
    const own = this.rampById.get(layer);
    if (own) return this.rampHeight(own, x, z);
    for (const r of this.ramps) {
      if ((r.from === layer || r.to === layer) && pointInOBB(x, z, rampOBB(r))) return this.rampHeight(r, x, z);
    }
    return this.endY(layer);
  }

  /**
   * The layer after the rear axle moved to (x, z). A floor hands over to a
   * ramp when the axle crosses the ramp's end line onto it, and a ramp hands
   * over to the floor at the end the axle leaves by.
   */
  layerAfter(layer: string, rx: number, rz: number): string {
    const ramp = this.rampById.get(layer);
    if (ramp) {
      const [, lz] = rampLocal(ramp, rx, rz);
      if (lz < -ramp.l / 2) return ramp.from;
      if (lz > ramp.l / 2) return ramp.to;
      return layer;
    }
    for (const r of this.ramps) {
      if ((r.from === layer || r.to === layer) && pointInOBB(rx, rz, rampOBB(r))) return r.id;
    }
    return layer;
  }

  /** Obstacles the car can hit from `layer` at (x, z): its own layer, plus
   * neighbours whose surface is level with it there (a ramp's foot, a pillar
   * at the ramp's top). A pillar a storey below never blocks. */
  reachable(layer: string, x: number, z: number, obstacles: LayeredOBB[]): LayeredOBB[] {
    const here = this.heightAt(layer, x, z);
    return obstacles.filter((o) => o.layer === layer || Math.abs(this.heightAt(o.layer, x, z) - here) <= LAYER_REACH);
  }

  /** Kerb walls along every floor edge that isn't open to the same floor or a ramp, and along both ramp sides. */
  edgeWalls(): ObstacleDef[] {
    const out: ObstacleDef[] = [];
    for (const f of this.floors) {
      for (const [ai, a] of f.area.entries()) {
        const others = f.area.filter((_, i) => i !== ai);
        const ramps = this.ramps.filter((r) => r.from === f.id || r.to === f.id).map(rampOBB);
        for (const side of [0, 1, 2, 3]) out.push(...this.sideWalls(f.id, a, side, [...others, ...ramps]));
      }
    }
    for (const r of this.ramps) {
      for (const sx of [-1, 1]) {
        const [sin, cos] = [Math.sin(r.rot), Math.cos(r.rot)];
        const off = sx * (r.w / 2 + KERB_T / 2);
        out.push({
          kind: 'wall',
          x: r.x + cos * off,
          z: r.z - sin * off,
          rot: r.rot,
          w: KERB_T,
          l: r.l,
          h: KERB_H,
          floor: r.id,
        });
      }
    }
    return out;
  }

  /** Walls for the parts of one side of an area OBB not covered by `open`. side: 0/1 = +x/-x, 2/3 = +z/-z. */
  private sideWalls(floor: string, a: OBB, side: number, open: OBB[]): ObstacleDef[] {
    const alongX = side < 2; // wall runs along local z
    const sign = side % 2 === 0 ? 1 : -1;
    const len = alongX ? a.hl * 2 : a.hw * 2;
    const [sin, cos] = [Math.sin(a.rot), Math.cos(a.rot)];
    // Local -> world.
    const world = (lx: number, lz: number): [number, number] => [a.x + lx * cos + lz * sin, a.z - lx * sin + lz * cos];
    const n = Math.max(1, Math.round(len / EDGE_STEP));
    const walls: ObstacleDef[] = [];
    let start = -1;
    const flush = (end: number): void => {
      if (start < 0) return;
      const t0 = -len / 2 + (start / n) * len;
      const t1 = -len / 2 + (end / n) * len;
      const mid = (t0 + t1) / 2;
      const outward = (alongX ? a.hw : a.hl) * sign + (sign * KERB_T) / 2;
      const [wx, wz] = alongX ? world(outward, mid) : world(mid, outward);
      walls.push({
        kind: 'wall',
        x: wx,
        z: wz,
        rot: a.rot,
        w: alongX ? KERB_T : t1 - t0,
        l: alongX ? t1 - t0 : KERB_T,
        h: KERB_H,
        floor,
      });
      start = -1;
    };
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + ((i + 0.5) / n) * len;
      const probe = (alongX ? a.hw : a.hl) * sign + sign * 0.05;
      const [px, pz] = alongX ? world(probe, t) : world(t, probe);
      const covered = open.some((o) => pointInOBB(px, pz, o));
      if (covered) flush(i);
      else if (start < 0) start = i;
    }
    flush(n);
    return walls;
  }
}

/** Every obstacle of a level with its layer: the declared ones plus the generated kerbs (or the lot walls of a flat level). */
export function levelObstacleDefs(def: LevelDef, surfaces: Surfaces): ObstacleDef[] {
  return def.floors ? [...def.obstacles, ...surfaces.edgeWalls()] : allObstacles(def);
}

export function levelObstacles(def: LevelDef, surfaces: Surfaces): LayeredOBB[] {
  return levelObstacleDefs(def, surfaces).map((o) => ({ ...obstacleOBB(o), layer: o.floor ?? surfaces.startLayer }));
}

/** Problems with a level's floors and ramps (empty when fine). */
export function floorProblems(def: LevelDef): string[] {
  const s = new Surfaces(def);
  const out: string[] = [];
  const ids = new Set<string>();
  if (def.floors && def.floors[0]?.id !== DEFAULT_FLOOR) out.push(`the first floor must have id '${DEFAULT_FLOOR}'`);
  for (const id of [...s.floors.map((f) => f.id), ...s.ramps.map((r) => r.id)]) {
    if (ids.has(id)) out.push(`duplicate floor/ramp id ${id}`);
    ids.add(id);
  }
  for (const r of s.ramps) {
    for (const end of [r.from, r.to])
      if (s.floorHeight(end) === null) out.push(`ramp ${r.id} joins unknown floor ${end}`);
    if (s.rampSlope(r) > RAMP_MAX_SLOPE + 1e-9)
      out.push(`ramp ${r.id} is ${((s.rampSlope(r) * 180) / Math.PI).toFixed(1)} deg, over the limit`);
    if (r.w < CAR_W || r.l < CAR_L + WHEELBASE) out.push(`ramp ${r.id} is too small for the car`);
  }
  for (const o of def.obstacles) {
    if (o.floor !== undefined && !ids.has(o.floor)) out.push(`obstacle on unknown layer ${o.floor}`);
  }
  if (def.target.floor !== undefined && !ids.has(def.target.floor)) out.push('target bay on unknown floor');
  return out;
}
