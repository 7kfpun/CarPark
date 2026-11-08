// Sanity checks for level geometry and car physics. Run: npm run validate
import { corners, sat, sensorInterval, type Contact, type OBB } from '../src/collision';
import { CAR_L, CAR_W, HIT_COOLDOWN, HIT_MIN_SPEED, MAX_FWD, MAX_REV, STEP } from '../src/config';
import { deadzone, pickNeighbor, steerFromOffset, strongest } from '../src/input';
import { allObstacles, obstacleOBB } from '../src/layout';
import { LEVELS } from '../src/levels';
import { evaluateParking } from '../src/parking';
import { CarPhysics } from '../src/physics';
import { buildVersion } from './version';
import { loadProgress, parseProgress, recordWin, resumeIndex, V1_LEVEL_IDS } from '../src/progress';

declare const process: { exit(code: number): never };

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.log('  FAIL', msg);
  }
}

const carBox = (x: number, z: number, rot: number): OBB => ({ x, z, hw: CAR_W / 2, hl: CAR_L / 2, rot });

for (const [i, lvl] of LEVELS.entries()) {
  console.log(`Level ${i + 1}: ${lvl.name}`);
  const obs = allObstacles(lvl).map(obstacleOBB);
  const spawn = carBox(lvl.spawn.x, lvl.spawn.z, lvl.spawn.rot);
  check(
    obs.every((o) => !sat(spawn, o)),
    'spawn overlaps an obstacle',
  );

  const t = lvl.target;
  const parked = carBox(t.x, t.z, t.rot);
  const hit = obs.findIndex((o) => sat(parked, o));
  check(hit < 0, `target pose overlaps obstacle #${hit}`);
  check(evaluateParking(parked, 0, t, lvl.bothWays).ok, 'centred target pose is not a valid park');
  check(!evaluateParking(parked, 2, t, lvl.bothWays).ok, 'moving car counted as parked');
  const flipped = carBox(t.x, t.z, t.rot + Math.PI);
  check(evaluateParking(flipped, 0, t, lvl.bothWays).ok === lvl.bothWays, 'reverse orientation rule wrong');
  const off = carBox(t.x + t.w, t.z, t.rot);
  check(!evaluateParking(off, 0, t, lvl.bothWays).ok, 'car outside bay counted as parked');

  // Free space around the bay: car should have >= 0.3m clearance sideways.
  const side = carBox(t.x, t.z, t.rot);
  side.hw += 0.3;
  check(
    obs.every((o) => !sat(side, o)),
    'less than 0.3m side clearance at target',
  );
}

console.log('Physics');
const p = new CarPhysics();
p.reset(0, 0, 0);
for (let i = 0; i < 360; i++) p.step(STEP, { throttle: 1, steer: 0, handbrake: false });
check(
  p.v > 0.9 * MAX_FWD && Math.abs(p.x) < 1e-6 && p.z > 3.5,
  `straight acceleration (v=${p.v.toFixed(2)}, z=${p.z.toFixed(2)})`,
);
const h0 = p.heading;
for (let i = 0; i < 60; i++) p.step(STEP, { throttle: 0, steer: 1, handbrake: false });
check(p.heading < h0, 'steer right while moving forward should decrease heading');
for (let i = 0; i < 600; i++) p.step(STEP, { throttle: 0, steer: 0, handbrake: true });
check(p.v === 0, 'handbrake stops car');
for (let i = 0; i < 240; i++) p.step(STEP, { throttle: -1, steer: 0, handbrake: false });
check(p.v < -0.8 * MAX_REV, 'reverse works');

console.log('Drive-through (level 1)');
{
  const lvl = LEVELS[0];
  const obs = allObstacles(lvl).map(obstacleOBB);
  const car = new CarPhysics();
  car.reset(lvl.spawn.x, lvl.spawn.z, lvl.spawn.rot);
  let maxImpact = 0;
  let parkedFor = 0;
  for (let i = 0; i < 120 * 30 && parkedFor < 1; i++) {
    const dist = lvl.target.z - car.z;
    const want = Math.min(4, Math.sqrt(Math.max(0, 2 * 6 * dist)));
    const throttle = car.v < want - 0.2 ? 1 : car.v > want + 0.2 ? -1 : 0;
    car.step(STEP, { throttle, steer: 0, handbrake: dist < 0.3 });
    maxImpact = Math.max(maxImpact, car.resolveCollisions(obs));
    parkedFor = evaluateParking(car.obb, car.v, lvl.target, lvl.bothWays).ok ? parkedFor + STEP : 0;
  }
  check(maxImpact === 0, `hit something on the way in (impact ${maxImpact.toFixed(2)})`);
  check(parkedFor >= 1, `did not end parked (z=${car.z.toFixed(2)}, v=${car.v.toFixed(2)})`);

  // Reverse full speed into the back boundary wall.
  car.reset(lvl.spawn.x, lvl.spawn.z, lvl.spawn.rot);
  maxImpact = 0;
  for (let i = 0; i < 120 * 6; i++) {
    car.step(STEP, { throttle: -1, steer: 0, handbrake: false });
    maxImpact = Math.max(maxImpact, car.resolveCollisions(obs));
  }
  check(maxImpact > 1, 'reversing into wall should register an impact');
  check(car.z - CAR_L / 2 >= -lvl.lot.l / 2 - 0.01, `car pushed through the wall (z=${car.z.toFixed(2)})`);
}

console.log('Input mapping');
check(deadzone(0.05, 0.1) === 0 && deadzone(-0.1, 0.1) === 0, 'dead zone should swallow small values');
check(deadzone(1, 0.1) === 1 && deadzone(-2, 0.1) === -1, 'dead zone output should reach and clamp to ±1');
check(Math.abs(deadzone(0.55, 0.1) - 0.5) < 1e-9, 'dead zone should rescale linearly');
check(
  strongest(1, -0.4) === 1 && strongest(0.2, -0.7, 0) === -0.7 && strongest() === 0,
  'strongest picks largest magnitude',
);
check(steerFromOffset(0) === 0 && steerFromOffset(2) === 0, 'tiny finger jitter should not steer');
check(steerFromOffset(500) === 1 && steerFromOffset(-500) === -1, 'big drag should give full lock');
check(steerFromOffset(30) > 0 && steerFromOffset(30) < 1, 'partial drag should give partial steer');
{
  // 3x2 grid of 10px boxes with 2px gaps, plus a lone row of two modal buttons.
  const box = (c: number, r: number) => ({ left: c * 12, top: r * 12, right: c * 12 + 10, bottom: r * 12 + 10 });
  const grid = [box(0, 0), box(1, 0), box(2, 0), box(0, 1), box(1, 1), box(2, 1)];
  check(
    pickNeighbor(null, grid, 'right') === 0 && pickNeighbor(null, grid, 'left') === 5,
    'nav with no focus enters the list',
  );
  check(
    pickNeighbor(grid[0], grid, 'right') === 1 && pickNeighbor(grid[1], grid, 'left') === 0,
    'nav moves along a row',
  );
  check(
    pickNeighbor(grid[1], grid, 'down') === 4 && pickNeighbor(grid[4], grid, 'up') === 1,
    'nav moves down/up a column',
  );
  check(
    pickNeighbor(grid[2], grid, 'right') === -1 && pickNeighbor(grid[0], grid, 'up') === -1,
    'nav stops at the edges',
  );
  check(pickNeighbor(grid[2], grid, 'down') === 5, 'nav down keeps the column');
  check(pickNeighbor(grid[0], [], 'down') === -1, 'nav with no buttons finds nothing');
}

console.log('Broad phase');
{
  // The allocation-free SAT must match the original array-based version.
  const refAxes = (o: OBB): [number, number][] => [
    [Math.cos(o.rot), -Math.sin(o.rot)],
    [Math.sin(o.rot), Math.cos(o.rot)],
  ];
  const refRadius = (o: OBB, ax: [number, number]): number => {
    const [a1, a2] = refAxes(o);
    return o.hw * Math.abs(a1[0] * ax[0] + a1[1] * ax[1]) + o.hl * Math.abs(a2[0] * ax[0] + a2[1] * ax[1]);
  };
  const refSat = (a: OBB, b: OBB, hx: number, hz: number): Contact | null => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    let best: Contact | null = null;
    let bestDist = 0;
    for (const ax of [...refAxes(a), ...refAxes(b)]) {
      const dist = dx * ax[0] + dz * ax[1];
      const overlap = refRadius(a, ax) + refRadius(b, ax) - Math.abs(dist);
      if (overlap <= 0) return null;
      if (!best || overlap < best.depth - 1e-9) {
        best = { depth: overlap, nx: ax[0], nz: ax[1] };
        bestDist = dist;
      }
    }
    if (!best) return null;
    let sign = bestDist >= 0 ? 1 : -1;
    if (Math.abs(bestDist) < 1e-4) sign = hx * best.nx + hz * best.nz < 0 ? -1 : 1;
    return { depth: best.depth, nx: best.nx * sign, nz: best.nz * sign };
  };
  let seed = 12345;
  const rnd = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let mismatches = 0;
  let hits = 0;
  for (let i = 0; i < 20000; i++) {
    const a: OBB = {
      x: rnd() * 8 - 4,
      z: rnd() * 8 - 4,
      hw: 0.2 + rnd() * 2,
      hl: 0.2 + rnd() * 3,
      rot: rnd() * 7 - 3.5,
    };
    const b: OBB = {
      x: rnd() * 8 - 4,
      z: rnd() * 8 - 4,
      hw: 0.2 + rnd() * 2,
      hl: 0.2 + rnd() * 3,
      rot: rnd() * 7 - 3.5,
    };
    const want = refSat(a, b, 0.3, -0.7);
    const got = sat(a, b, 0.3, -0.7);
    if (want) hits++;
    const same =
      (!want && !got) ||
      (!!want &&
        !!got &&
        Math.abs(want.depth - got.depth) < 1e-9 &&
        Math.abs(want.nx - got.nx) < 1e-9 &&
        Math.abs(want.nz - got.nz) < 1e-9);
    if (!same) mismatches++;
  }
  check(hits > 2000 && hits < 18000, `SAT equivalence sample should mix hits and misses (${hits}/20000)`);
  check(mismatches === 0, `SAT differs from the reference in ${mismatches} cases`);

  const far: OBB = { x: 50, z: 50, hw: 1, hl: 1, rot: 0.4 };
  check(sat(carBox(0, 0, 0), far) === null, 'far obstacle should be rejected');

  // Parking sensor bands: nearest band wins, nothing in range gives 0.
  const wall: OBB = { x: 0, z: 0, hw: 5, hl: 0.1, rot: 0 };
  const gap = (g: number): number => sensorInterval(carBox(0, -(CAR_L / 2 + 0.1 + g), 0), [wall]);
  check(gap(0.1) === 0.09, 'sensor: 0.1 m gap should use the fastest band');
  check(gap(0.4) === 0.22, 'sensor: 0.4 m gap should use the middle band');
  check(gap(0.9) === 0.45, 'sensor: 0.9 m gap should use the slowest band');
  check(gap(1.5) === 0 && sensorInterval(carBox(0, -40, 0), [wall]) === 0, 'sensor: nothing in range should be 0');
}

console.log('Collision response');
{
  // SAT normal with coincident centres follows the hint (push against motion).
  const slab: OBB = { x: 0, z: 0, hw: 3, hl: 0.3, rot: 0 };
  const back = sat(carBox(0, 0, 0), slab, 0, -1);
  const fwd = sat(carBox(0, 0, 0), slab, 0, 1);
  check(!!back && back.nz === -1 && !!fwd && fwd.nz === 1, 'SAT normal ignores the hint when centres coincide');
  const off = sat(carBox(0, 0.5, 0), slab, 0, -1);
  check(!!off && off.nz === 1, 'SAT normal must follow the centre offset when it is clear');
  // A long wall whose near face lies on z = 10, and a run loop that records
  // per-step impact, speed and heading. Hits are counted like main.ts does.
  const WALL_Z = 10;
  const wall: OBB = { x: 0, z: WALL_Z + 0.3, hw: 60, hl: 0.3, rot: 0 };
  interface Trace {
    impact: number[];
    v: number[];
    heading: number[];
    z: number[];
    hits: number;
    firstContact: number;
    maxFront: number;
  }
  const run = (car: CarPhysics, obs: OBB[], seconds: number, throttle: number, steer = 0): Trace => {
    const t: Trace = { impact: [], v: [], heading: [], z: [], hits: 0, firstContact: -1, maxFront: -Infinity };
    let cooldown = 0;
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      cooldown = Math.max(0, cooldown - STEP);
      car.step(STEP, { throttle, steer, handbrake: false });
      const imp = car.resolveCollisions(obs);
      if (imp > 0 && t.firstContact < 0) t.firstContact = i;
      if (imp > HIT_MIN_SPEED && cooldown === 0) {
        t.hits++;
        cooldown = HIT_COOLDOWN;
      }
      t.impact.push(imp);
      t.v.push(car.v);
      t.heading.push(car.heading);
      t.z.push(car.z);
      t.maxFront = Math.max(t.maxFront, ...corners(car.obb).map((c) => c[1]));
    }
    return t;
  };
  const settle = Math.round(HIT_COOLDOWN / STEP); // steps after first contact
  const maxOf = (a: number[]) => a.reduce((m, x) => Math.max(m, x), -Infinity);
  const minOf = (a: number[]) => a.reduce((m, x) => Math.min(m, x), Infinity);

  // Baseline: full speed head-on into the wall reports (almost) the full speed.
  const car = new CarPhysics();
  car.reset(0, WALL_Z - CAR_L / 2 - 1, 0);
  car.v = MAX_FWD;
  const head = run(car, [wall], 1, 1);
  const headOn = maxOf(head.impact);
  check(headOn > 0.9 * MAX_FWD, `head-on impact should be ~full speed (${headOn.toFixed(2)})`);
  check(head.maxFront <= WALL_Z + 0.01, `head-on: car pushed into the wall (front z=${head.maxFront.toFixed(3)})`);
  check(head.v[head.firstContact] < 0, 'head-on: car should bounce back');

  // (b) Full speed at 10 degrees into the wall: the impact is the normal
  // component, v*sin(10deg) = 0.17*v (~1.6 m/s): still a real scrape at
  // 32 km/h, so it may cost a heart once, but it must be far below head-on
  // (< 25%). The car then aligns with the wall and slides on, keeping most of
  // its speed (> 60%, friction takes ~10%), and holding throttle against it
  // never registers another hit after the first contact has settled.
  const ang = (10 * Math.PI) / 180;
  car.reset(0, WALL_Z - CAR_L / 2 - 1, Math.PI / 2 - ang);
  car.v = MAX_FWD;
  const g = run(car, [wall], 3, 1);
  const glance = maxOf(g.impact);
  const after = g.impact.slice(g.firstContact + settle);
  const slide = g.v.slice(g.firstContact, g.firstContact + settle);
  console.log(
    `  head-on ${headOn.toFixed(2)} m/s, 10deg glance ${glance.toFixed(2)} m/s, ` +
      `min slide speed ${minOf(slide).toFixed(2)} m/s, final heading ${((g.heading.at(-1)! * 180) / Math.PI).toFixed(1)}deg`,
  );
  check(g.firstContact >= 0, 'glance: never touched the wall');
  check(
    glance > 0 && glance < 0.25 * headOn,
    `glance impact too high (${glance.toFixed(2)} vs head-on ${headOn.toFixed(2)})`,
  );
  check(
    Math.abs(glance - MAX_FWD * Math.sin(ang)) < 0.3,
    `glance impact should be ~v*sin(10deg) (${glance.toFixed(2)})`,
  );
  check(minOf(slide) > 0.6 * MAX_FWD, `glance: lost too much speed (min ${minOf(slide).toFixed(2)})`);
  check(maxOf(after) < HIT_MIN_SPEED, `glance: repeated hits while sliding (${maxOf(after).toFixed(2)})`);
  check(g.hits <= 1, `glance: ${g.hits} hits counted`);
  check(g.maxFront <= WALL_Z + 0.01, `glance: car pushed into the wall (z=${g.maxFront.toFixed(3)})`);
  const hEnd = g.heading.at(-1)!;
  check(
    hEnd >= Math.PI / 2 - 0.1 && hEnd <= Math.PI / 2 + 0.1,
    `glance: car not aligned with the wall (${hEnd.toFixed(3)})`,
  );

  // Same glance in full reverse: the car keeps reversing (v stays negative)
  // and squares up with the wall instead of turning into it.
  car.reset(0, WALL_Z - CAR_L / 2 - 1, Math.PI / 2 + ang);
  car.v = -MAX_REV;
  const gr = run(car, [wall], 6, -1);
  const rSlide = gr.v.slice(gr.firstContact, gr.firstContact + settle);
  const rEnd = gr.heading.at(-1)!;
  console.log(
    `  reverse 10deg glance ${maxOf(gr.impact).toFixed(2)} m/s, max slide speed ${maxOf(rSlide).toFixed(2)} m/s`,
  );
  check(gr.firstContact >= 0, 'reverse glance: never touched the wall');
  check(maxOf(gr.impact) < 0.25 * MAX_REV, `reverse glance impact too high (${maxOf(gr.impact).toFixed(2)})`);
  check(maxOf(rSlide) < -0.6 * MAX_REV, `reverse glance: lost too much speed (${maxOf(rSlide).toFixed(2)})`);
  check(maxOf(gr.impact.slice(gr.firstContact + settle)) < HIT_MIN_SPEED, 'reverse glance: repeated hits');
  check(gr.maxFront <= WALL_Z + 0.01, `reverse glance: car pushed into the wall (z=${gr.maxFront.toFixed(3)})`);
  check(
    rEnd >= Math.PI / 2 - 0.1 && rEnd <= Math.PI / 2 + 0.05,
    `reverse glance: car not aligned (${rEnd.toFixed(3)})`,
  );

  // (c) Clip a 0.8 m pillar with the right front corner (0.3 m overlap).
  // The car glances off with a small, bounded heading change and no spin.
  const pillar: OBB = { x: CAR_W / 2 + 0.4 - 0.3, z: 8, hw: 0.4, hl: 0.4, rot: 0 };
  car.reset(0, pillar.z - pillar.hl - CAR_L / 2 - 1, 0);
  car.v = 4;
  const p = run(car, [pillar], 3, 0);
  const dh = p.heading.at(-1)!;
  const late = p.heading.slice(-120);
  console.log(
    `  pillar clip at 4 m/s: impact ${maxOf(p.impact).toFixed(2)} m/s, heading change ${((dh * 180) / Math.PI).toFixed(1)}deg`,
  );
  check(p.firstContact >= 0, 'pillar: never touched');
  check(dh > 0.01 && dh < 0.35, `pillar: heading change out of range (${dh.toFixed(3)} rad)`);
  check(maxOf(late) - minOf(late) < 1e-9, 'pillar: car still turning after the clip');
  check(!sat(car.obb, pillar), 'pillar: car left overlapping');

  // (d) Drive into the wall from 1 m and hold full throttle against it for
  // 3 s: one hit for the arrival, then a quiet, jitter-free rest.
  car.reset(0, WALL_Z - CAR_L / 2 - 1, 0);
  const r = run(car, [wall], 3, 1);
  const restImp = r.impact.slice(r.firstContact + settle);
  const restZ = r.z.slice(r.firstContact + settle);
  let jitter = 0;
  for (let i = 1; i < restZ.length; i++) jitter = Math.max(jitter, Math.abs(restZ[i] - restZ[i - 1]));
  console.log(
    `  resting: arrival ${maxOf(r.impact).toFixed(2)} m/s, then max impact ${maxOf(restImp).toFixed(3)} m/s, ` +
      `max step dz ${(jitter * 1000).toFixed(2)} mm`,
  );
  check(r.hits === 1, `resting: expected exactly 1 hit, got ${r.hits}`);
  check(maxOf(restImp) < HIT_MIN_SPEED, `resting: impact while pushing (${maxOf(restImp).toFixed(3)})`);
  check(maxOf(r.heading.map(Math.abs)) < 1e-9, 'resting: heading changed');
  check(jitter < 1e-3, `resting: position jitter ${jitter.toFixed(4)} m`);
  check(r.maxFront <= WALL_Z + 0.01, `resting: car pushed into the wall (z=${r.maxFront.toFixed(3)})`);
}

console.log('Build version');
check(buildVersion('1.2.3', 'abcdef1234567890') === '1.2.3+abcdef1', 'full sha is shortened to 7 chars');
check(buildVersion('1.2.3', 'abc123\n') === '1.2.3+abc123', 'sha whitespace is trimmed');
check(buildVersion('1.2.3', undefined) === '1.2.3+unknown', 'missing sha falls back to unknown');
// --- Level ids and saved progress ---------------------------------------------
console.log('Level ids and progress');
const ids = LEVELS.map((l) => l.id);
check(
  ids.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)),
  'level ids must be non-empty kebab-case',
);
check(new Set(ids).size === ids.length, 'level ids must be unique');
check(
  V1_LEVEL_IDS.every((id) => ids.includes(id)),
  'a v1 level id no longer exists (ids are permanent)',
);

const v1 = { unlocked: 4, stars: [3, 2, 1, 2, 0, 0] };
const mig = parseProgress(v1, ids);
check(mig.v === 2, 'migration: result is v2');
check(
  V1_LEVEL_IDS.every((id, i) => (mig.stars[id] ?? 0) === v1.stars[i]),
  'migration: stars moved to ids',
);
check(mig.unlocked.join() === V1_LEVEL_IDS.slice(0, 4).join(), `migration: unlocked ${mig.unlocked.join()}`);

// Inserting a level in the middle must leave an existing player's stars on the right levels.
const withTest = [...ids.slice(0, 2), 'test-level', ...ids.slice(2)];
const after = parseProgress(JSON.parse(JSON.stringify(mig)), withTest);
check(
  V1_LEVEL_IDS.every((id, i) => (after.stars[id] ?? 0) === v1.stars[i]),
  'insert: stars stay on their levels',
);
check(!after.stars['test-level'], 'insert: new level has no stars');
check(!after.unlocked.includes('test-level'), 'insert: new level starts locked');
check(
  mig.unlocked.every((id) => after.unlocked.includes(id)),
  'insert: unlocked levels stay unlocked',
);
const rec = parseProgress(null, withTest);
recordWin(rec, withTest, 1, 2);
check(rec.unlocked.includes('test-level') && rec.stars[withTest[1]] === 2, 'recordWin unlocks next by position');
recordWin(rec, withTest, 1, 1);
check(rec.stars[withTest[1]] === 2, 'recordWin keeps best stars');
check(resumeIndex(rec, withTest) === 2, 'resumeIndex is the furthest unlocked level');
check(parseProgress('junk', ids).unlocked.length === 1, 'junk save falls back to fresh');
const v2 = parseProgress({ v: 2, stars: { gone: 3, 'first-steps': 9 }, unlocked: ['gone'] }, ids);
check(v2.stars['first-steps'] === 3 && !('gone' in v2.stars), 'v2: stars clamped to 0-3 and unknown ids dropped');

// loadProgress reads localStorage: check it survives bad, missing and throwing storage.
const store: { value: string | null; throws: boolean } = { value: null, throws: false };
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: () => {
    if (store.throws) throw new Error('unavailable');
    return store.value;
  },
};
const four = ids.slice(0, 4);
const load = (raw: string | null, list = four) => {
  store.value = raw;
  return loadProgress(list);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fresh4 = { v: 2, stars: {}, unlocked: [ids[0]] };
check(same(load(null), fresh4), 'missing storage gives fresh progress');
check(same(load('{not json'), fresh4), 'corrupt JSON gives fresh progress');
check(same(load('null'), fresh4), 'JSON null gives fresh progress');
check(same(load('{"stars":"x","unlocked":"y"}'), fresh4), 'wrong-typed fields give fresh progress');
store.throws = true;
check(same(load('{"unlocked":3}'), fresh4), 'throwing storage gives fresh progress');
store.throws = false;
check(
  same(load('{"unlocked":3,"stars":[1,2,3]}'), {
    v: 2,
    stars: { [ids[0]]: 1, [ids[1]]: 2, [ids[2]]: 3 },
    unlocked: ids.slice(0, 3),
  }),
  'valid v1 progress loads and migrates',
);
check(
  same(load('{"stars":[99,-5,2.7,"3",null,"NaN",1]}', ids).stars, { [ids[0]]: 3, [ids[2]]: 2 }),
  'out-of-range, fractional and non-number stars are clamped to integers 0-3',
);
check(load('{"unlocked":99}').unlocked.length === 4, 'unlocked above level count is clamped');
check(load('{"unlocked":-3}').unlocked.length === 1, 'negative unlocked is clamped to 1');
check(load('{"unlocked":0}').unlocked.length === 1, 'zero unlocked is clamped to 1');
check(load('{"unlocked":2.9}').unlocked.length === 2, 'fractional unlocked is floored');

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
