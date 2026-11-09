import * as THREE from 'three';
import './style.css';
import { reducedMotion } from './a11y';
import { initAdmin, loadControls, mayPersist, saveControls, showSkipButtons, skipTarget, unlockAll } from './admin';
import { Sfx } from './audio';
import { CameraRig } from './camera';
import { Cockpit } from './cockpit';
import { PlayerCar } from './car';
import { loadCarModels } from './carModels';
import { sensorInterval } from './collision';
import { isTouch, nextStarTime, starsForTime } from './rules';
import { PARK_HOLD, STEP, TOUCH_MIN_SPEED } from './config';
import { bestLabel, Hud, starRequirement, type ModalButton } from './hud';
import { Input } from './input';
import { buildLevel, type BuiltLevel } from './level';
import type { LevelDef } from './layout';
import { LEVELS } from './levels';
import { loadingLabel } from './loading';
import { RearMirror } from './mirror';
import { vehicleOf, type VehicleDef } from './vehicles';
import {
  assistMode,
  bodyHidden,
  CAM_LABELS,
  fovBoost,
  hidesCeilings,
  isCamMode,
  nextCamMode,
  reverseHold,
} from './views';
import { ambientLevels } from './lighting';
import { ceilingAbove, floorHud, lightTarget, SUN_OUTDOOR } from './storey';
import { Graphics } from './graphics';
import { evaluateParking } from './parking';
import { bestFor, loadProgress, recordBest, recordWin, resumeIndex, saveProgress } from './progress';
import { canRunGame } from './guards';
import { loadSettings, SettingsPanel, type Settings } from './settings';
import { checkForUpdate, type UpdateKind } from './update';

type State = 'menu' | 'playing' | 'paused' | 'done' | 'blocked';

// --- Renderer & scene -------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const scene = new THREE.Scene();
const sky = new THREE.Color(0xa9cfee);
scene.background = sky;
// Light distance fog: far lots fade into the haze instead of ending at a hard edge.
scene.fog = new THREE.Fog(sky, 45, 150);

const hemi = new THREE.HemisphereLight(0xdbeeff, 0x4a5a3a, 1.1);
scene.add(hemi);
const SKY = sky.clone();
const DAY_SKY = 0xa9cfee;
const DUSK_SKY = 0x7a6a9c;
const DAY_SUN = 0xffeccf;
const DUSK_SUN = 0xff8a4a;
const sun = new THREE.DirectionalLight(DAY_SUN, SUN_OUTDOOR);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// Created before the renderer so the first frame uses the saved quality.
const settings = loadSettings();
const gfx = new Graphics(canvas, scene, sun, {
  onLost: () => pause(),
  onRestored: () => undefined, // three.js re-uploads everything lazily; the game stays paused
});
gfx.setQuality(settings.quality);
gfx.loadEnvironment(`${import.meta.env.BASE_URL}env/sky.hdr`);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
const rig = new CameraRig(camera);
rig.reduced = () => reducedMotion.matches;
rig.mode = settings.camera;

/** Apply the view's field of view (the hood view is wider). */
function syncFov(): void {
  const fov = (innerWidth < innerHeight ? 70 : 55) + fovBoost(rig.mode);
  if (camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  gfx.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = (w < h ? 70 : 55) + fovBoost(rig.mode);
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
  if (key === 'wheel') applyWheelSide(s.wheel);
});
/** Put the steering wheel on the left or right of the touch cockpit (the pedals take the other side). */
function applyWheelSide(side: Settings['wheel']): void {
  document.getElementById('touch')!.classList.toggle('wheel-right', side === 'right');
}
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
/** One interior per vehicle, drawn around its own eye point. */
const cockpits = new Map<string, Cockpit>();
function cockpitFor(v: VehicleDef): Cockpit {
  let c = cockpits.get(v.id);
  if (!c) cockpits.set(v.id, (c = new Cockpit(v)));
  return c;
}
let cockpit = cockpitFor(player.vehicle);
player.model.root.add(cockpit.group);
scene.add(player.model.root);
gfx.applyDecor(player.model.root);
let reversing = false;

const LEVEL_IDS = LEVELS.map((l) => l.id);
// Admin mode (?admin=1): everything unlocked in memory, nothing written to saved progress.
const ADMIN = initAdmin(location.search);
let adminControls = loadControls();
const adminBar = document.getElementById('admin-bar')!;
const adminBadge = document.getElementById('admin-badge')!;
const adminPrev = document.getElementById('admin-prev') as HTMLButtonElement;
const adminNext = document.getElementById('admin-next') as HTMLButtonElement;
if (ADMIN) adminBar.classList.remove('hidden');
/** Show the skip buttons only while a level is open; the badge stays as their toggle. */
function syncAdminBar(): void {
  if (!ADMIN) return;
  const show = showSkipButtons(ADMIN, adminControls, state === 'playing' || state === 'paused');
  adminPrev.classList.toggle('hidden', !show);
  adminNext.classList.toggle('hidden', !show);
  adminPrev.disabled = skipTarget(levelIndex, -1, LEVELS.length) === null;
  adminNext.disabled = skipTarget(levelIndex, 1, LEVELS.length) === null;
  adminBadge.setAttribute('aria-pressed', String(adminControls));
}
adminBadge.addEventListener('click', () => {
  adminControls = !adminControls;
  saveControls(adminControls);
  syncAdminBar();
});
adminPrev.addEventListener('click', () => skipLevel(-1));
adminNext.addEventListener('click', () => skipLevel(1));
const progress = ADMIN ? unlockAll(loadProgress(LEVEL_IDS), LEVEL_IDS) : loadProgress(LEVEL_IDS);
let state: State = 'menu';
let levelIndex = 0;
let level: BuiltLevel | null = null;
let elapsed = 0;
let parkHold = 0;
let sensorTimer = 0;
let sensorCheckTimer = 0;
let sensorBeep = 0;
const SENSOR_CHECK_HZ = 20;
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
  rig.solids = level.solids;
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
  const dusk = level.def.theme === 'dusk';
  SKY.set(dusk ? DUSK_SKY : DAY_SKY);
  sun.color.set(dusk ? DUSK_SUN : DAY_SUN);
  hemi.color.set(dusk ? 0xb8b0e0 : 0xdbeeff);
  // A low sun throws long shadows.
  if (dusk) sun.position.set(-50, 25, -20);
  else sun.position.set(-30, 50, -20);
  sun.target.position.set(0, 0, 0);
}

/** False while Settings or the graphics-reset overlay covers the game. */
function canRun(): boolean {
  return canRunGame(settingsPanel.isOpen, gfx.contextLost);
}

function startLevel(i: number): void {
  if (!canRun()) return;
  sfx.unlock();
  if (!level || levelIndex !== i) loadLevel(i);
  const def = LEVELS[i];
  const vehicle = vehicleOf(def.vehicle);
  const previous = player.model.root;
  if (player.use(vehicle)) {
    previous.remove(cockpit.group);
    scene.remove(previous);
    cockpit = cockpitFor(vehicle);
    player.model.root.add(cockpit.group);
    scene.add(player.model.root);
    gfx.applyDecor(player.model.root);
  }
  rig.vehicle = vehicle;
  mirror.vehicle = vehicle;
  player.physics.reset(def.spawn.x, def.spawn.z, def.spawn.rot, level?.surfaces);
  player.model.root.visible = true;
  elapsed = 0;
  parkHold = 0;
  accumulator = 0;
  input.clear();
  input.setReverse(false);
  reversing = false;
  rig.mode = viewMode();
  rig.setFreeLook(false);
  rig.snap(camTarget());
  syncFov();
  hud.startLevel(i, def);
  state = 'playing';
  syncAdminBar();
  hud.hideUpdateBanner(); // never interrupt a level; it comes back at the next menu
}

function showMenu(): void {
  state = 'menu';
  rig.setFreeLook(false);
  player.model.body.visible = true;
  cockpit.visible = false;
  syncAdminBar();
  if (!level) loadLevel(resumeIndex(progress, LEVEL_IDS));
  player.model.root.visible = false;
  hud.showMenu(LEVELS, progress, (i) => {
    if (state !== 'menu') return;
    sfx.unlock();
    sfx.click();
    startLevel(i);
  });
  applyUpdate();
}

function pause(): void {
  // Also covers 'paused' with no modal (Settings opened from play, then a graphics reset):
  // show the modal so touch players can resume.
  if (state === 'paused' ? hud.modalOpen : state !== 'playing') return;
  state = 'paused';
  syncAdminBar();
  input.clear();
  hud.showModal(
    'Paused',
    `${LEVELS[levelIndex].hint} ${starRequirement(LEVELS[levelIndex])}`,
    null,
    [
      { label: 'Resume', primary: true, onClick: resume },
      { label: 'Restart', onClick: () => startLevel(levelIndex) },
      ...(ADMIN ? [{ label: 'Skip level', onClick: () => skipLevel(1) }] : []),
      { label: 'Menu', onClick: showMenu },
    ],
    !settingsPanel.isOpen, // never pull focus into a modal hidden behind Settings
  );
}

/** Admin only: jump to the next/previous level without awarding stars or times. */
function skipLevel(dir: 1 | -1): void {
  if (!ADMIN || !canRun() || (state !== 'playing' && state !== 'paused')) return;
  const t = skipTarget(levelIndex, dir, LEVELS.length);
  if (t === null) return;
  hud.hideModal();
  startLevel(t);
}

function resume(): void {
  if (state !== 'paused' || !canRun()) return;
  hud.hideModal();
  input.clear(); // drop keys pressed/held while the modal was open
  rig.setFreeLook(false);
  state = 'playing';
  syncAdminBar();
}

function finish(win: boolean, reason: string): void {
  state = 'done';
  syncAdminBar();
  input.clear();
  hud.setPark(null, '');
  const def = LEVELS[levelIndex];
  if (win) {
    sfx.win();
    const stars = starsForTime(elapsed, def.stars);
    recordWin(progress, LEVEL_IDS, levelIndex, stars);
    const hadBest = bestFor(progress, LEVEL_IDS[levelIndex]) > 0;
    const newBest = recordBest(progress, LEVEL_IDS[levelIndex], elapsed);
    if (mayPersist(ADMIN)) saveProgress(progress);
    const isLastLevel = levelIndex === LEVELS.length - 1;
    const buttons: ModalButton[] = [
      ...(isLastLevel ? [] : [{ label: 'Next level', primary: true, onClick: () => startLevel(levelIndex + 1) }]),
      { label: 'Retry', onClick: () => startLevel(levelIndex) },
      { label: 'Menu', primary: isLastLevel, onClick: showMenu },
    ];
    const next = nextStarTime(stars, def.stars);
    const tip = next === null ? '' : ` · ${stars + 1}★ needs ${next}s or less`;
    hud.showModal(
      isLastLevel ? 'All levels cleared!' : 'Parked!',
      `${elapsed.toFixed(1)}s${newBest ? (hadBest ? ' · New best!' : '') : ` · Best ${bestLabel(bestFor(progress, LEVEL_IDS[levelIndex]))}`}${tip}`,
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
  applyUpdate();
}

// --- Updates ------------------------------------------------------------------
// Only shown from the menu or after a level ends, never mid-level.
let pendingUpdate: UpdateKind = 'none';
let updateDismissed = false;
let lastUpdateCheck = 0;
const reloadPage = (): void => location.reload();

function applyUpdate(): void {
  if (pendingUpdate === 'none' || state === 'playing' || state === 'paused' || state === 'blocked') return;
  if (pendingUpdate === 'required') {
    state = 'blocked';
    input.clear();
    hud.hideUpdateBanner();
    hud.showModal('Please update to keep playing', 'A new version of Park It 3D is required.', null, [
      { label: 'Update', primary: true, onClick: reloadPage },
    ]);
  } else if (!updateDismissed) {
    hud.showUpdateBanner(reloadPage, () => (updateDismissed = true));
  }
}

async function runUpdateCheck(): Promise<void> {
  const now = Date.now();
  if (now - lastUpdateCheck < 30_000) return; // launch and resume can fire back to back
  lastUpdateCheck = now;
  const kind = await checkForUpdate(
    { version: __APP_SEMVER__, build: __APP_BUILD__ },
    new URL('version.json', document.baseURI).href,
  );
  // A newer answer replaces an older one, but a required update is never downgraded.
  if (kind !== 'none' && pendingUpdate !== 'required') pendingUpdate = kind;
  applyUpdate();
}
document.addEventListener('visibilitychange', () => !document.hidden && void runUpdateCheck());

// --- Keyboard actions ---------------------------------------------------------
input.driving = () => state === 'playing';
input.actionsEnabled = () => !settingsPanel.isOpen;
input.navRoot = () =>
  settingsPanel.isOpen
    ? document.getElementById('settings')
    : hud.modalOpen
      ? document.getElementById('modal')
      : state === 'menu'
        ? document.getElementById('menu')
        : null;
input.on('KeyR', () => (state === 'playing' || state === 'paused' || state === 'done') && startLevel(levelIndex));
// Routes through settings so the panel shows it and it is saved (the frame loop applies the view).
function toggleCamera(): string {
  const next = nextCamMode(settings.camera);
  settingsPanel.set('camera', next);
  return CAM_LABELS[next];
}
input.on('KeyC', () => {
  if (state !== 'playing') return;
  hud.showHint(toggleCamera(), 1.2);
});
input.on('BracketRight', () => skipLevel(1));
input.on('BracketLeft', () => skipLevel(-1));
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
  if (!canRun()) return;
  if (state === 'menu') startLevel(resumeIndex(progress, LEVEL_IDS));
  else if (hud.modalOpen) hud.clickPrimary();
});

// HUD buttons blur after a click so a later Enter/Space can't re-trigger them.
document.getElementById('btn-pause')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  pause();
});
function openSettings(opener: HTMLElement | null = null): void {
  sfx.click();
  const wasPlaying = state === 'playing';
  if (wasPlaying) {
    state = 'paused';
    input.clear();
  }
  settingsPanel.open(() => {
    if (wasPlaying && state === 'paused' && !hud.modalOpen && !gfx.contextLost) state = 'playing';
  }, opener);
}
// Keyboard activation (detail 0) gets focus back on close; mouse clicks keep the blur above.
document.getElementById('btn-settings')!.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLElement;
  btn.blur();
  openSettings(e.detail === 0 ? btn : null);
});
document.getElementById('btn-settings-menu')!.addEventListener('click', (e) => {
  openSettings(e.detail === 0 ? (e.currentTarget as HTMLElement) : null);
});
document.getElementById('btn-cam')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (state === 'playing') hud.showHint(toggleCamera(), 1.2);
});
input.bindTouch(document.getElementById('touch')!);
applyWheelSide(settings.wheel);
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
// Backgrounded (home, app switch, call, screen lock): pause, silence audio and stop the loop.
// On return the Pause screen is showing and the car doesn't move until the player taps Resume.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    sfx.suspend();
  } else {
    sfx.resume();
    startLoop();
  }
});
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
  if (elapsed >= def.time) return finish(false, 'Out of time. Try a shorter line to the bay.');

  car.step(dt, input.controls, level.surfaces);
  const nearby = car.reachable(level.surfaces, level.obstacles);

  // Collisions: any real touch fails the level (resting contact at zero speed is ignored).
  if (isTouch(car.resolveCollisions(nearby), TOUCH_MIN_SPEED)) {
    sfx.crash();
    hud.flashHit();
    return finish(false, 'You hit something.');
  }

  // Parking check.
  const park = evaluateParking(car.obb, car.v, def.target, def.bothWays, car.layer);
  if (park.ok) parkHold += dt;
  else parkHold = Math.max(0, parkHold - dt * 3);
  const over = park.inside && park.onFloor; // in the bay's footprint on the right floor
  const color = park.ok ? 0x2ee66b : over ? 0xffe14d : 0xffa31a;
  level.bayFill.color.setHex(color);
  level.bayEdge.color.setHex(color);
  if (over) {
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

  // Parking sensor beeps when slow and close to something. The proximity test
  // only runs at SENSOR_CHECK_HZ; the beep timer still ticks every step.
  sensorTimer -= dt;
  if (Math.abs(car.v) > 0.05 && Math.abs(car.v) < 4) {
    sensorCheckTimer -= dt;
    if (sensorCheckTimer <= 0) {
      sensorCheckTimer = 1 / SENSOR_CHECK_HZ;
      sensorBeep = sensorInterval(car.obb, nearby);
    }
    if (sensorBeep && sensorTimer <= 0) {
      sfx.beep();
      sensorTimer = sensorBeep;
    }
  } else {
    sensorCheckTimer = 0;
    sensorBeep = 0;
  }
}

// --- Lighting -----------------------------------------------------------------
// Outdoors: sun and sky. Under a deck the sun is off and the light is flat and
// warmer (the strips under each slab are baked emissive, so no shadow maps or
// point lights); underground it is darker still. Eased so crossing a ramp mouth isn't a pop.
let lightMix: { sun: number; hemi: number; sky: number } = { sun: SUN_OUTDOOR, hemi: 1.1, sky: 1 };
function updateLighting(dt: number, def: LevelDef | null): void {
  const car = player.physics;
  const target =
    def?.floors !== undefined
      ? lightTarget(ceilingAbove(def, car.x, car.z, car.y) !== null, car.y < -1, def.theme === 'dusk')
      : lightTarget(false, false, def?.theme === 'dusk');
  const k = 1 - Math.exp(-dt * 5);
  lightMix = {
    sun: lightMix.sun + (target.sun - lightMix.sun) * k,
    hemi: lightMix.hemi + (target.hemi - lightMix.hemi) * k,
    sky: lightMix.sky + (target.sky - lightMix.sky) * k,
  };
  sun.intensity = lightMix.sun;
  const ambient = ambientLevels(lightMix, gfx.envActive);
  hemi.intensity = ambient.hemi;
  scene.environmentIntensity = ambient.env;
  sky.copy(SKY).multiplyScalar(lightMix.sky);
  (scene.fog as THREE.Fog).color.copy(sky);
}

/** The view in use: the chosen one, or the corner (rear) view while reversing with assist on. */
function viewMode(): ReturnType<typeof assistMode> {
  return assistMode(settings.camera, settings.autoRear, reversing);
}
function camTarget(): Parameters<typeof rig.snap>[0] {
  const p = player.physics;
  return { x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: p.pitch, steer: p.steer, v: p.v };
}

// Free look: drag on the backdrop while paused or after a level to orbit the car (mouse wheel zooms).
let dragFrom: { id: number; x: number; y: number } | null = null;
function canOrbit(): boolean {
  return (state === 'paused' || state === 'done') && !settingsPanel.isOpen && !gfx.contextLost;
}
addEventListener('pointerdown', (e) => {
  if (!canOrbit() || (e.target as Element | null)?.closest('.panel, button, a')) return;
  dragFrom = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', (e) => {
  if (!dragFrom || e.pointerId !== dragFrom.id) return;
  if (!canOrbit()) return void (dragFrom = null);
  rig.setFreeLook(true);
  rig.dragFree(-(e.clientX - dragFrom.x) * 0.008, (e.clientY - dragFrom.y) * 0.008);
  dragFrom.x = e.clientX;
  dragFrom.y = e.clientY;
});
const endDrag = (e: PointerEvent): void => {
  if (dragFrom && e.pointerId === dragFrom.id) dragFrom = null;
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener(
  'wheel',
  (e) => {
    if (canOrbit() && rig.freeLook) rig.dragFree(0, 0, e.deltaY * 0.01);
  },
  { passive: true },
);

// --- Main loop ---------------------------------------------------------------
let last = performance.now();
let rafId = 0;
function startLoop(): void {
  if (rafId || !gfx.ok || document.hidden) return;
  last = performance.now(); // no time jump after a long stay in the background
  rafId = requestAnimationFrame(frame);
}
let frameFailed = false;
/** Log once and show the error banner; the loop keeps running so the page never freezes silently. */
function reportFrameError(err: unknown): void {
  if (frameFailed) return;
  frameFailed = true;
  console.error('Frame loop error', err);
  const banner = document.getElementById('error-banner')!;
  banner.classList.remove('hidden');
  document.getElementById('error-reload')!.addEventListener('click', () => location.reload());
}
function frame(now: number): void {
  rafId = 0;
  // Re-arm first so an exception below can't stop the loop.
  if (!document.hidden) rafId = requestAnimationFrame(frame); // stops while hidden: no battery drain
  try {
    frameBody(now);
  } catch (err) {
    reportFrameError(err);
  }
}
function frameBody(now: number): void {
  const frameStart = last;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (state === 'playing') {
    accumulator += dt;
    while (accumulator >= STEP && state === 'playing') {
      step(STEP);
      accumulator -= STEP;
    }
    hud.update(LEVELS[levelIndex].time - elapsed, player.physics.v);
    if (gfx.monitor(now - frameStart)) hud.showHint('Graphics set to Low for smoother play (change in ⚙ Settings)', 4);
    hud.tick(dt);
    syncAdminBar();
  }

  player.sync(state === 'playing' ? dt : 0);
  if (level && !reducedMotion.matches) {
    level.marker.rotation.y += dt * 1.5;
    level.marker.position.y = level.markerY + Math.sin(now / 400) * 0.25;
  }
  if (level) {
    const playing = state === 'playing';
    const orbiting = rig.freeLook && (state === 'paused' || state === 'done');
    level.setView(
      playing || orbiting ? player.physics.y : 0,
      (playing || orbiting) && hidesCeilings(rig.mode, orbiting),
    );
    if (playing) hud.setFloor(floorHud(level.def, player.physics.layer, player.physics.y));
    updateLighting(dt, playing ? level.def : null);
  }

  if (state === 'menu' && level) {
    const t = level.def.target;
    rig.orbit(reducedMotion.matches ? 0 : dt, t.x * 0.5, t.z * 0.5, Math.max(level.def.lot.w, level.def.lot.l) * 0.75);
  } else if (state !== 'menu') {
    // Also while paused or done, so a view change or free look is visible behind the panel.
    reversing = reverseHold(reversing, player.physics.v);
    rig.mode = viewMode();
    syncFov();
    rig.update(dt, camTarget());
    const inside = bodyHidden(rig.mode, rig.progress);
    player.model.body.visible = !inside;
    cockpit.visible = inside;
    cockpit.setSteer(player.physics.steer);
  }

  gfx.render(camera);
  mirror.visible =
    settings.mirror &&
    state !== 'menu' &&
    !rig.freeLook &&
    (rig.mode === 'chase' || rig.mode === 'cockpit' || rig.mode === 'hood');
  if (gfx.renderer && !gfx.contextLost) mirror.render(gfx.renderer, scene, player.physics);
}

// ?level=N jumps straight into a level, ?cam=top starts top-down (handy for testing).
const params = new URLSearchParams(location.search);
const camParam = params.get('cam');
if (isCamMode(camParam)) settings.camera = camParam; // this visit only: not saved
const qs = params.get('level');
const byId = qs ? LEVEL_IDS.indexOf(qs) : -1;
const direct = byId >= 0 ? byId : qs ? Number(qs) - 1 : -1;
if (direct >= 0 && direct < LEVELS.length) startLevel(direct);
else showMenu();
startLoop();
void runUpdateCheck();
