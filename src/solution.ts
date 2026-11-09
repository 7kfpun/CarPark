import { corners, pointInOBB, sat, type OBB } from './collision';
import { CAR_L, CAR_W, TOUCH_MIN_SPEED, PARK_HOLD, STEP } from './config';
import { floorProblems, levelObstacles, Surfaces } from './floors';
import { bayOBB, type LevelDef } from './layout';
import { evaluateParking } from './parking';
import { isTouch } from './rules';
import { CarPhysics, type Controls } from './physics';

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
}

const carBox = (x: number, z: number, rot: number): OBB => ({ x, z, hw: CAR_W / 2, hl: CAR_L / 2, rot });

/** Static problems with a level's geometry: empty when it is fine. */
export function staticProblems(def: LevelDef): string[] {
  const out: string[] = [];
  out.push(...floorProblems(def));
  const surfaces = new Surfaces(def);
  const all = levelObstacles(def, surfaces);
  const t = def.target;

  // Only obstacles on the same floor as the spawn / bay count (a pillar a storey below never blocks).
  const onLayer = (layer: string, x: number, z: number) => surfaces.reachable(layer, x, z, all);
  const spawn = onLayer(surfaces.startLayer, def.spawn.x, def.spawn.z).findIndex((o) =>
    sat(carBox(def.spawn.x, def.spawn.z, def.spawn.rot), o),
  );
  if (spawn >= 0) out.push(`spawn overlaps obstacle #${spawn}`);

  const parked = carBox(t.x, t.z, t.rot);
  const hit = onLayer(t.floor ?? surfaces.startLayer, t.x, t.z).findIndex((o) => sat(parked, o));
  if (hit >= 0) out.push(`target pose overlaps obstacle #${hit}`);

  if (t.w < CAR_W || t.l < CAR_L) out.push(`bay ${t.w}x${t.l} is smaller than the car ${CAR_W}x${CAR_L}`);
  if (!corners(parked).every(([x, z]) => pointInOBB(x, z, bayOBB(t)))) out.push('car does not fit inside the bay');

  const lot: OBB = { x: 0, z: 0, hw: def.lot.w / 2, hl: def.lot.l / 2, rot: 0 };
  if (!corners(bayOBB(t)).every(([x, z]) => pointInOBB(x, z, lot))) out.push('bay is not inside the lot');
  if (!corners(carBox(def.spawn.x, def.spawn.z, def.spawn.rot)).every(([x, z]) => pointInOBB(x, z, lot)))
    out.push('spawn is not inside the lot');
  return out;
}

/**
 * Replay a scripted solution through the same physics and collision code the
 * game uses. Stops once the park has been held for PARK_HOLD (as the game does).
 * After the last segment the controls are released and the car coasts.
 */
export function replaySolution(def: LevelDef, segments: Segment[]): SolutionResult {
  const surfaces = new Surfaces(def);
  const obstacles = levelObstacles(def, surfaces);
  const car = new CarPhysics();
  car.reset(def.spawn.x, def.spawn.z, def.spawn.rot, surfaces);
  let hold = 0;
  let maxImpact = 0;
  let hits = 0;
  let steps = 0;
  const release: Segment = { t: 3, throttle: 0, steer: 0, handbrake: false };
  for (const seg of [...segments, release]) {
    const n = Math.round(seg.t / STEP);
    for (let i = 0; i < n; i++) {
      car.step(STEP, seg, surfaces);
      steps++;
      const impact = car.resolveCollisions(car.reachable(surfaces, obstacles));
      maxImpact = Math.max(maxImpact, impact);
      if (isTouch(impact, TOUCH_MIN_SPEED)) hits++;
      // Same bookkeeping as the game loop: the hold drains 3x as fast as it fills.
      hold = evaluateParking(car.obb, car.v, def.target, def.bothWays, car.layer).ok
        ? hold + STEP
        : Math.max(0, hold - STEP * 3);
      if (hold >= PARK_HOLD - 1e-9) return { parked: true, finishTime: steps * STEP, maxImpact, hits };
    }
  }
  return { parked: false, finishTime: null, maxImpact, hits };
}
