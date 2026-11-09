// Sanity checks for level geometry and car physics. Run: npm run validate
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mayPersist, resolveAdmin, showSkipButtons, skipTarget, unlockAll } from '../src/admin';
import { corners, sat, sensorInterval, type Contact, type OBB } from '../src/collision';
import { CAR_L, CAR_W, MAX_FWD, MAX_REV, RAMP_MAX_SLOPE, STEP, TOUCH_MIN_SPEED } from '../src/config';
import { nextFocusIndex } from '../src/focus';
import {
  angleDelta,
  deadzone,
  pedalControls,
  pickNeighbor,
  pointerAngle,
  steerFromWheel,
  strongest,
  turnWheel,
  WHEEL_LOCK,
} from '../src/input';
import {
  ceilingAbove,
  clampCameraDistance,
  floorHud,
  floorLabel,
  floorShown,
  lightTarget,
  rampSignText,
} from '../src/storey';
import { floorProblems, levelObstacles, Surfaces } from '../src/floors';
import { allObstacles, obstacleOBB, type LevelDef } from '../src/layout';
import { LEVELS } from '../src/levels';
import { SOLUTIONS } from '../src/levels.solutions';
import { loadingLabel } from '../src/loading';
import { evaluateParking } from '../src/parking';
import { CarPhysics } from '../src/physics';
import { isTouch, nextStarTime, starsForTime } from '../src/rules';
import { replaySolution, staticProblems } from '../src/solution';
import { checkForUpdate, compareVersions, decideUpdate, parseRemote, parseVersion } from '../src/update';
import { renderMaps } from './mapsRender';
import { buildVersion } from './version';
import {
  bestFor,
  loadProgress,
  parseProgress,
  recordBest,
  recordWin,
  resumeIndex,
  saveProgress,
  V1_LEVEL_IDS,
} from '../src/progress';

declare const process: { exit(code: number): never };

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.log('  FAIL', msg);
  }
}

const carBox = (x: number, z: number, rot: number): OBB => ({ x, z, hw: CAR_W / 2, hl: CAR_L / 2, rot });

/** Geometry and parking-rule checks for one level, on the layer its bay is on. */
function levelChecks(lvl: LevelDef): void {
  const surfaces = new Surfaces(lvl);
  const layer = lvl.target.floor ?? surfaces.startLayer;
  const t = lvl.target;
  const reachable = (box: OBB) => surfaces.reachable(layer, box.x, box.z, levelObstacles(lvl, surfaces));
  const parked = carBox(t.x, t.z, t.rot);
  check(evaluateParking(parked, 0, t, lvl.bothWays, layer).ok, 'centred target pose is not a valid park');
  check(!evaluateParking(parked, 2, t, lvl.bothWays, layer).ok, 'moving car counted as parked');
  const flipped = carBox(t.x, t.z, t.rot + Math.PI);
  check(evaluateParking(flipped, 0, t, lvl.bothWays, layer).ok === lvl.bothWays, 'reverse orientation rule wrong');
  const off = carBox(t.x + t.w, t.z, t.rot);
  check(!evaluateParking(off, 0, t, lvl.bothWays, layer).ok, 'car outside bay counted as parked');
  const other = surfaces.floors.find((f) => f.id !== layer);
  if (other)
    check(!evaluateParking(parked, 0, t, lvl.bothWays, other.id).ok, 'parked on the wrong floor counted as parked');

  // Free space around the bay: car should have >= 0.3m clearance sideways.
  const side = carBox(t.x, t.z, t.rot);
  side.hw += 0.3;
  check(
    reachable(side).every((o) => !sat(side, o)),
    'less than 0.3m side clearance at target',
  );

  // Static geometry: floors, spawn and bay clear, bay fits the car and sits inside the lot.
  for (const problem of staticProblems(lvl)) check(false, problem);
}

// A real upper-floor bay: floors, ramp and a pillar on the ground floor under the bay.
const upperBayLevel: LevelDef = {
  ...LEVELS[0],
  lot: { w: 20, l: 65 },
  spawn: { x: 0, z: -10, rot: 0 },
  obstacles: [{ kind: 'pillar', x: 0, z: 25, floor: 'ground' }],
  floors: [
    { id: 'ground', y: 0, area: [{ x: 0, z: -15, hw: 10, hl: 15, rot: 0 }] },
    { id: 'upper', y: 3, area: [{ x: 0, z: 25, hw: 10, hl: 10, rot: 0 }] },
  ],
  ramps: [{ id: 'ramp', from: 'ground', to: 'upper', x: 0, z: 7.5, rot: 0, w: 4, l: 15 }],
  target: { ...LEVELS[0].target, x: 0, z: 25, floor: 'upper' },
};

console.log('Upper-floor bay');
levelChecks(upperBayLevel);

for (const [i, lvl] of LEVELS.entries()) {
  console.log(`Level ${i + 1}: ${lvl.name}`);
  levelChecks(lvl);

  // Scripted solution: must park within the 3-star time and without a touch.
  const solution = SOLUTIONS[lvl.id];
  check(solution !== undefined, `no scripted solution in src/levels.solutions.ts for "${lvl.id}"`);
  if (solution) {
    const r = replaySolution(lvl, solution);
    check(r.parked, 'scripted solution does not end parked');
    check(
      r.hits === 0 && r.maxImpact <= TOUCH_MIN_SPEED,
      `scripted solution touches something (impact ${r.maxImpact.toFixed(2)})`,
    );
    check(
      r.finishTime !== null && r.finishTime <= lvl.stars.three,
      `scripted solution too slow (${r.finishTime?.toFixed(1) ?? 'never'}s, 3-star ${lvl.stars.three}s)`,
    );
  }
}
const levelNames = new Set(LEVELS.map((l) => l.id));
for (const name of Object.keys(SOLUTIONS)) check(levelNames.has(name), `solution for unknown level "${name}"`);

console.log('Solution checker');
{
  // The checker itself must reject bad inputs, or CI would pass vacuously.
  const lvl = LEVELS[0];
  check(!replaySolution(lvl, []).parked, 'empty solution counted as parked');
  const wall = replaySolution(lvl, [{ t: 6, throttle: -1, steer: 0, handbrake: false }]);
  check(wall.hits > 0, 'reversing into the wall was not counted as a bump');
  const overlapping = {
    ...lvl,
    obstacles: [...lvl.obstacles, { kind: 'cone' as const, x: lvl.spawn.x, z: lvl.spawn.z }],
  };
  check(
    staticProblems(overlapping).some((m) => m.includes('spawn')),
    'spawn overlap not detected',
  );
  const tiny = { ...lvl, target: { ...lvl.target, w: 1.5 } };
  check(staticProblems(tiny).length > 0, 'undersized bay not detected');
  const outside = { ...lvl, target: { ...lvl.target, z: lvl.lot.l } };
  check(
    staticProblems(outside).some((m) => m.includes('lot')),
    'bay outside lot not detected',
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

console.log('Wall impact (level 1)');
{
  const lvl = LEVELS[0];
  const obs = allObstacles(lvl).map(obstacleOBB);
  const car = new CarPhysics();
  let maxImpact: number;
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

console.log('Multi-storey view helpers');
{
  const two: LevelDef = {
    ...LEVELS[0],
    lot: { w: 20, l: 65 },
    floors: [
      { id: 'ground', y: 0, area: [{ x: 0, z: -15, hw: 10, hl: 15, rot: 0 }] },
      { id: 'upper', y: 3.5, area: [{ x: 0, z: 25, hw: 10, hl: 10, rot: 0 }] },
      { id: 'deep', y: -3.5, area: [{ x: 0, z: -15, hw: 10, hl: 15, rot: 0 }] },
    ],
    target: { ...LEVELS[0].target, x: 0, z: 25, floor: 'upper' },
  };
  check(floorLabel(two, 'ground') === 'G', 'ground floor is G');
  check(floorLabel(two, 'upper') === '1' && floorLabel(two, 'deep') === 'B1', 'floors above and below are numbered');
  check(rampSignText(two, 'upper', true) === 'Level 1 ↑', 'sign text up');
  check(rampSignText(two, 'ground', false) === 'Ground ↓', 'sign text down');
  check(floorHud(LEVELS[0], 'ground', 0).pill === null, 'a flat level has no floor pill');
  const h = floorHud(two, 'ground', 0);
  check(h.dir === 'up' && h.hint.includes('▲') && h.pill !== null, 'target above: arrow points up');
  check(floorHud(two, 'upper', 3.5).dir === null, 'no direction on the target floor');
  check(floorHud(two, 'ramp', 2.9).pill === '🅿 Floor 1', 'a ramp near the top counts as the upper floor');
  check(floorHud(two, 'deep', -3.5).dir === 'up', 'target above a basement car: up');

  check(ceilingAbove(two, 0, 25, 3.5) === null, 'nothing above the upper deck');
  check(Math.abs((ceilingAbove(two, 0, 25, 0) ?? 99) - 3.2) < 1e-9, 'under the upper deck: ceiling at its underside');
  check(ceilingAbove(two, 0, -15, 0) === null, 'ground at z -15 is open (the upper deck is at z 15..35)');
  check(
    Math.abs((ceilingAbove(two, 0, 25, -3.5) ?? 99) - 3.2) < 1e-9,
    'basement under the upper deck sees its underside',
  );
  check(ceilingAbove(two, 0, -15, -3.5) === -0.3, 'basement ceiling is the ground deck underside');

  check(clampCameraDistance(7, null) === 7, 'clear line keeps the camera where it is');
  check(clampCameraDistance(7, 9) === 7, 'a hit beyond the camera does not move it');
  check(Math.abs(clampCameraDistance(7, 4) - 3.65) < 1e-9, 'a ceiling pulls the camera in short of the hit');
  check(clampCameraDistance(7, 0.5) === 1.6, 'never closer than the minimum');
  check(clampCameraDistance(1, 0.2) === 1, 'a short wanted distance is not pushed out');

  check(floorShown(3.5, 0, true) === false && floorShown(0, 0, true), 'top-down hides floors above the car');
  check(floorShown(3.5, 0, false), 'chase shows every floor');
  check(floorShown(0, 3.5, true), 'top-down on an upper floor still shows the floors below');
  const out = lightTarget(false, false);
  const under = lightTarget(true, false);
  const deep = lightTarget(true, true);
  check(out.sun > 0 && under.sun === 0 && deep.sun === 0, 'sun is off under a deck');
  check(deep.sky < under.sky && under.sky < out.sky, 'underground is darker than covered, covered than outdoors');
}

console.log('Floors and ramps');
{
  // Ground floor z -30..0, a 15 m ramp (11.3 deg) from z 0 to 15, upper floor (y = 3) z 15..35.
  const rampLevel = (rampLen: number): LevelDef => ({
    ...LEVELS[0],
    lot: { w: 20, l: 65 },
    spawn: { x: 0, z: -10, rot: 0 },
    obstacles: [{ kind: 'pillar', x: 0, z: 25, floor: 'ground' }],
    floors: [
      { id: 'ground', y: 0, area: [{ x: 0, z: -15, hw: 10, hl: 15, rot: 0 }] },
      { id: 'upper', y: 3, area: [{ x: 0, z: 15 + rampLen - 15 + 10, hw: 10, hl: 10, rot: 0 }] },
    ],
    ramps: [{ id: 'ramp', from: 'ground', to: 'upper', x: 0, z: rampLen / 2, rot: 0, w: 4, l: rampLen }],
    target: { ...LEVELS[0].target, x: 0, z: 25, floor: 'upper' },
  });
  const lvl = rampLevel(15);
  const surf = new Surfaces(lvl);
  const obs = levelObstacles(lvl, surf);
  check(floorProblems(lvl).length === 0, `ramp level rejected: ${floorProblems(lvl).join('; ')}`);
  check(
    floorProblems(rampLevel(12)).some((m) => m.includes('over the limit')),
    'a 14 deg ramp should be rejected',
  );
  check(surf.rampSlope(lvl.ramps![0]) <= RAMP_MAX_SLOPE, 'test ramp is steeper than the limit');

  const car = new CarPhysics();
  const drive = (seconds: number, ctl: (c: CarPhysics) => { throttle: number; handbrake: boolean }, steer = 0) => {
    const layers = new Set<string>();
    let impact = 0;
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      const c = ctl(car);
      car.step(STEP, { throttle: c.throttle, steer, handbrake: c.handbrake }, surf);
      impact = Math.max(impact, car.resolveCollisions(car.reachable(surf, obs)));
      layers.add(car.layer);
    }
    return { layers, impact };
  };

  // Driving up: full throttle climbs the ramp, ends on the upper floor, level.
  car.reset(0, -10, 0, surf);
  check(car.layer === 'ground' && car.y === 0 && car.pitch === 0, 'car should start flat on the ground floor');
  let maxPitch = 0;
  const up = drive(16, (c) => {
    maxPitch = Math.max(maxPitch, c.pitch);
    return { throttle: c.z > 20 ? 0 : 1, handbrake: c.z > 20 };
  });
  console.log(
    `  climb: layer ${car.layer}, y ${car.y.toFixed(2)}, max pitch ${((maxPitch * 180) / Math.PI).toFixed(1)}deg, v ${car.v.toFixed(2)}`,
  );
  check(up.layers.has('ramp'), 'driving up never entered the ramp layer');
  check(car.layer === 'upper', `did not reach the upper floor (layer ${car.layer}, z ${car.z.toFixed(1)})`);
  check(Math.abs(car.y - 3) < 1e-6 && Math.abs(car.pitch) < 1e-9, `not level on top (y ${car.y.toFixed(3)})`);
  check(maxPitch > 0.15 && maxPitch < RAMP_MAX_SLOPE + 1e-6, `pitch on the ramp out of range (${maxPitch.toFixed(3)})`);
  check(up.impact === 0, `hit something driving up (${up.impact.toFixed(2)})`);

  // Slope slows the car: same throttle from standstill accelerates less than on the flat.
  car.reset(0, 2, 0, surf);
  car.layer = 'ramp';
  drive(1, () => ({ throttle: 1, handbrake: false }));
  check(car.v > 0 && car.v < 1.5, `climbing from rest should be slow (v ${car.v.toFixed(2)})`);

  // Steepest allowed ramp (12 deg): from rest, full and 60% throttle must both climb to the upper floor.
  const steep = rampLevel(14.2); // rise 3 m over 14.2 m is ~11.9 deg
  check(floorProblems(steep).length === 0, `steepest ramp rejected: ${floorProblems(steep).join('; ')}`);
  const steepSurf = new Surfaces(steep);
  for (const throttle of [1, 0.6]) {
    const c = new CarPhysics();
    c.reset(0, 0.5, 0, steepSurf);
    c.layer = 'ramp';
    let climbed = false;
    for (let i = 0; i < Math.round(60 / STEP) && !climbed; i++) {
      c.step(STEP, { throttle, steer: 0, handbrake: false }, steepSurf);
      climbed = c.layer === 'upper';
    }
    check(
      climbed,
      `from rest at ${throttle * 100}% throttle the car cannot climb a 12 deg ramp (z ${c.z.toFixed(1)}, v ${c.v.toFixed(2)})`,
    );
  }

  // Stopping at the top: brake on the upper floor, the car stays put, level.
  car.reset(0, -10, 0, surf);
  drive(30, (c) => {
    const want = Math.min(3, Math.sqrt(Math.max(0, 2 * 4 * (22 - c.z))));
    return { throttle: c.v < want - 0.2 ? 1 : c.v > want + 0.2 ? -1 : 0, handbrake: c.z > 21.7 };
  });
  const topZ = car.z;
  drive(3, () => ({ throttle: 0, handbrake: true }));
  check(car.layer === 'upper' && car.v === 0 && Math.abs(car.z - topZ) < 1e-9, 'car should stay stopped at the top');
  check(Math.abs(car.y - 3) < 1e-6 && car.z > 20, `stopped at the wrong place (z ${car.z.toFixed(2)})`);
  // A bay on the upper floor counts only for a car on the upper floor.
  const topBay = { ...lvl.target, z: car.z };
  check(evaluateParking(car.obb, 0, topBay, true, 'upper').ok, 'car on the upper floor should park in an upper bay');
  check(!evaluateParking(car.obb, 0, topBay, true, 'ground').ok, 'wrong floor counted as parked');
  check(!evaluateParking(car.obb, 0, topBay, true, 'ramp').ok, 'car on a ramp counted as parked');

  // Rolling back: left alone on the ramp the car rolls down and onto the ground floor.
  car.reset(0, 7.5, 0, surf);
  car.layer = 'ramp';
  const roll = drive(1.5, () => ({ throttle: 0, handbrake: false }));
  check(car.v < -0.5 && car.z < 7.5, `car should roll back on the ramp (v ${car.v.toFixed(2)}, z ${car.z.toFixed(2)})`);
  const rolled = drive(12, () => ({ throttle: 0, handbrake: false }));
  check(roll.impact === 0 && rolled.impact < 1, 'rolling back hit something hard');
  check(car.layer === 'ground' && car.y === 0, `rolled back to layer ${car.layer}, y ${car.y.toFixed(2)}`);
  // The handbrake holds it, and braking (throttle against the roll) stops it.
  car.reset(0, 7.5, 0, surf);
  car.layer = 'ramp';
  drive(3, () => ({ throttle: 0, handbrake: true }));
  check(car.v === 0 && car.z === 7.5, `handbrake should hold the car on the ramp (z ${car.z.toFixed(3)})`);

  // Layers: a pillar on the ground floor never blocks a car on the floor above it.
  const pillar = obs.find((o) => o.layer === 'ground' && o.hw === 0.4)!;
  car.reset(0, 25, 0, surf);
  car.layer = 'upper';
  car.step(STEP, { throttle: 0, steer: 0, handbrake: false }, surf);
  check(!car.reachable(surf, obs).includes(pillar), 'a pillar on the floor below blocks the upper floor');
  check(
    car.resolveCollisions(car.reachable(surf, obs)) === 0 && Math.abs(car.z - 25) < 1e-9,
    'car pushed by a pillar below',
  );
  car.layer = 'ground';
  car.step(STEP, { throttle: 0, steer: 0, handbrake: false }, surf);
  check(car.reachable(surf, obs).includes(pillar), 'a pillar on the car’s own floor should block it');

  // Edges: nowhere to drive off. Full throttle straight on, and hard over to each side.
  for (const [name, x, z, rot, steer] of [
    ['floor end', 0, 30, 0, 0],
    ['upper floor side', 6, 20, Math.PI / 2, 0],
    ['ramp side (left)', 0, 5, 0, 1],
    ['ramp side (right)', 0, 5, 0, -1],
  ] as const) {
    car.reset(x, z, rot, surf);
    car.layer = z > 15 ? 'upper' : 'ramp';
    const box = obs.filter((o) => o.layer === car.layer);
    drive(8, () => ({ throttle: 1, handbrake: false }), steer);
    const inside = corners(car.obb).every(([cx, cz]) => {
      if (car.layer === 'upper') return Math.abs(cx) <= 10.01 && cz <= 35.01;
      return Math.abs(cx) <= 2.01 || cz < 0 || cz > 15;
    });
    check(inside && box.length > 0, `${name}: car left the surface (x ${car.x.toFixed(2)}, z ${car.z.toFixed(2)})`);
  }

  // Static checks reject broken multi-storey levels (CI must fail on these).
  const probs = (l: LevelDef) => staticProblems(l).join('; ');
  check(staticProblems(lvl).length === 0, `ramp level has static problems: ${probs(lvl)}`);
  check(
    probs({ ...lvl, ramps: [{ ...lvl.ramps![0], to: 'nowhere' }] }).includes('unknown floor'),
    'ramp to a floor that does not exist not detected',
  );
  check(probs(rampLevel(12)).includes('over the limit'), 'too-steep ramp not detected by staticProblems');
  check(
    probs({ ...lvl, ramps: [{ ...lvl.ramps![0], w: CAR_W + 0.7 }] }).includes('too narrow'),
    'ramp narrower than car + 0.8 m not detected',
  );
  check(
    staticProblems({ ...lvl, ramps: [{ ...lvl.ramps![0], w: CAR_W + 0.8 }] }).length === 0,
    'min-width ramp rejected',
  );
  check(
    probs({ ...lvl, ramps: [{ ...lvl.ramps![0], z: lvl.ramps![0].z + 1 }] }).includes('does not meet floor'),
    'ramp end floating past its floor not detected',
  );
  check(
    probs({ ...lvl, ramps: [{ ...lvl.ramps![0], z: lvl.ramps![0].z - 0.04 }] }).length === 0,
    'ramp end within 0.05 m of the floor outline rejected',
  );
  check(
    probs({ ...lvl, target: { ...lvl.target, floor: 'ground' } }).includes('bay is not inside floor'),
    'bay on the wrong floor not detected',
  );
  check(
    probs({ ...lvl, target: { ...lvl.target, z: 40 } }).includes('bay is not inside floor'),
    'bay off its floor area not detected',
  );
  check(
    probs({ ...lvl, spawn: { ...lvl.spawn, z: 25 } }).includes('spawn is not on the first floor'),
    'spawn off floor',
  );

  // Scripted solution across floors: park on the upper floor; the same drive fails a ground-floor bay.
  const climb = [
    { t: 11, throttle: 1, steer: 0, handbrake: false },
    { t: 4, throttle: 0, steer: 0, handbrake: true },
  ];
  const driven = replaySolution(lvl, climb);
  check(driven.parked && driven.hits === 0, `scripted climb should park upstairs (${JSON.stringify(driven)})`);
  check(!replaySolution(rampLevel(15), []).parked, 'standing on the ground floor counted as parked upstairs');
  const wrongFloor = replaySolution({ ...lvl, target: { ...lvl.target, z: 25, floor: 'ground' } }, climb);
  check(!wrongFloor.parked, 'parking on the wrong floor counted as parked');

  // Flat levels: no floors declared, so physics, obstacles and parking are as before.
  for (const [i, flat] of LEVELS.entries()) {
    const fs = new Surfaces(flat);
    const lo = levelObstacles(flat, fs);
    const plain = allObstacles(flat).map(obstacleOBB);
    check(
      lo.length === plain.length && lo.every((o, k) => o.layer === 'ground' && sat(o, plain[k]) !== null),
      `level ${i + 1}: flat obstacles changed`,
    );
    check(floorProblems(flat).length === 0, `level ${i + 1}: unexpected floor problems`);
    const a = new CarPhysics();
    const b = new CarPhysics();
    a.reset(flat.spawn.x, flat.spawn.z, flat.spawn.rot, fs);
    b.reset(flat.spawn.x, flat.spawn.z, flat.spawn.rot);
    for (let k = 0; k < 600; k++) {
      const ctl = { throttle: k < 400 ? 1 : -1, steer: Math.sin(k / 50), handbrake: false };
      a.step(STEP, ctl, fs);
      b.step(STEP, ctl);
      a.resolveCollisions(a.reachable(fs, lo));
      b.resolveCollisions(plain);
    }
    check(
      a.x === b.x && a.z === b.z && a.heading === b.heading && a.v === b.v && a.y === 0 && a.pitch === 0,
      `level ${i + 1}: flat physics differs with surfaces`,
    );
  }
}

console.log('Input mapping');
check(deadzone(0.05, 0.1) === 0 && deadzone(-0.1, 0.1) === 0, 'dead zone should swallow small values');
check(deadzone(1, 0.1) === 1 && deadzone(-2, 0.1) === -1, 'dead zone output should reach and clamp to ±1');
check(Math.abs(deadzone(0.55, 0.1) - 0.5) < 1e-9, 'dead zone should rescale linearly');
check(
  strongest(1, -0.4) === 1 && strongest(0.2, -0.7, 0) === -0.7 && strongest() === 0,
  'strongest picks largest magnitude',
);
check(steerFromWheel(0) === 0 && steerFromWheel(3) === 0, 'wheel near centre should not steer (dead zone)');
check(
  steerFromWheel(WHEEL_LOCK) === 1 && steerFromWheel(-WHEEL_LOCK) === -1 && steerFromWheel(900) === 1,
  'full wheel lock should give full steer, either side',
);
check(
  steerFromWheel(WHEEL_LOCK / 2) > 0 && steerFromWheel(WHEEL_LOCK / 2) < 1 && steerFromWheel(-30) < 0,
  'partial wheel angle should give partial steer, clockwise = right',
);
check(Math.abs(steerFromWheel(30) + steerFromWheel(-30)) < 1e-9, 'wheel steer should be symmetric');
check(
  Math.abs(pointerAngle(0, -10)) < 1e-9 && Math.abs(pointerAngle(10, 0) - 90) < 1e-9 && pointerAngle(-10, 0) === -90,
  'pointer angle: 0 at top, clockwise positive',
);
check(angleDelta(170, -170) === 20 && angleDelta(-170, 170) === -20 && angleDelta(10, 40) === 30, 'angle delta wraps');
check(
  turnWheel(0, 0, 30) === 30 && turnWheel(100, 0, 90) === WHEEL_LOCK && turnWheel(-100, 0, -90) === -WHEEL_LOCK,
  'wheel turns with the finger and stops at the lock',
);
check(
  turnWheel(WHEEL_LOCK, 90, 180) === WHEEL_LOCK && turnWheel(0, 175, -175) === 10,
  'wheel does not wind past the lock and follows the finger across the ±180° seam',
);
check(steerFromWheel(turnWheel(80, 20, 20 - 80)) === 0, 'letting go springs the wheel back to straight ahead');
{
  const none = pedalControls(false, false, false);
  const go = pedalControls(true, false, false);
  const rev = pedalControls(true, false, true);
  const stop = pedalControls(false, true, false);
  check(none.throttle === 0 && !none.handbrake, 'no pedal: coast');
  check(go.throttle === 1 && !go.handbrake, 'accelerator in D drives forward');
  check(rev.throttle === -1 && !rev.handbrake, 'accelerator in R drives backward');
  check(stop.throttle === 0 && stop.handbrake, 'brake pedal holds the car');
  const both = pedalControls(true, true, true);
  check(both.throttle === 0 && both.handbrake, 'brake wins when both pedals are pressed');
  check(!pedalControls(false, true, true).throttle, 'brake never reverses the car');
}
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
  // per-step impact, speed and heading. Touches are counted like main.ts does.
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
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      car.step(STEP, { throttle, steer, handbrake: false });
      const imp = car.resolveCollisions(obs);
      if (imp > 0 && t.firstContact < 0) t.firstContact = i;
      if (isTouch(imp, TOUCH_MIN_SPEED)) t.hits++;
      t.impact.push(imp);
      t.v.push(car.v);
      t.heading.push(car.heading);
      t.z.push(car.z);
      t.maxFront = Math.max(t.maxFront, ...corners(car.obb).map((c) => c[1]));
    }
    return t;
  };
  const settle = Math.round(0.5 / STEP); // steps after first contact
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
  // 32 km/h, so it counts as a touch (which fails the level), but it must be far below head-on
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
  check(maxOf(after) < TOUCH_MIN_SPEED, `glance: repeated hits while sliding (${maxOf(after).toFixed(2)})`);
  check(g.hits === 1, `glance: ${g.hits} touches counted`);
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
  check(maxOf(gr.impact.slice(gr.firstContact + settle)) < TOUCH_MIN_SPEED, 'reverse glance: repeated hits');
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
  // 3 s: a touch on arrival (it ends the level in game), then a quiet, jitter-free rest.
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
  check(r.hits >= 1, 'resting: the arrival should count as a touch');
  check(maxOf(restImp) < TOUCH_MIN_SPEED, `resting: impact while pushing (${maxOf(restImp).toFixed(3)})`);
  check(maxOf(r.heading.map(Math.abs)) < 1e-9, 'resting: heading changed');
  check(jitter < 1e-3, `resting: position jitter ${jitter.toFixed(4)} m`);
  check(r.maxFront <= WALL_Z + 0.01, `resting: car pushed into the wall (z=${r.maxFront.toFixed(3)})`);
}

console.log('Star rules');
for (const lvl of LEVELS) {
  const { three, two } = lvl.stars;
  check(
    0 < three && three < two && two < lvl.time,
    `${lvl.id}: stars need 0 < three (${three}) < two (${two}) < time (${lvl.time})`,
  );
}
{
  const t = { three: 20, two: 30 };
  check(starsForTime(0, t) === 3 && starsForTime(20, t) === 3, 'stars: 3 at or under the three-star time');
  check(starsForTime(20.01, t) === 2 && starsForTime(30, t) === 2, 'stars: 2 just over three, up to the two-star time');
  check(starsForTime(30.01, t) === 1 && starsForTime(59.9, t) === 1, 'stars: 1 when slower than the two-star time');
  check(
    nextStarTime(1, t) === 30 && nextStarTime(2, t) === 20 && nextStarTime(3, t) === null,
    'stars: time for next star',
  );
  check(
    isTouch(0.03, TOUCH_MIN_SPEED) && !isTouch(0, TOUCH_MIN_SPEED),
    'touch: any real approach counts, rest does not',
  );
}

// Restarting with the car resting against something is not a touch: spawns must not overlap obstacles.
for (const lvl of LEVELS) {
  const car = new CarPhysics();
  const s = new Surfaces(lvl);
  car.reset(lvl.spawn.x, lvl.spawn.z, lvl.spawn.rot, s);
  check(
    !car.reachable(s, levelObstacles(lvl, s)).some((o) => sat(car.obb, o)),
    `${lvl.id}: spawn overlaps an obstacle`,
  );
}

console.log('Loading label');
check(loadingLabel(0, 0) === 'Loading…', 'loading: unknown total');
check(loadingLabel(0, 7) === 'Loading… 0%', 'loading: start');
check(loadingLabel(3, 7) === 'Loading… 43%', 'loading: partial');
check(loadingLabel(9, 7) === 'Loading… 100%', 'loading: clamped');
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
  setItem: (_k: string, v: string) => {
    store.value = v;
  },
};
const four = ids.slice(0, 4);
const load = (raw: string | null, list = four) => {
  store.value = raw;
  return loadProgress(list);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fresh4 = { v: 2, stars: {}, unlocked: [ids[0]], best: {} };
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
    best: {},
  }),
  'valid v1 progress loads and migrates',
);
check(
  same(load('{"stars":[99,-5,2.7,"3",null,"NaN",1]}', ids).stars, { [ids[0]]: 3, [ids[2]]: 2 }),
  'out-of-range, fractional and non-number stars are clamped to integers 0-3',
);
// A save from a newer version is read best-effort as v2 and never wiped.
const fut = '{"v":3,"stars":{"' + ids[0] + '":2},"unlocked":["' + ids[0] + '","' + ids[1] + '"],"future":true}';
check(
  same(load(fut), { v: 2, stars: { [ids[0]]: 2 }, unlocked: ids.slice(0, 2), best: {} }),
  'v3 object save is parsed as v2, not wiped',
);
saveProgress(load(fut));
check(store.value === fut, 'unchanged v3 save is not overwritten');
const futP = load(fut);
recordWin(futP, four, 2, 1);
saveProgress(futP);
check(
  store.value !== fut && JSON.parse(store.value as string).v === 2,
  'v3 save is written once the player earns something',
);
check(same(load('{"v":2,"stars":"3"}'), fresh4), 'string stars give fresh progress');
check(same(load('{"v":2,"stars":[3,3],"unlocked":"x","best":7}'), fresh4), 'junk v2 fields give fresh progress');
check(same(load('{"v":3,"stars":"x"}'), fresh4), 'junk v3 save gives fresh progress');
check(load('{"unlocked":99}').unlocked.length === 4, 'unlocked above level count is clamped');
check(load('{"unlocked":-3}').unlocked.length === 1, 'negative unlocked is clamped to 1');
check(load('{"unlocked":0}').unlocked.length === 1, 'zero unlocked is clamped to 1');
check(load('{"unlocked":2.9}').unlocked.length === 2, 'fractional unlocked is floored');

console.log('Progress: best times');
{
  const a = ids[0];
  const b = ids[1];
  const old = parseProgress({ unlocked: 3, stars: [3, 2] }, ids);
  check(Object.keys(old.best).length === 0, 'old save without best loads with no times');
  check(old.unlocked.length === 3 && old.stars[a] === 3, 'old save keeps unlocked and stars');
  const bad = parseProgress(
    { v: 2, best: { [a]: 12.3, [b]: -1, [ids[2]]: NaN, [ids[3]]: 'x', [ids[4]]: Infinity, gone: 5 } },
    ids,
  );
  check(
    JSON.stringify(bad.best) === JSON.stringify({ [a]: 12.3 }),
    `bad best values dropped (${JSON.stringify(bad.best)})`,
  );
  check(Object.keys(parseProgress({ best: 'nope' }, ids).best).length === 0, 'non-object best ignored');
  check(Object.keys(parseProgress({ best: [1, 2] }, ids).best).length === 0, 'array best ignored');
  const p = parseProgress(null, ids);
  check(recordBest(p, a, 20.5) && bestFor(p, a) === 20.5, 'first time is recorded');
  check(!recordBest(p, a, 25) && bestFor(p, a) === 20.5, 'slower time never replaces');
  check(!recordBest(p, a, 20.5) && bestFor(p, a) === 20.5, 'equal time is not a new best');
  check(recordBest(p, a, 18.2) && bestFor(p, a) === 18.2, 'faster time replaces');
  check(!recordBest(p, b, NaN) && !recordBest(p, b, 0) && bestFor(p, b) === 0, 'invalid time is not recorded');
  const ins = parseProgress(JSON.parse(JSON.stringify(p)), [ids[0], 'test-level', ...ids.slice(1)]);
  check(bestFor(ins, a) === 18.2, 'best time stays on its level when a level is inserted');
}

// Update check
console.log('Update check');
const me = { version: '1.2.0', build: 'abc' };
const rem = (version: string, build: string, minVersion: string | null = null) => ({ version, build, minVersion });
check(compareVersions(parseVersion('1.10.0')!, parseVersion('1.9.0')!) > 0, 'versions compare numerically');
check(compareVersions(parseVersion('1.2')!, parseVersion('1.2.0')!) === 0, 'missing parts count as 0');
check(parseVersion('1.2.x') === null && parseVersion('') === null && parseVersion(3) === null, 'bad versions rejected');
check(decideUpdate(me, rem('1.2.0', 'abc')) === 'none', 'same build is up to date');
check(decideUpdate(me, rem('1.2.0', 'def')) === 'optional', 'new build of the same version is optional');
check(decideUpdate(me, rem('1.3.0', 'def')) === 'optional', 'newer version is optional');
check(decideUpdate(me, rem('1.1.0', 'def')) === 'none', 'older remote is ignored');
check(decideUpdate(me, rem('1.3.0', 'def', '1.2.0')) === 'optional', 'at min version is not required');
check(decideUpdate(me, rem('1.3.0', 'def', '1.2.1')) === 'required', 'below min version is required');
check(decideUpdate(me, rem('1.2.0', 'abc', '1.5.0')) === 'required', 'required even when build matches');
check(parseRemote({ version: '1.0.0', build: 'x' })?.minVersion === null, 'minVersion is optional');
check(parseRemote({ version: 'nope', build: 'x' }) === null, 'bad remote version rejected');
check(parseRemote({ version: '1.0.0', build: 'x', minVersion: 'zz' }) === null, 'bad minVersion rejected');
check(parseRemote(null) === null && parseRemote('x') === null, 'non-object remote rejected');
const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
check(
  (await checkForUpdate(me, 'v.json', 50, ok(rem('1.3.0', 'd', '1.3.0')))) === 'required',
  'fetched required update',
);
check((await checkForUpdate(me, 'v.json', 50, ok(rem('1.3.0', 'd')))) === 'optional', 'fetched optional update');
check((await checkForUpdate(me, 'v.json', 50, ok({}, 404))) === 'none', 'HTTP error never blocks');
check((await checkForUpdate(me, 'v.json', 50, ok({ junk: 1 }))) === 'none', 'junk body never blocks');
check(
  (await checkForUpdate(me, 'v.json', 50, (async () => {
    throw new Error('offline');
  }) as typeof fetch)) === 'none',
  'offline never blocks',
);
check(
  (await checkForUpdate(
    me,
    'v.json',
    20,
    ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as typeof fetch,
  )) === 'none',
  'hung server times out without blocking',
);

console.log('Admin mode');
{
  check(resolveAdmin('1', null) && !resolveAdmin('0', '1'), '?admin=1 turns on, ?admin=0 turns off');
  check(
    resolveAdmin(null, '1') && !resolveAdmin(null, null) && !resolveAdmin('x', null),
    'admin is remembered for the session only',
  );
  const saved = parseProgress({ v: 2, stars: { [ids[0]]: 2 }, unlocked: [ids[0]], best: { [ids[0]]: 20 } }, ids);
  const before = JSON.stringify(saved);
  const view = unlockAll(saved, ids);
  check(view.unlocked.length === ids.length, 'admin unlocks every level');
  recordWin(view, ids, 0, 3);
  check(JSON.stringify(saved) === before, 'admin view never mutates the saved progress');
  check(!mayPersist(true) && mayPersist(false), 'progress is not written in admin mode');
  check(skipTarget(0, -1, 5) === null && skipTarget(4, 1, 5) === null, 'skip stops at the first and last level');
  check(skipTarget(2, 1, 5) === 3 && skipTarget(2, -1, 5) === 1, 'skip moves to the next/previous level');
  check(
    showSkipButtons(true, true, true) &&
      !showSkipButtons(false, true, true) &&
      !showSkipButtons(true, false, true) &&
      !showSkipButtons(true, true, false),
    'skip buttons need admin, the toggle on, and an open level',
  );
}

console.log('Level maps (docs/LEVELS.md, docs/maps)');
{
  const expected = renderMaps(LEVELS);
  const stale = (what: string): void => check(false, `${what} is out of date with the levels: run \`npm run maps\``);
  for (const [path, content] of expected) {
    if (!existsSync(path)) stale(`${path} (missing)`);
    else if (readFileSync(path, 'utf8') !== content) stale(path);
  }
  const onDisk = existsSync('docs/maps') ? readdirSync('docs/maps').filter((f) => f.endsWith('.svg')) : [];
  for (const f of onDisk) if (!expected.has(`docs/maps/${f}`)) stale(`docs/maps/${f} (no such level)`);
  const storey: LevelDef = {
    ...LEVELS[0],
    id: 'tmp',
    floors: [
      { id: 'ground', y: 0, area: [{ x: 0, z: 0, hw: 10, hl: 10, rot: 0 }] },
      { id: 'upper', y: 3, area: [{ x: 0, z: 0, hw: 10, hl: 10, rot: 0 }] },
    ],
    ramps: [{ id: 'r1', from: 'ground', to: 'upper', x: 0, z: 0, rot: 0, w: 3, l: 12 }],
    obstacles: [],
    bays: [],
    spawn: { x: -6, z: -6, rot: 0 },
    target: { x: 6, z: 6, rot: 0, w: 3, l: 5.6, floor: 'upper' },
  };
  const multi = renderMaps([storey]);
  check(
    multi.has('docs/maps/tmp-ground.svg') && multi.has('docs/maps/tmp-upper.svg'),
    'multi-storey level gets one map per floor',
  );
  check(renderMaps(LEVELS).get('docs/LEVELS.md') === expected.get('docs/LEVELS.md'), 'map output is not deterministic');
}

check(nextFocusIndex(3, 0, 1) === 1 && nextFocusIndex(3, 2, 1) === 0, 'focus cycle wraps forward');
check(nextFocusIndex(3, 0, -1) === 2 && nextFocusIndex(3, 2, -1) === 1, 'focus cycle wraps backward');
check(nextFocusIndex(3, -1, 1) === 0 && nextFocusIndex(3, -1, -1) === 2, 'focus enters at the ends when none focused');
check(nextFocusIndex(0, -1, 1) === -1, 'focus cycle with no items');

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
