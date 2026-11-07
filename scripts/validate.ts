// Sanity checks for level geometry and car physics. Run: npm run validate
import { sat, type OBB } from '../src/collision';
import { CAR_L, CAR_W, STEP } from '../src/config';
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
  check(obs.every((o) => !sat(spawn, o)), 'spawn overlaps an obstacle');

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
  check(obs.every((o) => !sat(side, o)), 'less than 0.3m side clearance at target');
}

console.log('Physics');
const p = new CarPhysics();
p.reset(0, 0, 0);
for (let i = 0; i < 240; i++) p.step(STEP, { throttle: 1, steer: 0, handbrake: false });
check(p.v > 5 && Math.abs(p.x) < 1e-6 && p.z > 5, `straight acceleration (v=${p.v.toFixed(2)}, z=${p.z.toFixed(2)})`);
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

console.log(failures ?`\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
