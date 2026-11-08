// Sanity checks for level geometry and car physics. Run: npm run validate
import { corners, sat, type OBB } from '../src/collision';
import { CAR_L, CAR_W, HIT_COOLDOWN, HIT_MIN_SPEED, MAX_FWD, MAX_REV, STEP } from '../src/config';
import { deadzone, steerFromOffset, strongest } from '../src/input';
import { allObstacles, obstacleOBB } from '../src/layout';
import { LEVELS } from '../src/levels';
import { evaluateParking } from '../src/parking';
import { CarPhysics } from '../src/physics';

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
for (let i = 0; i < 240; i++) p.step(STEP, { throttle: 1, steer: 0, handbrake: false });
check(
  p.v > 3.5 && Math.abs(p.x) < 1e-6 && p.z > 3.5,
  `straight acceleration (v=${p.v.toFixed(2)}, z=${p.z.toFixed(2)})`,
);
const h0 = p.heading;
for (let i = 0; i < 60; i++) p.step(STEP, { throttle: 0, steer: 1, handbrake: false });
check(p.heading < h0, 'steer right while moving forward should decrease heading');
for (let i = 0; i < 600; i++) p.step(STEP, { throttle: 0, steer: 0, handbrake: true });
check(p.v === 0, 'handbrake stops car');
for (let i = 0; i < 240; i++) p.step(STEP, { throttle: -1, steer: 0, handbrake: false });
check(p.v < -2, 'reverse works');

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
    hEnd >= Math.PI / 2 - 0.05 && hEnd <= Math.PI / 2 + 0.1,
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

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
