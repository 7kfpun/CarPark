// Sanity checks for level geometry and car physics. Run: npm run validate
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mayPersist, resolveAdmin, showSkipButtons, skipTarget, unlockAll } from '../src/admin';
import { corners, sat, sensorInterval, type Contact, type OBB } from '../src/collision';
import {
  holdComplete,
  PARK_HOLD,
  CAR_L,
  CAR_W,
  MAX_FWD,
  MAX_REV,
  RAMP_MAX_SLOPE,
  STEP,
  TOUCH_MIN_SPEED,
} from '../src/config';
import {
  beatsGhost,
  nextGhost,
  decodeFrames,
  duration,
  encodeFrames,
  fitsCap,
  loadGhosts,
  MAX_FRAMES,
  parseGhosts,
  saveGhosts,
  poseAt,
  Recorder,
  REPLAY_HZ,
} from '../src/replay';
import { cacheName, precacheList, serviceWorkerSource } from './serviceWorker';
import {
  COINS_PER_HOUR,
  HOUR_MS,
  MAX_HOURS,
  claim as claimEarn,
  freshEarn,
  hoursReady,
  msToNext,
  parseEarn,
  loadEarn,
  pendingCoins,
  saveEarn,
  waitLabel,
} from '../src/earn';
import { isUpdateWaiting } from '../src/pwa';
import {
  canRepair,
  COST_PER_HP,
  freshRepair,
  isDamaged,
  loadRepair,
  MAX_HP,
  parseRepair,
  repair,
  repairCost,
  saveRepair,
} from '../src/repair';
import {
  canClaim,
  claim,
  dayKey,
  freshMissions,
  MISSIONS,
  parseMissions,
  parseWallet,
  progressFor,
  recordPark,
  rollDay,
} from '../src/missions';
import { nextFocusIndex } from '../src/focus';
import { Sfx, VOLUME_STEPS, engineParams, winNotes } from '../src/audio';
import { canRunGame, padConfirmAction, runModalAction } from '../src/guards';
import {
  angleDelta,
  deadzone,
  isMetaKey,
  isShortcut,
  gateSlot,
  gatePos,
  gearFromGate,
  gearFromKey,
  pedalControls,
  pickNeighbor,
  softReverse,
  REVERSE_DELAY,
  REVERSE_START,
  trackReverseHold,
  pointerAngle,
  steerFromWheel,
  strongest,
  turnWheel,
  gripLost,
  gripExpired,
  GRIP_GRACE_MS,
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
import { detailLayout, detailProblems, POLE_CLEAR } from '../src/detail';
import { floorProblems, levelObstacles, Surfaces } from '../src/floors';
import { allObstacles, obstacleOBB, type LevelDef } from '../src/layout';
import { MODEL_SHARED, loadCarModels, toTemplate } from '../src/carModels';
import { mirrorAllowed } from '../src/mirror';
import {
  applyOrbit,
  clampOrbit,
  dragOrbit,
  inControlZone,
  isDoubleTap,
  isOffCentre,
  orbitCentre,
  pinchFactor,
  startReset,
  stepReset,
} from '../src/orbit';
import { LEVELS } from '../src/levels';
import { SOLUTIONS } from '../src/levels.solutions';
import { loadSettings, parseTextSize, TEXT_SCALE, TEXT_SIZES } from '../src/settings';
import { ambientLevels } from '../src/lighting';
import { backoffMs, loadingLabel, mapLimit, retry, withTimeout } from '../src/loading';
import { classifyTexel, normalFromHeight, paintControlPixels, surfacePixels, tileBoxUV } from '../src/materials';
import { evaluateParking, parkChecklist } from '../src/parking';
import { CarPhysics } from '../src/physics';
import { DEFAULT_VEHICLE, minTurnRadius, VEHICLES, vehicleOf, type VehicleDef } from '../src/vehicles';
import { isTouch, nextStarTime, starsForTime } from '../src/rules';
import { replaySolution, staticProblems } from '../src/solution';
import {
  advanceBlend,
  assistMode,
  blendWeight,
  bodyHidden,
  CAM_MODES,
  dragFreeLook,
  EYE,
  FREE_START,
  freePose,
  hidesCeilings,
  isRigid,
  nextCamMode,
  parseCamMode,
  reverseHold,
  viewPose,
  type CamMode,
  type ViewTarget,
} from '../src/views';
import {
  checkForUpdate,
  compareVersions,
  fetchUpdate,
  mergeUpdate,
  reloadUrl,
  shouldPrompt,
  decideUpdate,
  parseRemote,
  parseVersion,
} from '../src/update';
import {
  LOST_STALL_MS,
  MAX_RELOAD_ATTEMPTS,
  RELOAD_RETRY_MS,
  RELOAD_SETTLE_MS,
  recover,
  type ReloadEnv,
} from '../src/recovery';
import {
  LOCATIONS,
  levelPlayable,
  resumeLevel,
  WORLDS,
  worldComplete,
  worldLevels,
  worldStars,
  worldUnlocked,
} from '../src/worlds';
import { FAST_MS, LOW_TTL_MS, SLOW_MS, parseDetected, probeQuality } from '../src/qualityProbe';
import { budgetProblems, chunkName, makeBudget, sizeTable, withHeadroom, type Chunk } from './sizeReport';
import { renderMaps } from './mapsRender';
import { buildVersion } from './version';
import { WHATS_NEW } from '../src/whatsnew';
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

const carBox = (x: number, z: number, rot: number, v: VehicleDef = vehicleOf()): OBB => ({
  x,
  z,
  hw: v.width / 2,
  hl: v.length / 2,
  rot,
});

/** Geometry and parking-rule checks for one level, on the layer its bay is on. */
function levelChecks(lvl: LevelDef): void {
  const surfaces = new Surfaces(lvl);
  const layer = lvl.target.floor ?? surfaces.startLayer;
  const t = lvl.target;
  const reachable = (box: OBB) => surfaces.reachable(layer, box.x, box.z, levelObstacles(lvl, surfaces));
  const veh = vehicleOf(lvl.vehicle);
  const parked = carBox(t.x, t.z, t.rot, veh);
  check(evaluateParking(parked, 0, t, lvl.bothWays, layer).ok, 'centred target pose is not a valid park');
  check(!evaluateParking(parked, 2, t, lvl.bothWays, layer).ok, 'moving car counted as parked');
  const flipped = carBox(t.x, t.z, t.rot + Math.PI, veh);
  check(evaluateParking(flipped, 0, t, lvl.bothWays, layer).ok === lvl.bothWays, 'reverse orientation rule wrong');
  const off = carBox(t.x + t.w, t.z, t.rot, veh);
  check(!evaluateParking(off, 0, t, lvl.bothWays, layer).ok, 'car outside bay counted as parked');
  const other = surfaces.floors.find((f) => f.id !== layer);
  if (other)
    check(!evaluateParking(parked, 0, t, lvl.bothWays, other.id).ok, 'parked on the wrong floor counted as parked');

  // Free space around the bay: car should have >= 0.3m clearance sideways.
  const side = carBox(t.x, t.z, t.rot, veh);
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
  lot: { w: 20, l: 80 },
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

console.log('Multi-storey levels');
{
  const byId = (id: string): LevelDef => LEVELS.find((l) => l.id === id)!;
  const up = byId('up-one-floor');
  const down = byId('basement');
  const spiral = byId('spiral');
  check(
    up.target.floor === 'upper' && up.floors!.find((f) => f.id === 'upper')!.y > 0,
    'Up One Floor: the bay is on a higher floor',
  );
  check(
    !up.bothWays && !down.bothWays,
    'Up One Floor parks forwards and Basement reverses in, so the nose direction counts',
  );
  check(
    down.floors!.some((f) => f.id === down.target.floor && f.y < 0),
    'Basement: the bay is below ground',
  );
  check(
    down.obstacles.filter((o) => o.kind === 'car' && o.floor === 'basement' && Math.abs(o.z - down.target.z) < 1)
      .length >= 2,
    'Basement: the bay sits among parked cars',
  );
  check(
    down.obstacles.some((o) => o.kind === 'pillar' && o.floor === 'basement'),
    'Basement has pillars',
  );

  // Spiral: 8 straight segments a turn, two storeys up, the bay on the top deck near the ramp exit.
  const sf = new Surfaces(spiral);
  const storeys = spiral.floors!.filter((f) => !f.landing);
  check(spiral.ramps!.length === 16, `Spiral: 8 ramp segments a turn for 2 turns (got ${spiral.ramps!.length})`);
  check(storeys.length === 3 && sf.floorHeight('top') === 6, 'Spiral: ground plus two storeys above it');
  check(spiral.target.floor === 'top', 'Spiral: the free bay is on the top deck');
  const exit = spiral.ramps![15];
  const exitEnd = { x: exit.x + (Math.sin(exit.rot) * exit.l) / 2, z: exit.z + (Math.cos(exit.rot) * exit.l) / 2 };
  check(
    Math.hypot(spiral.target.x - exitEnd.x, spiral.target.z - exitEnd.z) < 14,
    'Spiral: the bay is near the ramp exit',
  );
  check(
    spiral.ramps!.every((r) => sf.rampSlope(r) < RAMP_MAX_SLOPE / 2),
    'Spiral: a gentle slope all the way round',
  );

  // The curve has to be forgiving: a steady steer a few percent either side of the scripted 0.5 still reaches the top.
  for (const steer of [0.48, 0.52]) {
    const obs = levelObstacles(spiral, sf);
    const car = new CarPhysics();
    car.reset(spiral.spawn.x, spiral.spawn.z, spiral.spawn.rot, sf);
    let touched = 0;
    for (let k = 0; k < Math.round(100 / STEP) && car.layer !== 'top'; k++) {
      car.step(STEP, { throttle: 1, steer: k < Math.round(6 / STEP) ? 0 : steer, handbrake: false }, sf);
      if (isTouch(car.resolveCollisions(car.reachable(sf, obs), sf), TOUCH_MIN_SPEED)) touched++;
    }
    check(car.layer === 'top' && touched === 0, `Spiral: steer ${steer} should reach the top without a touch`);
  }
}

console.log('Vehicles');
{
  const ids = new Set<string>();
  for (const v of VEHICLES) {
    check(!ids.has(v.id), `duplicate vehicle id ${v.id}`);
    ids.add(v.id);
    const bad = (m: string) => check(false, `${v.name}: ${m}`);
    if (!(v.length > 0 && v.width > 0 && v.wheelbase > 0 && v.wheelbase < v.length))
      bad('sane body size and wheelbase');
    if (!(v.accel > 0 && v.revAccel > 0)) bad('acceleration must be positive');
    if (!(v.maxFwd > 0 && v.maxRev > 0 && v.maxRev <= v.maxFwd)) bad('top and reverse speed');
    if (!(v.maxSteer > 0.2 && v.maxSteer < Math.PI / 2 && v.steerRate > 0)) bad('steering lock and rate');
    const r = minTurnRadius(v);
    if (!(Number.isFinite(r) && r >= v.wheelbase)) bad(`turning radius ${r}`);
    if (!(v.camDistance > v.length / 2 && v.camHeight > 2)) bad('chase camera must sit behind and above the body');
    if (!(v.eyeBack >= 0 && v.eyeBack < v.length / 2 && v.eyeHeight > 1)) bad('mirror eye point must be on the body');
    if (!(Math.abs(v.eye.x) < v.width / 2 && Math.abs(v.eye.z) < v.length / 2 && v.eye.y > 1))
      bad('cockpit eye must be inside the body');
    if (!(v.hood.z > 0 && v.hood.z < v.length / 2 && v.hood.y > 1))
      bad('hood camera must sit on the front of the body');
    if (v.shape === 'model')
      check(
        v.model !== undefined && existsSync(`public/models/cars/${v.model}.glb`),
        `${v.name}: model file public/models/cars/${v.model}.glb is missing`,
      );
    // The physics body and the parking box use the definition's own size.
    const body = new CarPhysics(v).obb;
    check(body.hw * 2 === v.width && body.hl * 2 === v.length, `${v.name}: collision box is not its size`);
    // Measured turning circle at crawl speed matches wheelbase / tan(lock): the numbers do the work.
    const c = new CarPhysics(v);
    c.reset(0, 0, 0);
    // A crawl with the wheel hard over: the rear axle's path length over the heading change is the turning radius
    // (the steering lock eases a little with speed, so the expected radius uses the same factor).
    let dist = 0;
    const crawl = (secs: number): void => {
      for (let i = 0; i < Math.round(secs / STEP); i++) {
        c.v = 0.3;
        c.step(STEP, { throttle: 0, steer: 1, handbrake: false });
        dist += c.v * STEP;
      }
    };
    crawl(6);
    const h0 = c.heading;
    dist = 0;
    crawl(2);
    const measured = dist / Math.abs(c.heading - h0);
    const lock = v.maxSteer * (1 - (0.3 / v.maxFwd) * 0.35);
    const expected = v.wheelbase / Math.tan(lock);
    check(
      Math.abs(measured / expected - 1) < 0.02,
      `${v.name}: turning radius ${measured.toFixed(2)} m, expected ${expected.toFixed(2)}`,
    );
    // Parking: a vehicle in a bay with 0.2 m to spare is parked; slid out by 0.5 m it is not.
    const bay = { x: 0, z: 0, rot: 0, w: v.width + 0.4, l: v.length + 0.4 };
    check(evaluateParking(carBox(0, 0, 0, v), 0, bay, false).ok, `${v.name}: parked in a bay of its own size`);
    check(!evaluateParking(carBox(0.5, 0, 0, v), 0, bay, false).ok, `${v.name}: counted as parked half out of the bay`);
    // All four corners count: a corner poking out of the bay fails even when the centre is inside.
    check(!evaluateParking(carBox(0, 0, 0.12, v), 0, bay, false).ok, `${v.name}: skewed vehicle counted as parked`);
  }
  check(vehicleOf().id === DEFAULT_VEHICLE && DEFAULT_VEHICLE === 'hatchback', 'the default vehicle is the hatchback');
  const hatch = vehicleOf('hatchback');
  check(
    hatch.length === CAR_L && hatch.width === CAR_W && hatch.maxFwd === MAX_FWD && hatch.maxRev === MAX_REV,
    'the hatchback keeps the original car numbers (existing levels and saves stay valid)',
  );
  check(
    VEHICLES.every((v) => v.id === 'hatchback' || v.length > CAR_L - 0.001),
    'no other vehicle is smaller than the hatchback',
  );
  const radius = (id: string): number => minTurnRadius(vehicleOf(id));
  check(
    radius('bus') > radius('box-truck') &&
      radius('box-truck') > radius('minibus') &&
      radius('minibus') > radius('van') &&
      radius('van') > radius('hatchback'),
    'bigger vehicles turn in wider circles: bus > box truck > minibus > van > hatchback',
  );
  // Camera views follow the vehicle: a bigger one gets a camera further back and a driver's eye further forward.
  {
    const at = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, steer: 0 };
    const bus = vehicleOf('bus');
    check(
      viewPose('chase', at, false, bus).pz < viewPose('chase', at).pz,
      'the chase camera sits further back for a bus than for the hatchback',
    );
    check(
      viewPose('cockpit', at, false, bus).pz > viewPose('cockpit', at).pz + 3,
      'the cockpit view sits at the bus driver, far forward of the centre',
    );
    check(
      viewPose('corner', at, true, bus).pz < viewPose('corner', at, true).pz,
      'the reversing view looks from behind the bus, not the hatchback',
    );
  }
  let threw = false;
  try {
    vehicleOf('hovercraft');
  } catch {
    threw = true;
  }
  check(threw, 'an unknown vehicle id must be rejected');

  // A bus cannot fit a hatchback-sized bay, and the checker says so.
  const hatchBay = { ...LEVELS[0].target, w: 3, l: 5.6 };
  const busPark = { ...LEVELS[0], vehicle: 'bus', target: hatchBay, spawn: { x: 0, z: -10, rot: 0 } };
  check(
    !evaluateParking(carBox(hatchBay.x, hatchBay.z, 0, vehicleOf('bus')), 0, hatchBay, true).ok,
    'a bus parked in a hatchback bay',
  );
  check(
    staticProblems(busPark).some((m) => m.includes('smaller than the City Bus')),
    'a hatchback-sized bay was accepted for a bus',
  );
  for (const v of VEHICLES.filter((x) => x.length > 5.6 || x.width > 3))
    check(
      staticProblems({ ...LEVELS[0], vehicle: v.id }).some((m) => m.includes('smaller than')),
      `${v.name} accepted in the first level's hatchback bay`,
    );
  // The same scripted run that parks the hatchback does not park a bus.
  check(
    !replaySolution(busPark, SOLUTIONS['first-steps']).parked,
    'a bus replayed a hatchback solution into a hatchback bay',
  );

  // Levels: every vehicle id is known, each larger vehicle has a level, and the vehicle fits the bay it must park in.
  const used = new Set(LEVELS.map((l) => l.vehicle ?? DEFAULT_VEHICLE));
  for (const l of LEVELS)
    check(
      VEHICLES.some((v) => v.id === (l.vehicle ?? DEFAULT_VEHICLE)),
      `${l.id}: unknown vehicle ${l.vehicle}`,
    );
  for (const id of ['van', 'minibus', 'bus', 'box-truck']) check(used.has(id), `no level drives the ${id}`);
}

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
    lot: { w: 20, l: 80 },
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

  // A landing between ramp segments is a surface, not a storey: it gets no number and never counts as 'the floor you are on'.
  const withLanding: LevelDef = {
    ...two,
    floors: [
      two.floors![0],
      { id: 'step', y: 1.5, area: [{ x: 0, z: 0, hw: 3, hl: 3, rot: 0 }], landing: true },
      two.floors![1],
    ],
  };
  check(floorLabel(withLanding, 'upper') === '1', 'a landing does not take a floor number');
  check(
    floorHud(withLanding, 'step', 1.5).pill === '🅿 Ground',
    'standing on a landing counts as the nearest storey (nearer ground)',
  );
  check(
    floorHud(withLanding, 'step', 2.2).pill === '🅿 Floor 1',
    'standing on a landing counts as the nearest storey (nearer top)',
  );
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
  const fallback = ambientLevels(out, false);
  const withEnv = ambientLevels(out, true);
  check(
    fallback.hemi === out.hemi && fallback.env === 0,
    'without an environment map the hemisphere light does all the ambient work',
  );
  check(withEnv.env > 0 && withEnv.hemi < fallback.hemi, 'with an environment map the hemisphere light only fills in');
  check(ambientLevels(deep, true).env < withEnv.env, 'environment light follows the covered/underground dimming');
  check(deep.sky < under.sky && under.sky < out.sky, 'underground is darker than covered, covered than outdoors');
  const dusk = lightTarget(false, false, true);
  check(
    dusk.sun > 0 && dusk.sun < out.sun + 1 && dusk.hemi > under.hemi * 0.5,
    'dusk is outdoor light, still bright enough to drive',
  );
  check(lightTarget(true, false, true).sun === 0, 'a deck still switches the sun off at dusk');
  // Twilight District is gone (CARP-135); the dusk lighting stays, and other worlds keep using it.
  check(
    LEVELS.some((l) => l.theme === 'dusk') && LEVELS.some((l) => (l.arrows?.length ?? 0) > 0),
    'dusk lighting and one-way arrows are still in use',
  );
}

console.log('Floors and ramps');
{
  // Ground floor z -30..0, a 15 m ramp (11.3 deg) from z 0 to 15, upper floor (y = 3) z 15..35.
  const rampLevel = (rampLen: number): LevelDef => ({
    ...LEVELS[0],
    lot: { w: 20, l: 80 },
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
      impact = Math.max(impact, car.resolveCollisions(car.reachable(surf, obs), surf));
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

  // Reverse held on a downhill ramp: slope gravity must not keep restarting the soft-reverse delay.
  for (const v0 of [0, 2]) {
    const c = new CarPhysics();
    c.reset(0, 10, Math.PI, steepSurf);
    c.layer = 'ramp';
    c.v = v0;
    let since: number | null = null;
    let reversed = false;
    for (let i = 0; i < Math.round(5 / STEP) && !reversed; i++) {
      const now = i * STEP;
      since = trackReverseHold(since, -1, c.v, now);
      const held = since === null ? 0 : now - since;
      c.step(STEP, { throttle: softReverse(-1, held, c.v), steer: 0, handbrake: false }, steepSurf);
      reversed = c.v < -0.3;
    }
    check(
      c.pitch < -0.1 && reversed,
      `holding reverse downhill from ${v0} m/s still reverses (v ${c.v.toFixed(2)}, pitch ${c.pitch.toFixed(2)})`,
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
    car.resolveCollisions(car.reachable(surf, obs), surf) === 0 && Math.abs(car.z - 25) < 1e-9,
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
  check(
    floorProblems({
      ...lvl,
      floors: [lvl.floors![0], { ...lvl.floors![1], area: [{ x: 0, z: 0, hw: 500, hl: 5, rot: 0 }] }],
    }).some((m) => m.includes('not inside the lot')),
    'a floor poking out of the lot should be rejected',
  );
  check(
    holdComplete(PARK_HOLD) && holdComplete(PARK_HOLD - 1e-12) && !holdComplete(PARK_HOLD - 1e-3),
    'park hold: one shared completion check',
  );
  {
    // After a push-out on the ramp the height and pitch must match the surface under the axles.
    const c = new CarPhysics();
    c.reset(0, 6, 0, surf);
    c.z += 0.7;
    c.resolveCollisions([{ x: 0, z: c.z + 2.3, hw: 3, hl: 1, rot: 0 }], surf);
    const ref = new CarPhysics();
    ref.reset(c.x, c.z, c.heading, surf);
    check(
      Math.abs(c.y - ref.y) < 1e-9 && Math.abs(c.pitch - ref.pitch) < 1e-9,
      'collision push-out left y/pitch stale',
    );
  }
  check(!replaySolution(rampLevel(15), []).parked, 'standing on the ground floor counted as parked upstairs');
  const wrongFloor = replaySolution({ ...lvl, target: { ...lvl.target, z: 25, floor: 'ground' } }, climb);
  check(!wrongFloor.parked, 'parking on the wrong floor counted as parked');

  // Flat levels: no floors declared, so physics, obstacles and parking are as before.
  for (const [i, flat] of LEVELS.entries()) {
    if (flat.floors) continue; // multi-storey levels have their own checks above and in levelChecks
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
      a.resolveCollisions(a.reachable(fs, lo), fs);
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
check(
  gripLost(null, 100) === 100 && gripLost(100, 180) === 100,
  'a cancelled touch remembers when it was first lost, not the latest cancel',
);
check(
  !gripExpired(null, 1e9) && !gripExpired(100, 100 + GRIP_GRACE_MS - 1) && gripExpired(100, 100 + GRIP_GRACE_MS),
  'a cancelled touch is held for the grace period, then released; a live touch never expires',
);
check(steerFromWheel(turnWheel(80, 20, 20 - 80)) === 0, 'letting go springs the wheel back to straight ahead');
check(
  isShortcut({ ctrlKey: false, metaKey: true, altKey: false }) &&
    isShortcut({ ctrlKey: true, metaKey: false, altKey: false }) &&
    isShortcut({ ctrlKey: false, metaKey: false, altKey: true }) &&
    !isShortcut({ ctrlKey: false, metaKey: false, altKey: false }),
  'Cmd/Ctrl/Alt combos are shortcuts, not drive keys',
);
check(isMetaKey('MetaLeft') && isMetaKey('MetaRight') && !isMetaKey('KeyS'), 'Meta keyup is recognised');
{
  check(softReverse(1, 0) === 1 && softReverse(1, 5) === 1, 'soft reverse: forward throttle is untouched');
  check(softReverse(-1, REVERSE_DELAY - 0.01) === 0, 'soft reverse: a brief tap does not reverse');
  check(softReverse(-1, 0, 3) === -1, 'soft reverse: a tap while rolling forward still brakes at once');
  check(softReverse(-1, 0, 0.05) === 0, 'soft reverse: at rest the delay applies');
  check(softReverse(-1, REVERSE_DELAY, 0) === -REVERSE_START, 'soft reverse: ramp starts at REVERSE_START');
  check(trackReverseHold(null, -1, 0, 5) === 5, 'reverse hold: starts at rest');
  check(trackReverseHold(5, -1, 0.2, 6) === 5, 'reverse hold: a slope blip over the brake speed keeps it');
  check(trackReverseHold(null, -1, 3, 5) === null, 'reverse hold: braking from speed does not start it');
  check(
    trackReverseHold(5, 0, 0, 6) === null && trackReverseHold(5, 1, 0, 6) === null,
    'reverse hold: released clears',
  );
  const a = softReverse(-1, REVERSE_DELAY + 0.05);
  const b = softReverse(-1, REVERSE_DELAY + 0.3);
  check(a < 0 && a > -0.6 && b < a && softReverse(-1, 10) === -1, 'soft reverse: eases in to full pull');
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
  // Gear lever: gate position <-> gear.
  check(gearFromGate(0) === 'D' && gearFromGate(0.49) === 'D', 'top half of the gate is Drive');
  check(gearFromGate(0.5) === 'R' && gearFromGate(1) === 'R', 'bottom half of the gate is Reverse');
  check(gateSlot('D') === 0 && gateSlot('R') === 1, 'gate slots: D top, R bottom');
  check(gearFromGate(gateSlot('D')) === 'D' && gearFromGate(gateSlot('R')) === 'R', 'slot round-trips to its gear');
  check(gatePos(-50, 100, 80) === 0 && gatePos(500, 100, 80) === 1, 'lever position is clamped to the gate');
  check(Math.abs(gatePos(140, 100, 80) - 0.5) < 1e-9 && gatePos(10, 0, 0) === 0, 'lever position is proportional');
  check(
    gearFromKey('ArrowUp', 'R') === 'D' && gearFromKey('ArrowDown', 'D') === 'R',
    'arrow keys move the lever to D / R',
  );
  check(gearFromKey('Home', 'R') === 'D' && gearFromKey('End', 'D') === 'R', 'Home / End jump to D / R');
  check(gearFromKey('ArrowLeft', 'R') === 'R' && gearFromKey('KeyA', 'D') === null, 'other keys leave the gear alone');
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

console.log('Rear mirror cost');
check(mirrorAllowed('high'), 'the mirror is drawn on High');
check(!mirrorAllowed('low'), 'the mirror is shed on Low (setting or slow-frame downgrade)');

console.log('Shared car geometry');
{
  const scene = new THREE.Group();
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const wheelMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  wheelMesh.name = 'wheel-front-left';
  scene.add(bodyMesh, wheelMesh);
  toTemplate(scene);
  check(MODEL_SHARED.has(bodyMesh.geometry), 'body geometry is marked shared');
  check(MODEL_SHARED.has(wheelMesh.geometry), 'wheel geometry (reparented out of the scene) is marked shared');
}

console.log('Star rules');
for (const lvl of LEVELS) {
  const { three, two } = lvl.stars;
  check(
    0 < three && three < two && two < lvl.time,
    `${lvl.id}: stars need 0 < three (${three}) < two (${two}) < time (${lvl.time})`,
  );
  // Tuned against the recorded solution: a human plays ~1.3-1.6x it, so three stays within 1.2-2x.
  const sol = SOLUTIONS[lvl.id];
  const best = sol ? replaySolution(lvl, sol).finishTime : null;
  if (best !== null) {
    check(
      three >= best * 1.2 && three <= best * 2,
      `${lvl.id}: three-star ${three}s should be 1.2-2x the solution (${best.toFixed(1)}s)`,
    );
    // Touch and trackpad drivers pay for every forward/reverse change: a lever drag (or a trackpad click on it), the
    // reverse delay and the eased-in pull, none of which the scripted solution has. Keep the stars reachable for them.
    let changes = 0;
    let last = 0;
    for (const seg of sol ?? []) {
      const dir = Math.sign(seg.throttle);
      if (dir === 0) continue;
      if (last !== 0 && dir !== last) changes++;
      last = dir;
    }
    check(
      three >= best * 1.3 + changes * 0.6,
      `${lvl.id}: three-star ${three}s too tight for touch (needs ${(best * 1.3 + changes * 0.6).toFixed(0)}s: solution ${best.toFixed(1)}s, ${changes} gear changes)`,
    );
    check(
      two >= best * 1.7 + changes * 0.8,
      `${lvl.id}: two-star ${two}s too tight for touch (needs ${(best * 1.7 + changes * 0.8).toFixed(0)}s: solution ${best.toFixed(1)}s, ${changes} gear changes)`,
    );
  }
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
console.log('Load timeout');
{
  const slow = new Promise<string>((r) => setTimeout(() => r('late'), 200));
  const out = await withTimeout(slow, 10, 'slow').then(
    () => 'resolved',
    (e: Error) => e.message,
  );
  check(out === 'slow timed out after 10 ms', 'withTimeout rejects a stalled promise');
  check((await withTimeout(Promise.resolve(7), 50)) === 7, 'withTimeout passes a fast result through');
  const rej = await withTimeout(Promise.reject(new Error('boom')), 50).catch((e: Error) => e.message);
  check(rej === 'boom', 'withTimeout passes rejections through');
  let timedOut = false;
  await withTimeout(new Promise<void>(() => undefined), 5, 'x', () => (timedOut = true)).catch(() => undefined);
  check(timedOut, 'withTimeout calls onTimeout so the caller can abort the work');
  // A stalled download must be aborted so the next attempt issues a new request (three.js would
  // otherwise dedupe it onto the hung one).
  (globalThis as { __APP_BUILD__?: string }).__APP_BUILD__ = 'validate'; // normally injected by Vite
  const realFetch = globalThis.fetch;
  let hits = 0;
  let aborted = false;
  // Keep the request alive: Node holds the AbortSignal.any() dependents that FileLoader passes to fetch
  // weakly, so once nothing references the pending fake request a GC can drop its abort listener and the
  // abort is never seen (flaky: loading[url] stays set and the retry is deduped onto the hung request).
  const pinned: Request[] = [];
  globalThis.fetch = ((input: Request) => {
    hits++;
    pinned.push(input);
    if (hits > 1) return Promise.resolve(new Response(null, { status: 404 }));
    // First request never answers; it only ends when aborted.
    return new Promise<Response>((_res, rej) =>
      input.signal.addEventListener('abort', () => {
        aborted = true;
        rej(new DOMException('aborted', 'AbortError'));
      }),
    );
  }) as typeof fetch;
  const warn = console.warn;
  console.warn = () => undefined;
  await loadCarModels(['__stall_test__'], undefined, 80, 'http://models.test/', 2, 1);
  console.warn = warn;
  globalThis.fetch = realFetch;
  check(aborted, 'a timed-out download is aborted');
  check(hits === 2, `a second attempt issues a new request after the first times out (saw ${hits})`);
}
console.log('Model load retry and concurrency');
{
  let active = 0;
  let peak = 0;
  const done: number[] = [];
  await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    done.push(n);
  });
  check(peak === 2 && done.length === 6, 'mapLimit runs every item with at most `limit` in flight');
  let calls = 0;
  const v = await retry(() => (++calls < 3 ? Promise.reject(new Error('flaky')) : Promise.resolve('ok')), 3, 1);
  check(v === 'ok' && calls === 3, 'retry succeeds after transient failures');
  let calls2 = 0;
  const msg = await retry(() => (++calls2, Promise.reject(new Error('down'))), 2, 1).catch((e: Error) => e.message);
  check(msg === 'down' && calls2 === 2, 'retry gives up after the attempt limit with the last error');
  check(backoffMs(0, 100, 1000) === 100 && backoffMs(2, 100, 1000) === 400, 'backoff doubles');
  check(backoffMs(10, 100, 1000) === 1000, 'backoff is capped');
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
// Ids this build doesn't list (older/smaller build, removed level) survive the next save.
{
  const raw = JSON.stringify({
    v: 2,
    stars: { [ids[0]]: 1, gone: 3, bad: 9 },
    unlocked: [ids[0], 'gone'],
    best: { [ids[0]]: 30, gone: 12, junk: -1 },
  });
  const p = load(raw);
  check(!('gone' in p.stars) && !p.unlocked.includes('gone'), 'unknown ids stay out of in-memory progress');
  recordWin(p, four, 0, 2);
  recordBest(p, ids[0], 25);
  saveProgress(p);
  const saved = JSON.parse(store.value as string);
  check(saved.stars.gone === 3 && saved.stars.bad === 3, 'unknown level stars are kept on save (clamped)');
  check(saved.best.gone === 12 && !('junk' in saved.best), 'unknown best times are kept on save, junk dropped');
  check(saved.unlocked.includes('gone'), 'unknown unlocked ids are kept on save');
  check(saved.stars[ids[0]] === 2 && saved.best[ids[0]] === 25, 'known ids still update');
}
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
check(mergeUpdate('optional', 'none') === 'none', 'a none result clears a stale optional');
check(mergeUpdate('required', 'none') === 'required', 'required is never downgraded');
check(mergeUpdate('none', 'optional') === 'optional', 'optional replaces none');
check(
  shouldPrompt(null, 'b1') && shouldPrompt('b1', 'b2') && !shouldPrompt('b1', 'b1'),
  'newer build re-prompts after dismiss',
);
check(
  reloadUrl('https://x.test/g/?a=1&_u=5#h', 99) === 'https://x.test/g/?a=1&_u=99',
  'reload url busts cache without stacking',
);
const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
check(
  (await checkForUpdate(me, 'v.json', 50, ok(rem('1.3.0', 'd', '1.3.0')))) === 'required',
  'fetched required update',
);
check((await checkForUpdate(me, 'v.json', 50, ok(rem('1.3.0', 'd')))) === 'optional', 'fetched optional update');
check((await fetchUpdate(me, 'v.json', 50, ok(rem('1.3.0', 'd')))).build === 'd', 'fetch reports the remote build');
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

console.log('Worlds');
{
  check(
    LEVELS.every((l) => LOCATIONS.includes(l.location)),
    'every level has a known location',
  );
  const order = LEVELS.map((l) => LOCATIONS.indexOf(l.location));
  check(
    order.every((n, i) => i === 0 || n >= order[i - 1]),
    'levels are listed in world order',
  );
  check(
    LOCATIONS.every((w) => worldLevels(LEVELS, w).length > 0 && WORLDS[w].name),
    'every world has levels and a name',
  );
  const [w1, w2, w3] = LOCATIONS;
  const p = parseProgress(null, ids);
  const lv = (id: string) => LEVELS.find((l) => l.id === id)!;
  check(worldUnlocked(p, LEVELS, w1) && !worldUnlocked(p, LEVELS, w2), 'a fresh save opens only the first world');
  check(worldUnlocked(p, LEVELS, w2, true), 'admin opens every world');
  const first1 = worldLevels(LEVELS, w1);
  for (const l of first1.slice(0, -1)) p.stars[l.id] = 1;
  check(!worldComplete(p, LEVELS, w1) && !worldUnlocked(p, LEVELS, w2), 'one level short keeps the next world shut');
  p.stars[first1[first1.length - 1].id] = 2;
  check(worldComplete(p, LEVELS, w1) && worldUnlocked(p, LEVELS, w2), 'finishing a world opens the next');
  check(!worldUnlocked(p, LEVELS, w3), 'the world after next stays shut');
  const s = worldStars(p, LEVELS, w1);
  check(s.got === first1.length + 1 && s.max === first1.length * 3, 'world star total sums its levels');
  const open2 = worldLevels(LEVELS, w2)[0];
  check(levelPlayable(p, LEVELS, open2), 'the first level of an open world is playable even if not saved unlocked');
  check(!levelPlayable(p, LEVELS, worldLevels(LEVELS, w2)[1]), 'later levels still follow their own unlock');
  const locked = worldLevels(LEVELS, w3)[0];
  p.unlocked.push(locked.id);
  check(!levelPlayable(p, LEVELS, locked), 'an unlocked level in a locked world is not playable');
  check(resumeLevel(parseProgress(null, ids), LEVELS) === 0, 'a fresh save resumes at the first level');
  check(LEVELS[resumeLevel(p, LEVELS)].location === w2, 'resume never lands in a locked world');
  check(
    lv('basement').location === 'multi-storey' && lv('van-garage').location === 'industrial',
    'levels sit in the right worlds',
  );

  check(
    !LEVELS.some((l) => (l.location as string) === 'twilight') && !('twilight' in WORLDS),
    'Twilight District is removed',
  );
  check(
    [
      'reverse-gate',
      'tight-squeeze',
      'slalom-reverse',
      'the-finale',
      'dusk-gate',
      'twilight-squeeze',
      'dusk-slalom',
      'night-finale',
    ].every((id) => !LEVELS.some((l) => l.id === id)),
    'no Twilight District stage is in the level list',
  );

  // Proving Ground is appended after the older worlds, so nobody who finished them is locked out again.
  const proving = worldLevels(LEVELS, 'proving');
  check(LOCATIONS[LOCATIONS.length - 2] === 'proving' && proving.length === 8, 'Proving Ground has 8 levels');
  check(
    LEVELS.slice(-13, -5).every((l) => l.location === 'proving'),
    'the 8 Proving Ground levels sit right before Master Class',
  );
  // Master Class is the newest world and sits after Proving Ground.
  const master = worldLevels(LEVELS, 'master-class');
  check(
    LOCATIONS[LOCATIONS.length - 1] === 'master-class' && master.length === 5,
    'Master Class is last, with 5 levels',
  );
  check(
    LEVELS.slice(-5).every((l) => l.location === 'master-class'),
    'the 5 newest levels are the last in play order',
  );
  check(new Set(LEVELS.map((l) => l.name)).size === LEVELS.length, 'every level has a unique name');
  check(new Set(LEVELS.map((l) => l.hint)).size === LEVELS.length, 'every level has a unique hint');
  // Margin: no route may rely on scraping past things. The recorded solution keeps 0.1 m clear of every obstacle
  // (the search that found it asked for 0.15-0.2 m).
  for (const l of [...proving, ...master]) {
    const r = replaySolution(l, SOLUTIONS[l.id], 0.1);
    check(
      r.parked && r.tight === 0,
      `${l.id}: the recorded solution stays 0.1 m clear of everything (${r.tight} tight steps)`,
    );
  }
}

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

check(canRunGame(false, false), 'game may run with no overlay');
check(
  !canRunGame(true, false) && !canRunGame(false, true) && !canRunGame(true, true),
  'Settings or a lost context blocks the game',
);
{
  let used = false;
  let blocked = true;
  const act = (): boolean => !blocked;
  used = runModalAction(used, act);
  check(!used, 'a blocked modal action leaves the button live');
  blocked = false;
  used = runModalAction(used, act);
  check(used, 'the retried modal action runs and marks the button used');
  let calls = 0;
  runModalAction(used, () => void calls++);
  check(calls === 0, 'a used modal button does not fire twice');
  check(runModalAction(false, () => void calls++) && calls === 1, 'a void action counts as run');
}
check(padConfirmAction(true, false) === 'click', 'pad A clicks a focused nav button even with actions off');
check(padConfirmAction(false, true) === 'enter', 'pad A runs Enter when actions are on');
check(padConfirmAction(false, false) === 'none', 'pad A does nothing behind Settings');

{
  // Fake AudioContext: tones must not queue while locked; 'interrupted' must resume.
  let state = 'suspended';
  let resumes = 0;
  let oscillators = 0;
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = {
      connect: () => n,
      start: () => {},
      stop: () => {},
      frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, value: 0 },
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, value: 0 },
    };
    return n;
  };
  class FakeCtx {
    currentTime = 0;
    sampleRate = 44100;
    destination = {};
    get state(): string {
      return state;
    }
    resume(): Promise<void> {
      resumes++;
      return Promise.resolve();
    }
    suspend(): Promise<void> {
      return Promise.resolve();
    }
    createOscillator(): unknown {
      oscillators++;
      return node();
    }
    createGain = node;
    createBiquadFilter = node;
    createBufferSource = node;
    createBuffer(): unknown {
      return { sampleRate: 44100, getChannelData: () => new Float32Array(11025) };
    }
  }
  const g = globalThis as unknown as { AudioContext?: unknown };
  const prev = g.AudioContext;
  g.AudioContext = FakeCtx;
  const sfx = new Sfx();
  sfx.unlock();
  check(resumes === 1, 'unlock resumes a suspended context');
  sfx.beep();
  sfx.crash();
  sfx.win();
  check(oscillators === 0, 'no tones are queued while the context is not running');
  state = 'interrupted';
  sfx.unlock();
  sfx.resume();
  check(resumes === 3, "an 'interrupted' context is resumed");
  state = 'closed';
  sfx.unlock();
  check(resumes === 3, 'a closed context is not resumed');
  state = 'running';
  sfx.unlock();
  sfx.beep();
  check(resumes === 3 && oscillators === 1, 'a running context plays tones without resume');
  g.AudioContext = prev;
}

// --- Sound (FOX-246) ---
{
  check(engineParams(0, 3.5).gain === 0, 'engine is silent when stopped');
  const slow = engineParams(1, 3.5);
  const fast = engineParams(3.5, 3.5);
  check(fast.freq > slow.freq && fast.gain > slow.gain, 'engine pitch and volume rise with speed');
  check(engineParams(-2, 3.5).freq === engineParams(2, 3.5).freq, 'engine hum ignores direction');
  check(engineParams(99, 3.5).freq === fast.freq, 'engine hum is capped at top speed');
  check(
    winNotes(1).length < winNotes(2).length && winNotes(2).length < winNotes(3).length,
    'more stars, longer jingle',
  );
  check(
    winNotes(0).length === winNotes(1).length && winNotes(9).length === winNotes(3).length,
    'jingle stars are clamped',
  );
  check(VOLUME_STEPS.length === 3 && VOLUME_STEPS.every((v) => v > 0 && v <= 1), 'volume steps are valid gains');
  const store: Record<string, string> = {
    'car-parking-3d:settings:v1': JSON.stringify({ music: false, sfxVol: 0, musicVol: 7 }),
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store[k] ?? null };
  const ls = loadSettings();
  check(!ls.music && ls.sfxVol === 0 && ls.musicVol === 1, 'sound settings load, bad volume falls back');
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

// --- Materials (FOX-237) ---
{
  const N = 64;
  for (const kind of ['asphalt', 'concrete'] as const) {
    const px = surfacePixels(kind, N);
    check(
      px.color.length === N * N * 4 && px.normal.length === N * N * 4 && px.rough.length === N * N * 4,
      `${kind} maps are N x N RGBA`,
    );
    let nzMin = 255;
    let rMin = 255;
    let rMax = 0;
    let colMin = 255;
    let colMax = 0;
    for (let i = 0; i < N * N; i++) {
      nzMin = Math.min(nzMin, px.normal[i * 4 + 2]);
      rMin = Math.min(rMin, px.rough[i * 4 + 1]);
      rMax = Math.max(rMax, px.rough[i * 4 + 1]);
      colMin = Math.min(colMin, px.color[i * 4]);
      colMax = Math.max(colMax, px.color[i * 4]);
    }
    check(nzMin >= 128, `${kind} normals all point out of the surface`);
    check(rMax - rMin > 8 && rMin > 0.5 * 255, `${kind} roughness varies a little but stays matte`);
    check(colMax - colMin > 10, `${kind} colour has grain`);
    const again = surfacePixels(kind, N);
    check(
      again.color.every((v, i) => v === px.color[i]),
      `${kind} texture is deterministic`,
    );
  }
  // Tileable: the normal map is built from wrapped neighbours, so a constant field gives a flat normal and
  // a field that is symmetric across the seam gives the same slope on both sides of it.
  const flat = normalFromHeight(new Float32Array(16).fill(0.5), 4, 5);
  check(flat[0] === 128 && flat[1] === 128 && flat[2] === 255, 'flat height gives the straight-up normal');
  const ramp = new Float32Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ramp[y * 4 + x] = x / 3;
  const rn = normalFromHeight(ramp, 4, 2);
  check(rn[4 * 1] < 128 && rn[4 * 2] < 128, 'a slope rising along +x tilts the normal towards -x');
  check(rn[0] > 128 || rn[0] === rn[4 * 3] || rn[0] > rn[4 * 1], 'the seam column wraps to its neighbours');
  const uvGeo = new THREE.BoxGeometry(12, 3, 6);
  tileBoxUV(uvGeo, 6);
  const uvs = uvGeo.attributes.uv as THREE.BufferAttribute;
  check(
    Math.max(...Array.from({ length: 4 }, (_, i) => uvs.getX(8 + i))) === 2,
    'box top UVs repeat once per tile width',
  );
  check(
    Math.max(...Array.from({ length: 4 }, (_, i) => uvs.getY(8 + i))) === 1,
    'box top UVs repeat once per tile length',
  );
  check(classifyTexel(58, 58, 62).kind === 'rubber', 'dark palette texel is rubber');
  check(classifyTexel(215, 232, 252).kind === 'glass', 'pale blue palette texel is glass');
  check(classifyTexel(255, 184, 28).kind === 'paint', 'yellow palette texel is paint');
  check(classifyTexel(96, 144, 208).kind === 'paint', 'mid blue palette texel is paint, not glass');
  check(classifyTexel(255, 255, 255).kind === 'paint', 'pure white is paint, not glass');
  const ctl = paintControlPixels([58, 58, 62, 255, 215, 232, 252, 255, 255, 184, 28, 255]);
  check(ctl[0] === 0 && ctl[1] > 200, 'rubber: no clear-coat, rough');
  check(ctl[4] === 255 && ctl[5] < 20, 'glass: full clear-coat, almost mirror smooth');
  check(ctl[8] === 255 && ctl[9] > 60 && ctl[9] < 160, 'paint: clear-coat over a semi-gloss base');
}

// Camera views (FOX-272): cycle order, saved-value parsing, blending, poses.
{
  check(CAM_MODES.join() === 'chase,cockpit,hood,top,corner', 'camera views cycle in a fixed order');
  let m: CamMode = CAM_MODES[0];
  const seen: string[] = [];
  for (let i = 0; i < CAM_MODES.length; i++) {
    seen.push(m);
    m = nextCamMode(m);
  }
  check(
    m === 'chase' && new Set(seen).size === CAM_MODES.length,
    'one full cycle visits every view and wraps to chase',
  );
  check(
    parseCamMode('top') === 'top' && parseCamMode('cockpit') === 'cockpit',
    'saved views parse (incl. the old top value)',
  );
  check(
    parseCamMode('orbit') === 'chase' && parseCamMode(undefined) === 'chase' && parseCamMode(3) === 'chase',
    'unknown saved view clamps to chase',
  );
  check(parseCamMode('nope', 'top') === 'top', 'a fallback can be given');
  check(nextCamMode('bogus' as never) === 'chase', 'cycling from an unknown view restarts at chase');

  // Persistence: round-trip through localStorage, and unknown / old values.
  const store = new Map<string, string>();
  const gl = globalThis as unknown as { localStorage?: unknown };
  const prevLs = gl.localStorage;
  gl.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const KEY = 'car-parking-3d:settings:v1';
  store.set(KEY, JSON.stringify({ camera: 'hood', autoRear: true }));
  check(
    loadSettings().camera === 'hood' && loadSettings().autoRear === true,
    'saved camera and rear-assist choice load',
  );
  store.set(KEY, JSON.stringify({ camera: 'free-fly' }));
  check(
    loadSettings().camera === 'chase' && loadSettings().autoRear === false,
    'unknown saved camera loads as chase, assist off by default',
  );
  store.set(KEY, JSON.stringify({ camera: 'top' }));
  check(loadSettings().camera === 'top', 'a setting saved before the new views still loads');
  store.set(KEY, 'not json');
  check(loadSettings().camera === 'chase', 'corrupt settings load the default view');
  gl.localStorage = prevLs;

  check(
    advanceBlend(0, 0.15, false) === 0.5 && advanceBlend(0.9, 1, false) === 1,
    'a view blend takes 0.3 s and stops at 1',
  );
  check(advanceBlend(0, 0.01, true) === 1, 'reduced motion: the switch is instant');
  check(
    blendWeight(0) === 0 && blendWeight(1) === 1 && blendWeight(0.5) === 0.5 && blendWeight(2) === 1,
    'blend easing is 0..1 and monotone at the ends',
  );
  check(
    isRigid('cockpit') && isRigid('hood') && !isRigid('chase') && !isRigid('top'),
    'only cockpit and hood are fixed to the car',
  );
  check(
    hidesCeilings('top') && hidesCeilings('corner') && !hidesCeilings('chase') && !hidesCeilings('cockpit'),
    'decks hide in the views from above',
  );
  check(hidesCeilings('chase', true), 'free look hides decks above the car');
  check(
    bodyHidden('cockpit', 1) && !bodyHidden('cockpit', 0.2) && !bodyHidden('hood', 1) && !bodyHidden('chase', 1),
    'the body shell hides only in cockpit view',
  );

  check(
    reverseHold(false, -1) && !reverseHold(true, 1) && reverseHold(true, 0) && !reverseHold(false, 0),
    'reverse detection has hysteresis',
  );
  check(assistMode('chase', false, true) === 'chase', 'assist off: reversing never changes the view');
  check(
    assistMode('chase', true, true) === 'corner' && assistMode('cockpit', true, true) === 'corner',
    'assist on: reversing shows the corner view',
  );
  check(
    assistMode('chase', true, false) === 'chase' && assistMode('top', true, true) === 'top',
    'assist leaves forward driving and top-down alone',
  );

  const car: ViewTarget = { x: 3, y: 0, z: -2, heading: 0, pitch: 0, steer: 0 };
  const chase = viewPose('chase', car);
  check(chase.pz < car.z && chase.py > 3, 'chase sits behind and above the car');
  const top = viewPose('top', car);
  check(top.py > 30 && top.lx === car.x && top.lz === car.z, 'top-down looks straight down at the car from high up');
  const cock = viewPose('cockpit', car);
  check(
    Math.abs(cock.px - (car.x + EYE.x)) < 1e-9 && Math.abs(cock.py - EYE.y) < 1e-9 && cock.lz > cock.pz,
    'cockpit is at the driver seat looking forward',
  );
  const turned = viewPose('cockpit', { ...car, steer: 0.5 });
  check(turned.lx < cock.lx, 'cockpit looks into a right turn');
  const hood = viewPose('hood', car);
  check(hood.py < chase.py && hood.pz > car.z, 'hood is low and forward on the bonnet');
  const rot = viewPose('cockpit', { ...car, heading: Math.PI / 2 });
  check(
    Math.abs(rot.px - (car.x + EYE.z)) < 1e-9 && Math.abs(rot.lz - rot.pz) < 1e-6 && rot.lx > rot.px,
    'poses rotate with the heading',
  );
  const rear = viewPose('corner', car, true);
  const front = viewPose('corner', car, false);
  check(rear.pz < car.z && rear.lz < rear.pz, 'reversing: the corner view is a rear camera looking back');
  check(front.py > 5 && front.lz > front.pz, 'forward: the corner view is a close view from above');
  check(
    viewPose('corner', { ...car, steer: 0.5 }).px < viewPose('corner', { ...car, steer: -0.5 }).px,
    'the corner view favours the side the wheel is turned',
  );

  let f = dragFreeLook(FREE_START, 0, 10);
  check(f.pitch <= 1.45, 'free-look pitch is clamped at the top');
  f = dragFreeLook(f, 0, -10);
  check(f.pitch >= 0.05, 'free-look pitch never goes under the ground');
  check(
    dragFreeLook(FREE_START, 0, 0, 1000).dist === 40 && dragFreeLook(FREE_START, 0, 0, -1000).dist === 4,
    'free-look zoom is clamped',
  );
  const fp = freePose(FREE_START, car);
  check(fp.py > car.y && fp.lx === car.x, 'free look orbits above, looking at the car');
}

{
  // Drag-to-orbit offset (FOX-241): clamps, exact reset, per-view limits, pose offsets.
  const car = { x: 3, y: 0, z: -2, heading: 0.4, pitch: 0, steer: 0 };
  const base = viewPose('chase', car);
  check(applyOrbit(base, orbitCentre(), 'chase', car) === base, 'a centred orbit leaves the pose untouched');
  const far = dragOrbit(orbitCentre(), 'chase', 1, 10, 100);
  check(far.pitch <= 0.9 && far.zoom === 2, 'orbit pitch and zoom are clamped');
  check(dragOrbit(orbitCentre(), 'chase', 0, -10, 0.001).pitch >= -0.7, 'orbit pitch is clamped below');
  check(Math.abs(dragOrbit(orbitCentre(), 'top', 7, 0).yaw) <= Math.PI, 'orbit yaw wraps within one turn');
  const head = dragOrbit(orbitCentre(), 'cockpit', 5, 5, 3);
  check(
    Math.abs(head.yaw - (100 * Math.PI) / 180) < 1e-9 &&
      Math.abs(head.pitch - (35 * Math.PI) / 180) < 1e-9 &&
      head.zoom === 1,
    'cockpit look-around is limited to +-100 deg yaw, +-35 deg pitch, no zoom',
  );
  check(clampOrbit({ yaw: 3, pitch: 0, zoom: 1 }, 'cockpit').yaw < 2, 'switching to cockpit pulls a wide yaw in');
  for (const mode of CAM_MODES) {
    const p = viewPose(mode, car);
    const o = applyOrbit(p, { yaw: 1.2, pitch: -0.7, zoom: 0.5 }, mode, car);
    check(
      ([o.px, o.py, o.pz, o.lx, o.ly, o.lz].every(Number.isFinite) && o.py >= car.y + 0.39) ||
        mode === 'cockpit' ||
        mode === 'hood',
      `${mode}: an orbited camera stays above the floor`,
    );
  }
  const swung = applyOrbit(base, { yaw: Math.PI, pitch: 0, zoom: 1 }, 'chase', car);
  check(
    Math.hypot(swung.px - car.x, swung.pz - car.z) > 1 && swung.pz - car.z > 0 === base.pz - car.z < 0,
    'a half-turn yaw puts the chase camera in front of the car',
  );
  const turned = applyOrbit(viewPose('cockpit', car), { yaw: 0.5, pitch: 0, zoom: 1 }, 'cockpit', car);
  const eye = viewPose('cockpit', car);
  check(
    turned.px === eye.px && turned.pz === eye.pz && turned.lx !== eye.lx,
    'a head turn moves the look, not the eye',
  );
  const zoomed = applyOrbit(base, { yaw: 0, pitch: 0, zoom: 2 }, 'chase', car);
  check(
    Math.hypot(zoomed.px - car.x, zoomed.pz - car.z) > Math.hypot(base.px - car.x, base.pz - car.z),
    'zoom 2 moves the camera further out',
  );
  const anim = startReset({ yaw: 2, pitch: 0.5, zoom: 1.7 });
  const mid = stepReset(anim, 0.15, false);
  check(!mid.done && mid.orbit.yaw < 2 && mid.orbit.yaw > 0, 'reset eases part way after half the time');
  const end = stepReset(anim, 0.2, false);
  check(
    end.done && end.orbit.yaw === 0 && end.orbit.pitch === 0 && end.orbit.zoom === 1 && !isOffCentre(end.orbit),
    'reset returns exactly to the centre',
  );
  check(stepReset(startReset({ yaw: 2, pitch: 0, zoom: 1 }), 0, true).done, 'reset is instant with reduced motion');
  check(!isOffCentre(orbitCentre()) && isOffCentre({ yaw: 0, pitch: 0, zoom: 1.2 }), 'off-centre detection');
  check(pinchFactor(100, 200) < 1 && pinchFactor(200, 100) > 1 && pinchFactor(0, 100) === 1, 'pinch zoom direction');
  check(isDoubleTap(200, 5) && !isDoubleTap(500, 5) && !isDoubleTap(200, 80), 'double-tap detection');
}

{
  // Lot scenery (FOX-238): decoration only, never inside the lot walls, deterministic, and no collision shapes.
  for (const [i, def] of LEVELS.entries()) {
    const flat = def.floors === undefined;
    const d = detailLayout(def, i, flat);
    const bad = detailProblems(def, d);
    check(
      bad.length === 0,
      `${def.id}: scenery stays outside the lot walls${bad.length ? ` (${bad.join(', ')})` : ''}`,
    );
    check(
      JSON.stringify(d) === JSON.stringify(detailLayout(def, i, flat)),
      `${def.id}: scenery layout is deterministic`,
    );
    check(
      !def.spawn || !d.poles.some((p) => Math.hypot(p.x - def.spawn!.x, p.z - def.spawn!.z) < POLE_CLEAR),
      `${def.id}: no light pole near the spawn`,
    );
    check(
      flat ? d.poles.length >= 2 && d.posts.length > 0 && d.rails.length > 0 : d.poles.length === 0,
      `${def.id}: scenery by lot type`,
    );
  }
}

{
  // Replay and ghost.
  const rec = new Recorder(6);
  for (let i = 0; i < 120; i++) rec.step({ x: i * 0.05, y: 0, z: -i * 0.02, heading: i * 0.01, pitch: 0 });
  check(rec.frames.length === 20 && Math.abs(rec.frames[1].x - 0.3) < 1e-9, 'recorder keeps one pose every N steps');
  const big = new Recorder(1);
  for (let i = 0; i < MAX_FRAMES + 50; i++) big.step({ x: 0, y: 0, z: 0, heading: 0, pitch: 0 });
  check(big.frames.length === MAX_FRAMES, 'recorder is capped');
  const enc = encodeFrames(rec.frames);
  const dec = decodeFrames(enc);
  check(
    !!dec &&
      dec.length === 20 &&
      Math.abs(dec[19].x - rec.frames[19].x) < 0.011 &&
      Math.abs(dec[19].z - rec.frames[19].z) < 0.011,
    'encode/decode round-trips within a centimetre',
  );
  check(fitsCap(enc), 'a 1 s run fits the storage cap');
  check(
    decodeFrames([1, 2, 3]) === null && decodeFrames([1.5, 0, 0, 0, 0]) === null && decodeFrames('x') === null,
    'malformed recordings are rejected',
  );
  const frames = [
    { x: 0, y: 0, z: 0, heading: 3.1, pitch: 0 },
    { x: 2, y: 1, z: 4, heading: -3.1, pitch: 0.2 },
  ];
  const mid = poseAt(frames, 0.5 / REPLAY_HZ)!;
  check(
    mid.x === 1 && mid.z === 2 && Math.abs(Math.abs(mid.heading) - Math.PI) < 0.1,
    'poseAt interpolates, turning the short way',
  );
  check(poseAt(frames, 99)!.x === 2 && poseAt(frames, -1)!.x === 0 && poseAt([], 1) === null, 'poseAt clamps');
  check(duration(frames) === 1 / REPLAY_HZ, 'duration comes from the sample count');
  check(
    beatsGhost(undefined, 12) && beatsGhost({ time: 12, data: enc }, 11) && !beatsGhost({ time: 12, data: enc }, 12),
    'only a faster run replaces the ghost',
  );
  const huge = Array.from({ length: 20_000 }, () => 123456);
  const old = { time: 12, data: enc };
  check(
    nextGhost(old, 11, enc)?.time === 11 &&
      nextGhost(old, 12, enc) === old &&
      nextGhost(undefined, 5, huge) === undefined,
    'nextGhost keeps the faster ghost',
  );
  check(nextGhost(old, 11, huge) === undefined, 'a faster run too big to store drops the stale slower ghost');
  check(!beatsGhost(undefined, 0) && !beatsGhost(undefined, NaN), 'a bad time never becomes a ghost');
  const ghosts = parseGhosts(
    { a: { time: 5, data: enc }, b: { time: 5, data: [1] }, zz: { time: 5, data: enc }, c: { time: -1, data: enc } },
    ['a', 'b', 'c'],
  );
  check(Object.keys(ghosts).join() === 'a', 'stored ghosts are validated per known level');
  // Ghosts for unknown level ids are written back, not pruned.
  const gl = globalThis as unknown as { localStorage?: unknown };
  const prevLs = gl.localStorage;
  let stored: string | null = JSON.stringify({ a: { time: 5, data: enc }, zz: { time: 7, data: enc } });
  gl.localStorage = {
    getItem: () => stored,
    setItem: (_k: string, v: string) => {
      stored = v;
    },
  };
  const loaded = loadGhosts(['a', 'b']);
  check(Object.keys(loaded).join() === 'a', 'unknown ghosts stay out of memory');
  loaded.b = { time: 6, data: enc };
  saveGhosts(loaded);
  check(
    Object.keys(JSON.parse(stored as string))
      .sort()
      .join() === 'a,b,zz',
    'ghosts for unknown level ids survive a save',
  );
  gl.localStorage = prevLs;
}

console.log('Accessibility');
{
  const css = readFileSync('src/style.css', 'utf8');
  const rule = (sel: string): string => css.match(new RegExp(`^${sel} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  check(
    /touch-action:\s*none/.test(rule('#modal-backdrop')) &&
      !/touch-action:\s*none/.test(rule('#modal')) &&
      /touch-action:\s*pan-y/.test(rule('#modal \\.panel')),
    'only the modal backdrop surface is touch-action none (orbit drag); #modal and the panel allow pan-y',
  );
  check(
    parseTextSize('large') === 'large' && parseTextSize('huge') === 'normal',
    'text size parses, bad values fall back',
  );
  check(
    TEXT_SIZES.every((t, i) => i === 0 || TEXT_SCALE[t] > TEXT_SCALE[TEXT_SIZES[i - 1]]) && TEXT_SCALE.normal === 1,
    'each text size is larger than the last',
  );
  const base = { inside: true, aligned: true, stopped: true, onFloor: true, ok: true };
  check(parkChecklist(base, false) === '✓ Facing right  ✓ Stopped', 'checklist: all good uses ticks');
  const bad = parkChecklist({ ...base, aligned: false, stopped: false }, true);
  check(bad === '✗ Straight  ✗ Stopped', 'checklist: failures use crosses, not just colour');
}

console.log('Performance budget');
{
  check(probeQuality(FAST_MS, 60, 'low') === 'high', 'probe: fast frames pick High even when the heuristic said Low');
  check(probeQuality(SLOW_MS + 1, 60, 'high') === 'low', 'probe: slow frames pick Low');
  check(
    probeQuality(22, 60, 'high') === 'high' && probeQuality(22, 60, 'low') === 'low',
    'probe: in between keeps the heuristic',
  );
  check(
    probeQuality(10, 3, 'low') === 'low' && probeQuality(0, 0, 'high') === 'high',
    'probe: too few frames keeps the heuristic',
  );
  check(probeQuality(NaN, 60, 'high') === 'high', 'probe: a NaN average keeps the heuristic');
  check(
    parseDetected('low:1000', 1000 + LOW_TTL_MS - 1) === 'low' && parseDetected('low:1000', 1000 + LOW_TTL_MS) === null,
    'saved Low expires after a day so a 30 fps cap is probed again',
  );
  check(
    parseDetected('low', 0) === null && parseDetected('low:x', 0) === null,
    'a Low without a valid timestamp is dropped',
  );
  check(parseDetected('low:5000', 1000) === null, 'a Low saved in the future is dropped');
  check(parseDetected('high', 1e15) === 'high' && parseDetected(null, 0) === null, 'a saved High never expires');
  check(chunkName('assets/index-SmQQBtbV.js') === 'index.js', 'chunk name drops the content hash');
  check(chunkName('assets/vendor-three-a_B-0xYz.js') === 'vendor-three.js', 'chunk name keeps dashes in the stem');
  check(chunkName('index.css') === 'index.css', 'chunk name without a hash is unchanged');
  check(withHeadroom(1000) === 1100 && withHeadroom(1001) === 1200, 'headroom is +10% rounded up to 100 B');
  const built: Chunk[] = [
    { file: 'assets/index-AAAAAAAA.js', raw: 1000, gzip: 400 },
    { file: 'assets/index-BBBBBBBB.css', raw: 100, gzip: 50 },
  ];
  const budget = makeBudget(built);
  check(budgetProblems(built, budget).length === 0, 'a build at the budget baseline passes');
  const grown = [{ ...built[0], gzip: 600 }, built[1]];
  check(budgetProblems(grown, budget).length === 2, 'a grown chunk fails its own limit and the total');
  const extra = [...built, { file: 'assets/new-CCCCCCCC.js', raw: 5000, gzip: 2000 }];
  check(budgetProblems(extra, budget).length >= 1, 'a new unbudgeted chunk still counts towards the total');
  check(sizeTable(built, budget).includes('| total |'), 'size table has a total row');

  // Storefront: every icon / preview the page and manifest point at exists, with the right size.
  const html = readFileSync('index.html', 'utf8');
  const pngSize = (f: string): string => {
    const b = readFileSync(`public/${f}`);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? `${dv.getUint32(16)}x${dv.getUint32(20)}` : 'not a png';
  };
  check(pngSize('apple-touch-icon.png') === '180x180', 'storefront: apple-touch-icon is a 180x180 png');
  check(pngSize('og-image.png') === '1200x630', 'storefront: og-image is a 1200x630 png');
  check(pngSize('favicon-32.png') === '32x32', 'storefront: favicon-32 is a 32x32 png');
  check(existsSync('public/favicon.svg'), 'storefront: favicon.svg exists');
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    icons: { src: string; sizes: string }[];
  };
  for (const ic of manifest.icons) {
    check(
      ic.sizes === 'any' ? existsSync(`public/${ic.src}`) : pngSize(ic.src) === ic.sizes,
      `storefront: manifest icon ${ic.src} exists at ${ic.sizes}`,
    );
  }
  check(
    manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'),
    'storefront: manifest has 192 and 512 png icons',
  );
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:site_name', 'twitter:image']) {
    check(html.includes(`"${tag}"`), `storefront: index.html has ${tag}`);
  }
  check(
    ['href="/favicon.svg"', 'href="/favicon-32.png"', 'href="/apple-touch-icon.png"', 'rel="canonical"'].every((t) =>
      html.includes(t),
    ),
    'storefront: index.html links the favicons, apple-touch-icon and canonical',
  );
  check(
    html.includes('"twitter:image:alt"') && html.includes('id="whats-new"'),
    "storefront: index.html has twitter:image:alt and the what's-new slot",
  );
  check(WHATS_NEW.length > 0 && WHATS_NEW.length <= 120, "storefront: what's-new note is short and not empty");
}

// CARP-134: touches on or just around the wheel / pedals are never a camera drag.
{
  const zones = [
    { left: 16, top: 200, right: 156, bottom: 340 },
    { left: 700, top: 220, right: 800, bottom: 340 },
  ];
  check(inControlZone(80, 270, zones), 'control zone: the wheel itself is guarded');
  check(inControlZone(160, 270, zones), 'control zone: just outside the wheel is guarded');
  check(inControlZone(750, 200, zones), 'control zone: just above a pedal is guarded');
  check(!inControlZone(400, 100, zones), 'control zone: the open game area still orbits');
  check(!inControlZone(400, 270, zones), 'control zone: far between the groups still orbits');
  check(!inControlZone(80, 270, []), 'control zone: no controls, no guard');
}

{
  const list = precacheList(
    ['index.html', 'assets/a-1.js', 'sw.js', 'version.json', 'CNAME', 'assets/a.js.map'],
    ['manifest.webmanifest'],
  );
  check(
    list.join() === './,assets/a-1.js,index.html,manifest.webmanifest',
    'precache keeps the shell and drops sw.js, version.json, maps',
  );
  const src = serviceWorkerSource('abc1234', list);
  check(src.includes(JSON.stringify(cacheName('abc1234'))), 'service worker cache is named after the build');
  check(
    src.includes("'SKIP_WAITING'") && !/\n\s*self\.skipWaiting\(\);/.test(src.split("'message'")[0]),
    'service worker waits for the page before taking over',
  );
  check(
    src.includes("req.mode === 'navigate'") && src.includes('index.html'),
    'service worker serves the cached shell for offline navigation',
  );
  try {
    new Function(src);
  } catch {
    check(false, 'generated service worker is valid JavaScript');
  }
  check(!isUpdateWaiting({ waiting: {} as ServiceWorker }, false), 'a first install is not an update');
  check(
    isUpdateWaiting({ waiting: {} as ServiceWorker }, true) && !isUpdateWaiting({ waiting: null }, true),
    'a waiting worker under a controller is an update',
  );
}

{
  const s = { ...freshRepair(), hp: 40, coins: 500 };
  check(isDamaged(s) && !isDamaged(freshRepair()), 'a car below full HP is damaged');
  check(repairCost(s) === (MAX_HP - 40) * COST_PER_HP, 'repair cost scales with missing HP');
  check(repair(s) && s.hp === MAX_HP && s.coins === 500 - 60 * COST_PER_HP, 'repair restores full HP and spends coins');
  check(!repair(s) && s.coins === 500 - 60 * COST_PER_HP, 'repairing an undamaged car costs nothing');
  const poor = { ...freshRepair(), hp: 40, coins: 10 };
  check(
    !canRepair(poor) && !repair(poor) && poor.hp === 40 && poor.coins === 10,
    'too few coins leaves the car and balance alone',
  );
  const exact = { ...freshRepair(), hp: 0, coins: MAX_HP * COST_PER_HP };
  check(repair(exact) && exact.coins === 0 && exact.hp === MAX_HP, 'exact balance repairs a wreck');
  const junk = parseRepair({ coins: -5, hp: 999 });
  check(junk.coins === 0 && junk.hp === MAX_HP, 'stored repair state is clamped');
  const bad = parseRepair('nope');
  check(bad.coins === 0 && bad.hp === MAX_HP, 'junk storage gives a fresh state');
  const frac = { ...freshRepair(), hp: 99.4, coins: 3 };
  check(
    repairCost(frac) === 2 && repair(frac) && frac.coins === 1 && frac.hp === MAX_HP,
    'fractional HP bills whole coins',
  );
  check(
    repairCost({ ...freshRepair(), hp: -10 }) === MAX_HP * COST_PER_HP,
    'negative HP is billed as a wreck, no more',
  );
  const inf = { ...freshRepair(), hp: 40, coins: Infinity };
  check(!canRepair(inf) && !repair(inf) && inf.hp === 40, 'a non-finite balance never repairs');
  check(!canRepair({ ...freshRepair(), hp: 40, coins: NaN }), 'a NaN balance never repairs');
  check(
    JSON.stringify(parseRepair({ coins: 40, hp: 0 })) === '{"v":1,"coins":40,"hp":0}',
    'a stored wreck keeps 0 HP and its coins',
  );
  check(
    parseRepair({ coins: 40, hp: 25 }).hp === 25 && parseRepair({ coins: 40 }).hp === MAX_HP,
    'stored HP is kept; missing HP is full',
  );
  {
    const gl = globalThis as unknown as { localStorage?: unknown };
    const prev = gl.localStorage;
    const store: Record<string, string> = {};
    gl.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
    };
    check(JSON.stringify(loadRepair()) === JSON.stringify(freshRepair()), 'no saved repair state loads fresh');
    saveRepair({ v: 1, coins: 40, hp: 0 });
    check(Object.keys(store).join() === 'carpark.repair', 'repair state saves under carpark.repair');
    check(JSON.stringify(loadRepair()) === '{"v":1,"coins":40,"hp":0}', 'a saved wreck round-trips');
    store['carpark.repair'] = '{oops';
    check(loadRepair().hp === MAX_HP && loadRepair().coins === 0, 'corrupt repair JSON loads fresh');
    gl.localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    check(loadRepair().hp === MAX_HP, 'throwing getItem loads fresh');
    saveRepair(freshRepair());
    check(true, 'throwing setItem does not escape');
    gl.localStorage = prev;
  }
}

// --- CARP-121: Reload always recovers; no synchronous GPU readbacks ------------------
{
  const timers: (() => void)[] = [];
  const calls: string[] = [];
  const delays: number[] = [];
  const mk = (replaceThrows: boolean): ReloadEnv => ({
    href: 'https://x.test/g/?a=1',
    replace: (u) => {
      calls.push(`replace ${u}`);
      if (replaceThrows) throw new Error('blocked');
    },
    reload: () => calls.push('reload'),
    now: () => 100,
    setTimeout: (fn, ms) => (delays.push(ms), timers.push(fn)),
  });
  recover(mk(false));
  check(
    calls.length === 1 && calls[0].startsWith('replace https://x.test/g/?a=1&_u='),
    'reload: first try is cache-busted',
  );
  check(timers.length === 1, 'reload: a retry is armed in case the page survives');
  check(delays[0] === RELOAD_SETTLE_MS, 'reload: a navigation that did not throw gets the long settle time');
  timers.shift()!();
  check(calls[1].startsWith('replace'), 'reload: a slow replace is retried with replace, never cancelled by reload()');
  timers.shift()!();
  check(calls.length === 3 && calls[2].startsWith('replace'), 'reload: third attempt busts the cache again');
  check(timers.length === 0, `reload: gives up after ${MAX_RELOAD_ATTEMPTS} attempts, no endless loop`);
  calls.length = 0;
  const quiet = console.error;
  console.error = () => undefined;
  recover(mk(true));
  console.error = quiet;
  check(timers.length === 1, 'reload: a throwing location.replace still schedules the fallback');
  check(delays[delays.length - 1] === RELOAD_RETRY_MS, 'reload: a throwing replace retries quickly');
  timers.shift()!();
  check(calls[1] === 'reload', 'reload: a throwing replace falls back to a plain reload');
  check(LOST_STALL_MS > 0 && RELOAD_RETRY_MS > 0, 'reload: timings are positive');

  // Guard: nothing in src may read the GPU back synchronously, and 2D readbacks must use a CPU canvas.
  for (const f of readdirSync('src').filter((n) => n.endsWith('.ts'))) {
    const text = readFileSync(`src/${f}`, 'utf8');
    check(
      !/readPixels|readRenderTargetPixels(?!Async)|toDataURL|toBlob/.test(text),
      `${f}: no synchronous GPU readback`,
    );
    if (text.includes('getImageData')) {
      check(text.includes('willReadFrequently'), `${f}: getImageData only on a willReadFrequently (CPU) canvas`);
    }
  }
}

{
  const t0 = 1_000_000_000_000;
  const e = freshEarn(t0);
  check(pendingCoins(e, t0 + HOUR_MS - 1) === 0, 'no coins before the first hour');
  check(pendingCoins(e, t0 + HOUR_MS) === COINS_PER_HOUR, 'one hour earns one hour of coins');
  check(hoursReady(e, t0 + 100 * HOUR_MS) === MAX_HOURS, 'earning is capped');
  check(hoursReady(e, t0 - HOUR_MS) === 0, 'a clock set back earns nothing');
  check(msToNext(e, t0 + 20 * 60_000) === 40 * 60_000, 'time to next hour counts down');
  const now = t0 + 2.5 * HOUR_MS;
  check(claimEarn(e, now) === 2 * COINS_PER_HOUR, 'claim pays whole hours');
  check(e.lastClaim === t0 + 2 * HOUR_MS && msToNext(e, now) === HOUR_MS / 2, 'claim keeps the leftover half hour');
  check(claimEarn(e, now) === 0, 'claiming twice pays once');
  claimEarn(e, now + 50 * HOUR_MS);
  check(e.lastClaim === now + 50 * HOUR_MS, 'a capped claim restarts the clock');
  const back = parseEarn({ lastClaim: t0 + 5 * HOUR_MS }, t0);
  check(back.lastClaim === t0, 'a future lastClaim is reset to now');
  const junk = parseEarn({ lastClaim: 'x' }, t0);
  check(junk.lastClaim === t0, 'junk storage falls back to a fresh state');
  check(parseEarn(null, t0).lastClaim === t0, 'missing storage is a fresh state');
  // Reload before the first claim: the fresh clock is saved, so the next launch keeps counting from it.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  saveEarn(loadEarn(t0));
  check(
    pendingCoins(loadEarn(t0 + HOUR_MS), t0 + HOUR_MS) === COINS_PER_HOUR,
    'a reload before the first claim keeps the clock',
  );
  delete (globalThis as { localStorage?: unknown }).localStorage;
  check(waitLabel(61 * 60_000) === '1h 01m' && waitLabel(1) === '1m', 'wait labels read well');
}

// Daily missions: progress, claim-once, and the local-day reset.
{
  const day = '2026-11-11';
  check(dayKey(new Date(2026, 0, 5, 23, 59)) === '2026-01-05', 'dayKey is the zero-padded local date');
  let m = freshMissions(day);
  check(
    MISSIONS.every((d) => !canClaim(m, d.id)),
    'nothing is claimable on a fresh day',
  );
  m = recordPark(m, 'a', 2);
  m = recordPark(m, 'a', 3);
  check(progressFor(m, 'park3') === 2 && progressFor(m, 'star3') === 1, 'parks and 3-star wins are counted');
  check(progressFor(m, 'worlds2') === 1, 'repeating one level counts once for different levels');
  check(canClaim(m, 'star3') && !canClaim(m, 'park3'), 'only finished missions can be claimed');
  m = recordPark(m, 'b', 1);
  const c1 = claim(m, 'park3');
  check(c1.reward === MISSIONS[0].reward && !canClaim(c1.missions, 'park3'), 'a claim pays its reward once');
  check(claim(c1.missions, 'park3').reward === 0, 'claiming twice pays nothing');
  check(
    claim(m, 'star3').reward > 0 && claim(freshMissions(day), 'star3').reward === 0,
    'unfinished claims pay nothing',
  );
  check(rollDay(c1.missions, day) === c1.missions, 'same day keeps progress');
  const next = rollDay(c1.missions, '2026-11-12');
  check(
    next.parks === 0 && next.claimed.length === 0 && next.day === '2026-11-12',
    'a new day resets progress and claims',
  );
  check(
    JSON.stringify(parseMissions(JSON.parse(JSON.stringify(c1.missions)), day)) === JSON.stringify(c1.missions),
    'missions round-trip',
  );
  check(parseMissions(c1.missions, '2026-11-12').parks === 0, 'stored missions from another day are dropped');
  const junk = parseMissions({ day, parks: -4, star3: 'x', levels: [1, 'a', 'a'], claimed: ['nope', 'star3'] }, day);
  check(
    junk.parks === 0 && junk.star3 === 0 && junk.levels.length === 1 && junk.claimed.join() === 'star3',
    'junk fields are cleaned',
  );
  check(
    parseMissions(null, day).parks === 0 && parseWallet('x').money === 0 && parseWallet({ money: 250.9 }).money === 250,
    'bad storage parses to defaults',
  );
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
