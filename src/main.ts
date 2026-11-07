import * as THREE from 'three';
import './style.css';
import { Sfx } from './audio';
import { CameraRig } from './camera';
import { PlayerCar } from './car';
import { expand, sat } from './collision';
import { HIT_COOLDOWN, HIT_MIN_SPEED, MAX_HITS, PARK_HOLD, STEP } from './config';
import { Hud, type ModalButton } from './hud';
import { Input } from './input';
import { buildLevel, type BuiltLevel } from './level';
import { LEVELS } from './levels';
import { evaluateParking } from './parking';
import { loadProgress, saveProgress } from './progress';

type State = 'menu' | 'playing' | 'paused' | 'done';

// --- Renderer & scene -------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const sky = new THREE.Color(0xa9cfee);
scene.background = sky;
scene.fog = new THREE.Fog(sky, 60, 160);

scene.add(new THREE.HemisphereLight(0xdbeeff, 0x4a5a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
const rig = new CameraRig(camera);

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Game objects -----------------------------------------------------------
const hud = new Hud();
const input = new Input();
const sfx = new Sfx();
const player = new PlayerCar();
scene.add(player.model.root);

const progress = loadProgress(LEVELS.length);
let state: State = 'menu';
let levelIndex = 0;
let level: BuiltLevel | null = null;
let elapsed = 0;
let hits = 0;
let hitCooldown = 0;
let parkHold = 0;
let sensorTimer = 0;
let accumulator = 0;

function loadLevel(i: number): void {
  if (level) {
    scene.remove(level.group);
    level.dispose();
  }
  levelIndex = i;
  level = buildLevel(LEVELS[i], i);
  scene.add(level.group);
  // Fit the shadow camera to the lot.
  const { w, l } = level.def.lot;
  const r = Math.max(w, l) / 2 + 8;
  const sc = sun.shadow.camera;
  sc.left = -r;
  sc.right = r;
  sc.top = r;
  sc.bottom = -r;
  sc.near = 1;
  sc.far = 200;
  sc.updateProjectionMatrix();
  sun.position.set(-30, 50, -20);
  sun.target.position.set(0, 0, 0);
}

function startLevel(i: number): void {
  sfx.unlock();
  if (!level || levelIndex !== i) loadLevel(i);
  const def = LEVELS[i];
  player.physics.reset(def.spawn.x, def.spawn.z, def.spawn.rot);
  player.model.root.visible = true;
  elapsed = 0;
  hits = 0;
  hitCooldown = 0;
  parkHold = 0;
  accumulator = 0;
  input.clear();
  rig.snap(player.physics);
  hud.startLevel(i, def);
  state = 'playing';
}

function showMenu(): void {
  state = 'menu';
  if (!level) loadLevel(Math.min(progress.unlocked - 1, LEVELS.length - 1));
  player.model.root.visible = false;
  hud.showMenu(LEVELS, progress, (i) => {
    sfx.unlock();
    sfx.click();
    startLevel(i);
  });
}

function pause(): void {
  if (state !== 'playing') return;
  state = 'paused';
  input.clear();
  hud.showModal('Paused', LEVELS[levelIndex].hint, null, [
    { label: 'Resume', primary: true, onClick: resume },
    { label: 'Restart', onClick: () => startLevel(levelIndex) },
    { label: 'Menu', onClick: showMenu },
  ]);
}

function resume(): void {
  if (state !== 'paused') return;
  hud.hideModal();
  state = 'playing';
}

function finish(win: boolean, reason: string): void {
  state = 'done';
  input.clear();
  hud.setPark(null, '');
  const def = LEVELS[levelIndex];
  if (win) {
    sfx.win();
    const stars = hits === 0 && elapsed <= def.par ? 3 : hits <= 1 ? 2 : 1;
    progress.stars[levelIndex] = Math.max(progress.stars[levelIndex], stars);
    progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, levelIndex + 2));
    saveProgress(progress);
    const last = levelIndex === LEVELS.length - 1;
    const buttons: ModalButton[] = [
      ...(last ? [] : [{ label: 'Next level', primary: true, onClick: () => startLevel(levelIndex + 1) }]),
      { label: 'Retry', onClick: () => startLevel(levelIndex) },
      { label: 'Menu', primary: last, onClick: showMenu },
    ];
    const tip = stars < 3 ? `  (3★: no bumps and under ${def.par}s)` : '';
    hud.showModal(
      last ? 'All levels cleared!' : 'Parked!',
      `${elapsed.toFixed(1)}s · ${hits} bump${hits === 1 ? '' : 's'}${tip}`,
      stars,
      buttons,
    );
  } else {
    sfx.fail();
    hud.showModal('Level failed', reason, null, [
      { label: 'Try again', primary: true, onClick: () => startLevel(levelIndex) },
      { label: 'Menu', onClick: showMenu },
    ]);
  }
}

// --- Keyboard actions ---------------------------------------------------------
input.on('KeyR', () => (state === 'playing' || state === 'paused' || state === 'done') && startLevel(levelIndex));
input.on('KeyC', () => {
  if (state !== 'playing') return;
  hud.showHint(rig.toggle() === 'top' ? 'Top-down camera' : 'Chase camera', 1.2);
});
input.on('KeyM', () => {
  sfx.muted = !sfx.muted;
  if (state === 'playing') hud.showHint(sfx.muted ? 'Sound off' : 'Sound on', 1.2);
});
input.on('Escape', () => (state === 'playing' ? pause() : state === 'paused' ? resume() : undefined));
input.on('KeyP', () => (state === 'playing' ? pause() : state === 'paused' ? resume() : undefined));
input.on('Enter', () => {
  if (state === 'menu') startLevel(progress.unlocked - 1);
});

document.getElementById('btn-pause')!.addEventListener('click', pause);
document.getElementById('btn-cam')!.addEventListener('click', () => {
  if (state === 'playing') hud.showHint(rig.toggle() === 'top' ? 'Top-down camera' : 'Chase camera', 1.2);
});
for (const key of ['up', 'down', 'left', 'right', 'brake'] as const) {
  input.bindTouch(document.getElementById(`t-${key}`)!, key);
}
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('visibilitychange', () => document.hidden && pause());

// --- Simulation -------------------------------------------------------------
function step(dt: number): void {
  if (!level) return;
  const def = level.def;
  const car = player.physics;
  elapsed += dt;
  hitCooldown = Math.max(0, hitCooldown - dt);
  if (elapsed >= def.time) return finish(false, 'Out of time. Try a shorter line to the bay.');

  car.step(dt, input.controls);

  // Collisions: gentle touches are free, real bumps cost a heart.
  const impact = car.resolveCollisions(level.obstacles);
  if (impact > HIT_MIN_SPEED && hitCooldown === 0) {
    hits++;
    hitCooldown = HIT_COOLDOWN;
    sfx.crash();
    hud.flashHit();
    if (hits >= MAX_HITS) return finish(false, `${MAX_HITS} bumps. Easy does it!`);
  }

  // Parking check.
  const park = evaluateParking(car.obb, car.v, def.target, def.bothWays);
  if (park.ok) parkHold += dt;
  else parkHold = Math.max(0, parkHold - dt * 3);
  const color = park.ok ? 0x2ee66b : park.inside ? 0xffe14d : 0xffa31a;
  level.bayFill.color.setHex(color);
  level.bayEdge.color.setHex(color);
  if (park.inside) {
    const label = !park.aligned
      ? def.bothWays ? 'Straighten up' : 'Wrong way round'
      : !park.stopped ? 'Stop the car' : 'Hold still…';
    hud.setPark(parkHold / PARK_HOLD, label);
  } else hud.setPark(null, '');
  if (parkHold >= PARK_HOLD) return finish(true, '');

  // Parking sensor beeps when slow and close to something.
  sensorTimer -= dt;
  if (Math.abs(car.v) > 0.05 && Math.abs(car.v) < 4) {
    const box = car.obb;
    let interval = 0;
    for (const [margin, iv] of [[0.25, 0.09], [0.6, 0.22], [1.1, 0.45]] as const) {
      const e = expand(box, margin);
      if (level.obstacles.some((o) => sat(e, o))) {
        interval = iv;
        break;
      }
    }
    if (interval && sensorTimer <= 0) {
      sfx.beep();
      sensorTimer = interval;
    }
  }
}

// --- Main loop ---------------------------------------------------------------
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (state === 'playing') {
    accumulator += dt;
    while (accumulator >= STEP && state === 'playing') {
      step(STEP);
      accumulator -= STEP;
    }
    hud.update(LEVELS[levelIndex].time - elapsed, hits, MAX_HITS, player.physics.v);
    hud.tick(dt);
  }

  player.sync(state === 'playing' ? dt : 0);
  if (level) {
    level.marker.rotation.y += dt * 1.5;
    level.marker.position.y = 3.2 + Math.sin(now / 400) * 0.25;
  }

  if (state === 'menu' && level) {
    const t = level.def.target;
    rig.orbit(dt, t.x * 0.5, t.z * 0.5, Math.max(level.def.lot.w, level.def.lot.l) * 0.75);
  } else if (state === 'playing') {
    rig.update(dt, player.physics);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ?level=N jumps straight into a level, ?cam=top starts top-down (handy for testing).
const params = new URLSearchParams(location.search);
if (params.get('cam') === 'top') rig.toggle();
const qs = params.get('level');
const direct = qs ? Number(qs) - 1 : -1;
if (direct >= 0 && direct < LEVELS.length) startLevel(direct);
else showMenu();
requestAnimationFrame(frame);
