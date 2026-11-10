import { corners, expand, pointInOBB, sat, type OBB } from './collision';
import { holdComplete, TOUCH_MIN_SPEED, STEP } from './config';
import { floorProblems, levelObstacles, Surfaces } from './floors';
import { bayOBB, obstacleOBB, type LevelDef } from './layout';
import { evaluateParking } from './parking';
import { isTouch } from './rules';
import { CarPhysics, type Controls } from './physics';
import { vehicleOf, type VehicleDef } from './vehicles';

/** Hold `controls` for `t` seconds. */
export interface Segment extends Controls {
  t: number;
}

export interface SolutionResult {
  /** The car held a valid park for PARK_HOLD seconds. */
  parked: boolean;
  /** Time (s) at which the hold completed, or null if it never did. */
  finishTime: number | null;
  /** Highest new-contact speed (m/s) over the whole run. */
  maxImpact: number;
  /** Number of impacts the game would count as a hit. */
  hits: number;
  /** Steps where the car, grown by the `margin` given to `replaySolution`, overlapped an obstacle: 0 means it never came closer. */
  tight: number;
}

const carBox = (v: VehicleDef, x: number, z: number, rot: number): OBB => ({
  x,
  z,
  hw: v.width / 2,
  hl: v.length / 2,
  rot,
});

/** Static problems with a level's geometry: empty when it is fine. */
export function staticProblems(def: LevelDef): string[] {
  const out: string[] = [];
  const veh = vehicleOf(def.vehicle);
  out.push(...floorProblems(def));
  const surfaces = new Surfaces(def);
  const all = levelObstacles(def, surfaces);
  const t = def.target;

  // Only obstacles on the same floor as the spawn / bay count (a pillar a storey below never blocks).
  const onLayer = (layer: string, x: number, z: number) => surfaces.reachable(layer, x, z, all);
  const spawn = onLayer(surfaces.startLayer, def.spawn.x, def.spawn.z).findIndex((o) =>
    sat(carBox(veh, def.spawn.x, def.spawn.z, def.spawn.rot), o),
  );
  if (spawn >= 0) out.push(`spawn overlaps obstacle #${spawn}`);

  const parked = carBox(veh, t.x, t.z, t.rot);
  const hit = onLayer(t.floor ?? surfaces.startLayer, t.x, t.z).findIndex((o) => sat(parked, o));
  if (hit >= 0) out.push(`target pose overlaps obstacle #${hit}`);

  if (t.w < veh.width || t.l < veh.length)
    out.push(`bay ${t.w}x${t.l} is smaller than the ${veh.name} ${veh.width}x${veh.length}`);
  if (!corners(parked).every(([x, z]) => pointInOBB(x, z, bayOBB(t)))) out.push('car does not fit inside the bay');

  const lot: OBB = { x: 0, z: 0, hw: def.lot.w / 2, hl: def.lot.l / 2, rot: 0 };
  if (!corners(bayOBB(t)).every(([x, z]) => pointInOBB(x, z, lot))) out.push('bay is not inside the lot');
  if (!corners(carBox(veh, def.spawn.x, def.spawn.z, def.spawn.rot)).every(([x, z]) => pointInOBB(x, z, lot)))
    out.push('spawn is not inside the lot');
  out.push(...lotProblems(def, surfaces.startLayer, lot));
  return out;
}

/** Obstacles and painted decorations must lie inside the lot, and obstacles on the same layer must not overlap. */
function lotProblems(def: LevelDef, startLayer: string, lot: OBB): string[] {
  const out: string[] = [];
  const inside = (box: OBB) =>
    corners(box).every(([x, z]) => pointInOBB(x, z, { ...lot, hw: lot.hw + 1e-6, hl: lot.hl + 1e-6 }));
  def.obstacles.forEach((o, i) => {
    if (!inside(obstacleOBB(o))) out.push(`obstacle #${i} is not inside the lot`);
  });
  (def.bays ?? []).forEach((b, i) => {
    if (!inside(bayOBB(b))) out.push(`decorative bay #${i} is not inside the lot`);
  });
  (def.arrows ?? []).forEach((a, i) => {
    if (!inside({ x: a.x, z: a.z, hw: 0, hl: 0, rot: 0 })) out.push(`arrow #${i} is not inside the lot`);
  });
  // Only the level's own obstacles: the generated boundary and edge walls are meant to touch what stands against them.
  const own = def.obstacles.map((o) => ({ ...obstacleOBB(o), layer: o.floor ?? startLayer }));
  for (let i = 0; i < own.length; i++)
    for (let j = i + 1; j < own.length; j++) {
      const [a, b] = [own[i], own[j]];
      if (a.layer !== b.layer || !sat(a, b)) continue;
      // Wall runs may meet at corners and T-joints (neither centre lies inside the other); crossing, stacked or
      // heavily overlapping walls have a centre inside the other, and count like any other overlap.
      const walls = def.obstacles[i].kind === 'wall' && def.obstacles[j].kind === 'wall';
      if (!walls || wallsOverlap(a, b)) out.push(`obstacles #${i} and #${j} overlap`);
    }
  return out;
}

type Pt = [number, number];

/** Clip convex polygon `poly` to the box `box` (Sutherland-Hodgman, orientation independent). */
function clipToBox(poly: Pt[], box: OBB): Pt[] {
  const c = corners(box) as Pt[];
  const mid: Pt = [box.x, box.z];
  let out = poly;
  for (let k = 0; k < c.length && out.length; k++) {
    const p = c[k];
    const q = c[(k + 1) % c.length];
    const side = (v: Pt) => {
      const d = (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
      const m = (q[0] - p[0]) * (mid[1] - p[1]) - (q[1] - p[1]) * (mid[0] - p[0]);
      return d * Math.sign(m);
    };
    const next: Pt[] = [];
    for (let n = 0; n < out.length; n++) {
      const u = out[n];
      const v = out[(n + 1) % out.length];
      const su = side(u);
      const sv = side(v);
      if (su >= 0) next.push(u);
      if (su >= 0 !== sv >= 0) {
        const t = su / (su - sv);
        next.push([u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t]);
      }
    }
    out = next;
  }
  return out;
}

/**
 * Whether two touching wall boxes overlap more than a joint does. Legal joints: corners and T-joints, where the
 * overlap sits at the end of a wall (laneWalls extends corners by 1 m), and butt joints (a sliver along the run).
 * Illegal: near-parallel walls sharing more than 0.15 m of run, and crossings whose overlap is over 2 m from an
 * end of both walls.
 */
function wallsOverlap(a: OBB, b: OBB): boolean {
  const poly = clipToBox(corners(a) as Pt[], b);
  if (poly.length < 3) return false;
  // Long axis, half length and the overlap's extent along it, per wall.
  const along = (w: OBB) => {
    const [ux, uz] = w.hw >= w.hl ? [Math.cos(w.rot), -Math.sin(w.rot)] : [Math.sin(w.rot), Math.cos(w.rot)];
    const half = Math.max(w.hw, w.hl);
    const t = poly.map(([x, z]) => (x - w.x) * ux + (z - w.z) * uz);
    const lo = Math.min(...t);
    const hi = Math.max(...t);
    return { ux, uz, run: hi - lo, endGap: Math.min(lo + half, half - hi) };
  };
  const pa = along(a);
  const pb = along(b);
  const parallel = Math.abs(pa.ux * pb.uz - pa.uz * pb.ux) < 0.1;
  if (parallel) return pa.run > 0.15;
  return pa.endGap > 2 && pb.endGap > 2;
}

/**
 * Replay a scripted solution through the same physics and collision code the
 * game uses. Stops once the park has been held for PARK_HOLD (as the game does).
 * After the last segment the controls are released and the car coasts.
 * `margin` (m) is a clearance the route must keep from every obstacle; see `SolutionResult.tight`.
 */
export function replaySolution(def: LevelDef, segments: Segment[], margin = 0): SolutionResult {
  const surfaces = new Surfaces(def);
  const obstacles = levelObstacles(def, surfaces);
  const car = new CarPhysics(vehicleOf(def.vehicle));
  car.reset(def.spawn.x, def.spawn.z, def.spawn.rot, surfaces);
  let hold = 0;
  let maxImpact = 0;
  let hits = 0;
  let tight = 0;
  let steps = 0;
  const release: Segment = { t: 3, throttle: 0, steer: 0, handbrake: false };
  for (const seg of [...segments, release]) {
    const n = Math.round(seg.t / STEP);
    for (let i = 0; i < n; i++) {
      car.step(STEP, seg, surfaces);
      steps++;
      const impact = car.resolveCollisions(car.reachable(surfaces, obstacles), surfaces);
      maxImpact = Math.max(maxImpact, impact);
      if (isTouch(impact, TOUCH_MIN_SPEED)) hits++;
      if (margin > 0) {
        const grown = expand(car.obb, margin);
        if (car.reachable(surfaces, obstacles).some((o) => sat(grown, o))) tight++;
      }
      // Same bookkeeping as the game loop: the hold drains 3x as fast as it fills.
      hold = evaluateParking(car.obb, car.v, def.target, def.bothWays, car.layer).ok
        ? hold + STEP
        : Math.max(0, hold - STEP * 3);
      if (holdComplete(hold)) return { parked: true, finishTime: steps * STEP, maxImpact, hits, tight };
    }
  }
  return { parked: false, finishTime: null, maxImpact, hits, tight };
}
