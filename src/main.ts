import * as THREE from 'three';
import './style.css';
import { reducedMotion } from './a11y';
import { Sfx } from './audio';
import { CameraRig } from './camera';
import { PlayerCar } from './car';
import { loadCarModels } from './carModels';
import { expand, sat } from './collision';
import { HIT_COOLDOWN, HIT_MIN_SPEED, MAX_HITS, PARK_HOLD, STEP } from './config';
import { Hud, type ModalButton } from './hud';
import { Input } from './input';
import { buildLevel, type BuiltLevel } from './level';
import { LEVELS } from './levels';
import { loadingLabel } from './loading';
import { RearMirror } from './mirror';
import { Graphics } from './graphics';
import { evaluateParking } from './parking';
import { loadProgress, saveProgress } from './progress';
import { loadSettings, SettingsPanel } from './settings';

type State = 'menu' | 'playing' | 'paused' | 'done';

// --- Renderer & scene -------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
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

// Created before the renderer so the first frame uses the saved quality.
const settings = loadSettings();
const gfx = new Graphics(canvas, scene, sun, {
  onLost: () => pause(),
  onRestored: () => undefined, // three.js re-uploads everything lazily; the game stays paused
});
gfx.setQuality(settings.quality);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
const rig = new CameraRig(camera);
rig.mode = settings.camera;

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  gfx.setSize(w, h);
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
sfx.muted = !settings.sound;
const settingsPanel = new SettingsPanel(settings, (s, key) => {
  if (key === 'sound') sfx.muted = !s.sound;
  if (key === 'quality') gfx.setQuality(s.quality);
  if (key === 'camera') rig.mode = s.camera;
});
const loadingEl = document.getElementById('loading')!;
const loadingText = document.getElementById('loading-text')!;
const loadingFill = document.getElementById('loading-fill')!;
try {
  // Falls back to box cars if a model can't load.
  await loadCarModels(undefined, (loaded, total) => {
    loadingText.textContent = loadingLabel(loaded, total);
    loadingFill.style.width = `${total > 0 ? Math.round((loaded / total) * 100) : 0}%`;
  });
} finally {
  loadingEl.remove();
}
const player = new PlayerCar();
const mirror = new RearMirror();
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
  gfx.applyDecor(level.group);
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
    if (state !== 'menu') return;
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
  input.clear(); // drop keys pressed/held while the modal was open
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
input.driving = () => state === 'playing';
input.actionsEnabled = () => !settingsPanel.isOpen;
input.on('KeyR', () => (state === 'playing' || state === 'paused' || state === 'done') && startLevel(levelIndex));
// Routes through settings so the panel shows it and it is saved (onChange sets rig.mode).
function toggleCamera(): string {
  settingsPanel.set('camera', rig.mode === 'chase' ? 'top' : 'chase');
  return rig.mode === 'top' ? 'Top-down camera' : 'Chase camera';
}
input.on('KeyC', () => {
  if (state !== 'playing') return;
  hud.showHint(toggleCamera(), 1.2);
});
input.on('KeyM', () => {
  settingsPanel.set('sound', sfx.muted); // flips the setting; onChange updates sfx.muted
  if (state === 'playing') hud.showHint(sfx.muted ? 'Sound off' : 'Sound on', 1.2);
});
input.on('Escape', () => {
  if (state === 'playing') pause();
  else if (state === 'paused') resume();
  else if (state === 'done') showMenu();
});
input.on('KeyP', () => (state === 'playing' ? pause() : state === 'paused' ? resume() : undefined));
// Only reached when no button is focused (a focused button gets its native activation).
input.on('Enter', () => {
  if (state === 'menu') startLevel(progress.unlocked - 1);
  else if (hud.modalOpen) hud.clickPrimary();
});

// HUD buttons blur after a click so a later Enter/Space can't re-trigger them.
document.getElementById('btn-pause')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  pause();
});
function openSettings(): void {
  sfx.click();
  const wasPlaying = state === 'playing';
  if (wasPlaying) {
    state = 'paused';
    input.clear();
  }
  settingsPanel.open(() => {
    if (wasPlaying && state === 'paused' && !hud.modalOpen && !gfx.contextLost) state = 'playing';
  });
}
document.getElementById('btn-settings')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  openSettings();
});
document.getElementById('btn-settings-menu')!.addEventListener('click', openSettings);
document.getElementById('btn-cam')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (state === 'playing') hud.showHint(toggleCamera(), 1.2);
});
input.bindTouch(document.getElementById('touch')!);
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('visibilitychange', () => document.hidden && pause());
// Pause when the window loses focus (alt-tab), unless focus comes straight back.
let blurTimer = 0;
addEventListener('blur', () => {
  clearTimeout(blurTimer);
  blurTimer = window.setTimeout(() => !document.hasFocus() && pause(), 200);
});
addEventListener('focus', () => clearTimeout(blurTimer));

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
      ? def.bothWays
        ? 'Straighten up'
        : 'Wrong way round'
      : !park.stopped
        ? 'Stop the car'
        : 'Hold still…';
    hud.setPark(parkHold / PARK_HOLD, label);
  } else hud.setPark(null, '');
  if (parkHold >= PARK_HOLD) return finish(true, '');

  // Parking sensor beeps when slow and close to something.
  sensorTimer -= dt;
  if (Math.abs(car.v) > 0.05 && Math.abs(car.v) < 4) {
    const box = car.obb;
    let interval = 0;
    for (const [margin, iv] of [
      [0.25, 0.09],
      [0.6, 0.22],
      [1.1, 0.45],
    ] as const) {
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
  const frameStart = last;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (state === 'playing') {
    accumulator += dt;
    while (accumulator >= STEP && state === 'playing') {
      step(STEP);
      accumulator -= STEP;
    }
    hud.update(LEVELS[levelIndex].time - elapsed, hits, MAX_HITS, player.physics.v);
    if (gfx.monitor(now - frameStart)) hud.showHint('Graphics set to Low for smoother play (change in ⚙ Settings)', 4);
    hud.tick(dt);
  }

  player.sync(state === 'playing' ? dt : 0);
  if (level && !reducedMotion.matches) {
    level.marker.rotation.y += dt * 1.5;
    level.marker.position.y = 3.2 + Math.sin(now / 400) * 0.25;
  }

  if (state === 'menu' && level) {
    const t = level.def.target;
    rig.orbit(reducedMotion.matches ? 0 : dt, t.x * 0.5, t.z * 0.5, Math.max(level.def.lot.w, level.def.lot.l) * 0.75);
  } else if (state === 'playing') {
    rig.update(dt, player.physics);
  }

  gfx.render(camera);
  mirror.visible = settings.mirror && state !== 'menu' && rig.mode === 'chase';
  if (gfx.renderer && !gfx.contextLost) mirror.render(gfx.renderer, scene, player.physics);
  requestAnimationFrame(frame);
}

// ?level=N jumps straight into a level, ?cam=top starts top-down (handy for testing).
const params = new URLSearchParams(location.search);
if (params.get('cam') === 'top') rig.mode = 'top';
const qs = params.get('level');
const direct = qs ? Number(qs) - 1 : -1;
if (direct >= 0 && direct < LEVELS.length) startLevel(direct);
else showMenu();
if (gfx.ok) requestAnimationFrame(frame);
