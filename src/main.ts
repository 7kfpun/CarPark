import * as THREE from 'three';
import { FIRST_RUN_TIP, FIRST_RUN_TIP_SECONDS, markTipSeen, shouldShowTip } from './onboarding';
import './style.css';
import { reducedMotion } from './a11y';
import { initAdmin, loadControls, mayPersist, saveControls, showSkipButtons, skipTarget, unlockAll } from './admin';
import { Sfx, VOLUME_STEPS } from './audio';
import { CameraRig } from './camera';
import { Cockpit } from './cockpit';
import { createVehicleModel, PlayerCar } from './car';
import { ALL_MODELS, FIRST_MODELS, LATER_MODELS, keepLoadingCarModels, loadCarModels, skyUrl } from './carModels';
import { sensorInterval, sensorReading, type SensorReading } from './collision';
import { isTouch, nextStarTime, starsForTime } from './rules';
import { holdComplete, PARK_HOLD, STEP, TOUCH_MIN_SPEED } from './config';
import { bestLabel, Hud, starRequirement, type ModalButton } from './hud';
import { Input } from './input';
import { buildLevel, type BuiltLevel } from './level';
import type { LevelDef } from './layout';
import { LEVELS } from './levels';
import { loadingLabel } from './loading';
import { mirrorAllowed, RearMirror } from './mirror';
import { vehicleOf, type VehicleDef } from './vehicles';
import { buyCar, driveVehicleId, loadGarage, repairCar, repairCostFor, saveGarage, selectCar, SHOP } from './garage';
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
import { inControlZone, isDoubleTap, pinchFactor, wheelFactor } from './orbit';
import { ambientLevels } from './lighting';
import { ceilingAbove, floorHud, lightTarget, SUN_OUTDOOR } from './storey';
import { Graphics } from './graphics';
import { evaluateParking, parkChecklist } from './parking';
import { applyDamage, crashDamage, hpFor, loadHealth, saveHealth } from './health';
import { loadEarn, msToNext, pendingCoins, saveEarn, waitLabel, claim as claimEarn } from './earn';
import { claim, dayKey, loadMissions, loadWallet, recordPark, rollDay, saveMissions, saveWallet } from './missions';
import type { Missions } from './missions';
import { renderMissions } from './missionsView';
import { bestFor, loadProgress, recordBest, recordWin, saveProgress } from './progress';
import { levelPlayable, resumeLevel, WORLDS, worldComplete } from './worlds';
import { canRunGame } from './guards';
import { loadSettings, SettingsPanel, TEXT_SCALE, type Settings } from './settings';
import {
  beatsGhost,
  decodeFrames,
  duration,
  encodeFrames,
  loadGhosts,
  nextGhost,
  poseAt,
  Recorder,
  REPLAY_HZ,
  saveGhosts,
  type Pose,
} from './replay';
import { activateUpdate, initPwa } from './pwa';
import { recoverNow } from './recovery';
import { fetchUpdate, mergeUpdate, shouldPrompt, type UpdateKind } from './update';

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
  onLost: () => holdForContextLoss(),
  onRestored: () => pause(), // three.js re-uploads everything lazily; show the pause dialog now that the overlay is gone
  onReload: recoverNow,
});
gfx.setQuality(settings.quality);
gfx.loadEnvironment(skyUrl());

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
function applySound(s: Settings): void {
  sfx.muted = !s.sound;
  sfx.musicOn = s.music;
  sfx.sfxVolume = VOLUME_STEPS[s.sfxVol];
  sfx.musicVolume = VOLUME_STEPS[s.musicVol];
  sfx.applyVolumes();
}
applySound(settings);
const settingsPanel = new SettingsPanel(settings, (s, key) => {
  if (key === 'sound' || key === 'music' || key === 'sfxVol' || key === 'musicVol') applySound(s);
  if (key === 'quality') gfx.setQuality(s.quality);
  if (key === 'wheel') applyWheelSide(s.wheel);
  if (key === 'textSize') applyTextSize(s.textSize);
});
/** Put the steering wheel on the left or right of the touch cockpit (the pedals take the other side). */
function applyTextSize(size: Settings['textSize']): void {
  document.documentElement.style.setProperty('--ui-scale', String(TEXT_SCALE[size]));
  document.documentElement.dataset.textSize = size;
}

function applyWheelSide(side: Settings['wheel']): void {
  document.getElementById('touch')!.classList.toggle('wheel-right', side === 'right');
}
const loadingEl = document.getElementById('loading')!;
const loadingText = document.getElementById('loading-text')!;
const loadingFill = document.getElementById('loading-fill')!;
try {
  // Falls back to box cars if a model can't load.
  await loadCarModels(FIRST_MODELS, (loaded, total) => {
    loadingText.textContent = loadingLabel(loaded, total);
    loadingFill.style.width = `${total > 0 ? Math.round((loaded / total) * 100) : 0}%`;
  });
} finally {
  // A ?level= jump keeps the overlay up until the level has started (removed at the bottom).
  if (!new URLSearchParams(location.search).has('level')) loadingEl.remove();
}
/** The other models load while the menu is up; a level only starts once they are in. */
let modelsDone = false;
// One attempt here keeps Play near the single-timeout ceiling; the background rounds retry the rest.
const laterModels = loadCarModels(LATER_MODELS, undefined, undefined, undefined, 1).then(() => {
  modelsDone = true;
  // The menu's backdrop lot was built with box cars: rebuild it with the real models.
  onModelsLoaded();
  // Every model still missing (the first one too) keeps retrying in the background.
  void keepLoadingCarModels(ALL_MODELS, onModelsLoaded);
});
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
const garage = loadGarage();
/** The vehicle for a level: its own if it sets one, otherwise the player's selected car. */
const vehicleFor = (def: LevelDef): VehicleDef => vehicleOf(driveVehicleId(def.vehicle, garage));
let garageOpen = false;
const health = loadHealth();
const progress = ADMIN ? unlockAll(loadProgress(LEVEL_IDS), LEVEL_IDS) : loadProgress(LEVEL_IDS);
let state: State = 'menu';
let levelIndex = 0;
let level: BuiltLevel | null = null;
let elapsed = 0;
let parkHold = 0;
let sensorTimer = 0;
let sensorCheckTimer = 0;
let sensorBeep: number | null = null;
let sensorEnd: 1 | -1 = 1;
let sensorShown: SensorReading = { front: 0, rear: 0 };
const SENSOR_CHECK_HZ = 20;
let accumulator = 0;

// --- Replay and ghost ---------------------------------------------------------
const GHOST_EVERY = Math.round(1 / STEP / REPLAY_HZ);
const ghosts = loadGhosts(LEVEL_IDS);
let recorder = new Recorder(GHOST_EVERY);
let lastRun: Pose[] = [];
let ghostFrames: Pose[] | null = null;
let replay: { frames: Pose[]; t: number; show: () => void } | null = null;
const ghostMats = new Map<string, THREE.MeshBasicMaterial>();
const ghostModels = new Map<string, ReturnType<typeof createVehicleModel>>();
/** A translucent copy of the vehicle that replays the best run. */
function ghostFor(v: VehicleDef): ReturnType<typeof createVehicleModel> {
  let g = ghostModels.get(v.id);
  if (!g) {
    g = createVehicleModel(v);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.35, depthWrite: false });
    ghostMats.set(v.id, mat);
    g.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = mat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    g.root.visible = false;
    scene.add(g.root);
    ghostModels.set(v.id, g);
  }
  return g;
}
let ghostCar: ReturnType<typeof createVehicleModel> | null = null;
function hideGhost(): void {
  for (const g of ghostModels.values()) g.root.visible = false;
}
/** Place the ghost at time `t`; it waits at the bay after its run ends, then fades out of the scene. */
function updateGhost(t: number): void {
  if (!ghostCar || !ghostFrames) return;
  const end = duration(ghostFrames);
  const pose = poseAt(ghostFrames, t);
  ghostCar.root.visible = !!pose && t < end + 1.5;
  if (!pose) return;
  ghostCar.root.position.set(pose.x, pose.y, pose.z);
  ghostCar.root.rotation.order = 'YXZ';
  ghostCar.root.rotation.y = pose.heading;
  ghostCar.root.rotation.x = -pose.pitch;
}
function stopReplay(): void {
  if (!replay) return;
  const { show } = replay;
  replay = null;
  hud.showHint('', 0);
  show();
}
function startReplay(show: () => void): void {
  if (!lastRun.length || state !== 'done') return;
  hud.hideModal();
  rig.setFreeLook(false);
  replay = { frames: lastRun, t: 0, show };
  hud.showHint('Replay: press any key or tap to stop', 600);
}
addEventListener(
  'keydown',
  (e) => {
    if (replay && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      stopReplay();
    }
  },
  true,
);
addEventListener('pointerdown', () => stopReplay(), true);

/** The lot on screen was built before some model arrived; rebuilt at the next safe moment. */
let levelStale = false;

/** A model arrived late: swap the box cars for it everywhere it is cached or built in. */
function onModelsLoaded(): void {
  levelStale = true;
  // Ghost copies are cached per vehicle like the player's; drop them so they rebuild with the template.
  for (const g of ghostModels.values()) scene.remove(g.root);
  ghostModels.clear();
  for (const m of ghostMats.values()) m.dispose();
  ghostMats.clear();
  const wasGhost = ghostCar !== null;
  ghostCar = null;
  const previous = player.model.root;
  if (player.refreshModels()) {
    player.model.root.visible = previous.visible;
    swapPlayerModel(previous);
  }
  // The menu shows no ghost (the next startLevel makes one); otherwise put it where the run is.
  if (wasGhost && ghostFrames && state !== 'menu') {
    ghostCar = ghostFor(vehicleFor(LEVELS[levelIndex]));
    updateGhost(elapsed);
  }
  // Never rebuild the lot under a run: it comes up at the next menu or level start.
  if (state === 'menu' && level) loadLevel(levelIndex);
}

function swapPlayerModel(previous: THREE.Object3D): void {
  previous.remove(cockpit.group);
  scene.remove(previous);
  cockpit = cockpitFor(player.vehicle);
  player.model.root.add(cockpit.group);
  scene.add(player.model.root);
  gfx.applyDecor(player.model.root);
}

function loadLevel(i: number): void {
  levelStale = false;
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

function startLevel(i: number): boolean {
  if (!canRun() || garageOpen) return false;
  sfx.unlock();
  sfx.startMusic();
  if (!level || levelIndex !== i || levelStale) loadLevel(i);
  const def = LEVELS[i];
  const vehicle = vehicleFor(def);
  const previous = player.model.root;
  if (player.use(vehicle)) swapPlayerModel(previous);
  replay = null;
  hideGhost();
  const stored = ghosts[LEVEL_IDS[i]];
  ghostFrames = stored ? decodeFrames(stored.data) : null;
  ghostCar = ghostFrames ? ghostFor(vehicle) : null;
  recorder = new Recorder(GHOST_EVERY);
  updateGhost(0);
  rig.vehicle = vehicle;
  mirror.vehicle = vehicle;
  player.physics.reset(def.spawn.x, def.spawn.z, def.spawn.rot, level?.surfaces);
  recorder.step(player.physics); // t = 0 is the spawn pose
  player.model.root.visible = true;
  elapsed = 0;
  parkHold = 0;
  sensorTimer = 0;
  resetSensors();
  accumulator = 0;
  input.clear();
  input.setReverse(false);
  reversing = false;
  rig.mode = viewMode();
  rig.setFreeLook(false);
  rig.snap(camTarget());
  syncFov();
  hud.startLevel(i, { ...def, vehicle: vehicle.id });
  if (levelIndex === 0 && shouldShowTip()) {
    hud.showHint(FIRST_RUN_TIP, FIRST_RUN_TIP_SECONDS);
    markTipSeen();
  }
  gfx.startProbe();
  state = 'playing';
  syncAdminBar();
  hud.hideUpdateBanner(); // never interrupt a level; it comes back at the next menu
  return true;
}

let missions: Missions = loadMissions();
let wallet = loadWallet();

function showMissions(): void {
  missions = rollDay(missions, dayKey(new Date()));
  renderMissions(document.getElementById('missions')!, missions, wallet.money, (id) => {
    const r = claim(missions, id);
    if (!r.reward) return;
    missions = r.missions;
    wallet = { ...wallet, money: wallet.money + r.reward };
    if (mayPersist(ADMIN)) {
      saveMissions(missions);
      saveWallet(wallet);
    }
    sfx.click();
    showMissions();
  });
}

// --- Hourly earn: coins over time, claimed from the menu into the wallet ---------------
const earn = loadEarn();
if (mayPersist(ADMIN)) saveEarn(earn); // a fresh clock must survive a reload before the first claim
const earnNote = document.getElementById('earn-note')!;
const earnClaim = document.getElementById('earn-claim') as HTMLButtonElement;
function renderEarn(): void {
  const now = Date.now();
  const ready = pendingCoins(earn, now);
  earnClaim.disabled = ready === 0;
  earnClaim.textContent = ready ? `Claim ${ready} coins` : 'Hourly coins';
  earnNote.textContent = ready ? '' : `Next coins in ${waitLabel(msToNext(earn, now))}`;
}
earnClaim.onclick = () => {
  const got = claimEarn(earn, Date.now());
  if (!got) return;
  wallet = { ...wallet, money: wallet.money + got };
  if (mayPersist(ADMIN)) {
    // Coins first, and the clock only once they are stored: a failed wallet write must not eat the payout.
    if (saveWallet(wallet)) saveEarn(earn);
  }
  sfx.click();
  showMissions();
  renderEarn();
};
setInterval(() => state === 'menu' && renderEarn(), 30_000);

function showMenu(): void {
  state = 'menu';
  replay = null;
  hideGhost();
  rig.setFreeLook(false);
  player.model.body.visible = true;
  cockpit.visible = false;
  syncAdminBar();
  if (!level) loadLevel(resumeLevel(progress, LEVELS, ADMIN));
  else if (levelStale) loadLevel(levelIndex); // a model arrived during play
  player.model.root.visible = false;
  hud.showMenu(LEVELS, progress, ADMIN, (i) => {
    if (state !== 'menu') return;
    sfx.unlock();
    sfx.click();
    if (modelsDone) startLevel(i);
    else void laterModels.then(() => state === 'menu' && startLevel(i));
  });
  showMissions();
  renderEarn();
  applyUpdate();
}

/** Context lost: halt the run without opening the pause dialog under the graphics overlay (it is shown on restore). */
function holdForContextLoss(): void {
  if (state !== 'playing') return;
  state = 'paused';
  sfx.stopEngine();
  syncAdminBar();
  input.clear();
}

function pause(): void {
  // Also covers 'paused' with no modal (Settings opened from play, then a graphics reset):
  // show the modal so touch players can resume.
  if (state === 'paused' ? hud.modalOpen : state !== 'playing') return;
  state = 'paused';
  sfx.stopEngine();
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

function resume(): boolean {
  if (state !== 'paused' || !canRun()) return false;
  hud.hideModal();
  input.clear(); // drop keys pressed/held while the modal was open
  rig.setFreeLook(false);
  state = 'playing';
  syncAdminBar();
  return true;
}

function finish(win: boolean, reason: string): void {
  state = 'done';
  syncAdminBar();
  input.clear();
  hud.setPark(null, '');
  resetSensors();
  const def = LEVELS[levelIndex];
  lastRun = recorder.frames;
  const replayButton: ModalButton[] = lastRun.length > 1 ? [{ label: 'Replay', onClick: () => startReplay(show) }] : [];
  let show: () => void = () => undefined;
  if (win) {
    const stars = starsForTime(elapsed, def.stars);
    sfx.win(stars);
    recordWin(progress, LEVEL_IDS, levelIndex, stars);
    const hadBest = bestFor(progress, LEVEL_IDS[levelIndex]) > 0;
    const newBest = recordBest(progress, LEVEL_IDS[levelIndex], elapsed);
    const id = LEVEL_IDS[levelIndex];
    const data = encodeFrames(lastRun);
    if (beatsGhost(ghosts[id], elapsed)) {
      const next = nextGhost(ghosts[id], elapsed, data);
      if (next) ghosts[id] = next;
      else delete ghosts[id];
      if (mayPersist(ADMIN)) saveGhosts(ghosts);
    }
    if (mayPersist(ADMIN)) saveProgress(progress);
    if (mayPersist(ADMIN)) {
      missions = recordPark(rollDay(missions, dayKey(new Date())), id, stars);
      saveMissions(missions);
    }
    const isLastLevel = levelIndex === LEVELS.length - 1;
    const nextLevel = LEVELS[levelIndex + 1];
    // The next level may sit in a world that is still locked (a world opens when the one before is finished).
    const hasNext = !!nextLevel && levelPlayable(progress, LEVELS, nextLevel, ADMIN);
    const worldDone = worldComplete(progress, LEVELS, def.location) && nextLevel?.location !== def.location;
    const buttons: ModalButton[] = [
      ...(hasNext ? [{ label: 'Next level', primary: true, onClick: () => startLevel(levelIndex + 1) }] : []),
      ...replayButton,
      { label: 'Retry', onClick: () => startLevel(levelIndex) },
      { label: 'Menu', primary: !hasNext, onClick: showMenu },
    ];
    const next = nextStarTime(stars, def.stars);
    const tip = next === null ? '' : ` · ${stars + 1}★ needs ${next}s or less`;
    show = () =>
      hud.showModal(
        isLastLevel ? 'All levels cleared!' : worldDone ? `${WORLDS[def.location].name} cleared!` : 'Parked!',
        `${elapsed.toFixed(1)}s${newBest ? (hadBest ? ' · New best!' : '') : ` · Best ${bestLabel(bestFor(progress, LEVEL_IDS[levelIndex]))}`}${tip}`,
        stars,
        buttons,
      );
  } else {
    sfx.fail();
    show = () =>
      hud.showModal('Level failed', reason, null, [
        { label: 'Try again', primary: true, onClick: () => startLevel(levelIndex) },
        ...replayButton,
        { label: 'Menu', onClick: showMenu },
      ]);
  }
  show();
  applyUpdate();
}

// --- Updates ------------------------------------------------------------------
// Only shown from the menu or after a level ends, never mid-level.
let pendingUpdate: UpdateKind = 'none';
let pendingBuild: string | null = null;
let dismissedBuild: string | null = null;
let lastUpdateCheck = 0;
let swUpdateReady = false;
// With a waiting service worker, activating it reloads the page onto the new build; otherwise recover (cache-busted reload).
const reloadPage = (): void => {
  if (!activateUpdate()) recoverNow();
};

function applyUpdate(): void {
  if (pendingUpdate === 'none' || state === 'playing' || state === 'paused' || state === 'blocked') return;
  if (pendingUpdate === 'required') {
    state = 'blocked';
    input.clear();
    hud.hideUpdateBanner();
    hud.showModal('Please update to keep playing', 'A new version of Park It 3D is required.', null, [
      { label: 'Update', primary: true, onClick: reloadPage },
    ]);
  } else if (pendingUpdate === 'optional' && shouldPrompt(dismissedBuild, pendingBuild)) {
    hud.showUpdateBanner(reloadPage, () => (dismissedBuild = pendingBuild));
  } else {
    hud.hideUpdateBanner();
  }
}

async function runUpdateCheck(): Promise<void> {
  const now = Date.now();
  if (now - lastUpdateCheck < 30_000) return; // launch and resume can fire back to back
  lastUpdateCheck = now;
  const res = await fetchUpdate(
    { version: __APP_SEMVER__, build: __APP_BUILD__ },
    new URL('version.json', document.baseURI).href,
  );
  // A newer answer replaces an older one (even 'none'), but a required update is never downgraded.
  pendingUpdate = mergeUpdate(pendingUpdate, res.kind === 'none' && swUpdateReady ? 'optional' : res.kind);
  pendingBuild = res.build ?? (swUpdateReady ? 'sw' : null);
  applyUpdate();
}
document.addEventListener('visibilitychange', () => !document.hidden && void runUpdateCheck());

// --- PWA: offline shell, update banner, install button ---------------------------
const installBtn = document.getElementById('btn-install')!;
initPwa({
  onUpdateReady() {
    swUpdateReady = true;
    pendingUpdate = mergeUpdate(pendingUpdate, 'optional');
    pendingBuild ??= 'sw';
    applyUpdate();
  },
  onInstallable(install) {
    installBtn.classList.remove('hidden');
    installBtn.onclick = () => void install().then(() => installBtn.classList.add('hidden'));
  },
  onInstalled: () => installBtn.classList.add('hidden'),
});

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
  else if (state === 'menu' && garageOpen) closeGarage();
});
input.on('KeyP', () => (state === 'playing' ? pause() : state === 'paused' ? resume() : undefined));
// Only reached when no button is focused (a focused button gets its native activation).
input.on('Enter', () => {
  if (!canRun()) return;
  if (state === 'menu' && modelsDone) startLevel(resumeLevel(progress, LEVELS, ADMIN));
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
    sfx.stopEngine();
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
function openGarage(note = ''): void {
  garageOpen = true;
  const persist = mayPersist(ADMIN);
  const buttons = SHOP.map((c) => {
    const name = vehicleOf(c.id).name;
    const owned = garage.owned.includes(c.id);
    const hp = hpFor(health, c.id);
    const hpTag = owned ? ` · ${hp} HP${hp === 0 ? ' wrecked' : ''}` : '';
    const label =
      garage.selected === c.id
        ? `✓ ${name} (driving${hpTag})`
        : owned
          ? `Drive ${name}${hpTag}`
          : `Buy ${name}: ${c.price} coins`;
    return {
      label,
      primary: false,
      onClick: () => {
        if (owned) selectCar(garage, c.id);
        else {
          const purse = { money: wallet.money };
          if (buyCar(garage, purse, c.id, health) !== 'bought') {
            openGarage('Not enough coins for that car.');
            return;
          }
          wallet = { ...wallet, money: purse.money };
          if (persist) {
            // Garage and health first, the wallet last: a failed write must not keep the charge and drop the car.
            saveGarage(garage);
            saveHealth(health);
            saveWallet(wallet);
          }
          sfx.click();
          showMissions();
          openGarage();
          return;
        }
        if (persist) saveGarage(garage);
        sfx.click();
        openGarage();
      },
    };
  });
  const cost = repairCostFor(health, garage.selected);
  if (cost > 0) {
    buttons.push({
      label: `Repair ${vehicleOf(garage.selected).name}: ${cost} coins`,
      primary: false,
      onClick: () => {
        const purse = { money: wallet.money };
        if (repairCar(health, purse, garage.selected) !== 'repaired') {
          openGarage('Not enough coins to repair. Buy or drive another car instead.');
          return;
        }
        wallet = { ...wallet, money: purse.money };
        if (persist) {
          saveHealth(health);
          saveWallet(wallet);
        }
        sfx.click();
        showMissions();
        openGarage();
      },
    });
  }
  buttons.push({
    label: 'Done',
    primary: true,
    onClick: closeGarage,
  });
  hud.showModal(
    'Garage',
    `${note ? `${note} ` : ''}You have ${wallet.money} coins. Levels with their own vehicle keep it; the rest use your car.`,
    null,
    buttons,
  );
}
function closeGarage(): void {
  garageOpen = false;
  hud.hideModal();
}
document.getElementById('btn-garage')!.addEventListener('click', () => openGarage());
document.getElementById('btn-cam')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (state === 'playing') hud.showHint(toggleCamera(), 1.2);
});
input.bindTouch(document.getElementById('touch')!);
applyWheelSide(settings.wheel);
applyTextSize(settings.textSize);
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
  if (settings.timeLimit && elapsed >= def.time) return finish(false, 'Out of time. Try a shorter line to the bay.');

  car.step(dt, input.controlsFor(car.v), level.surfaces);
  sfx.setEngine(car.v, player.vehicle.maxFwd);
  const nearby = car.reachable(level.surfaces, level.obstacles);

  // Collisions: any real touch fails the level (resting contact at zero speed is ignored).
  const impact = car.resolveCollisions(nearby, level.surfaces);
  if (isTouch(impact, TOUCH_MIN_SPEED)) {
    sfx.crash();
    hud.flashHit();
    const damage = crashDamage(impact);
    const left = applyDamage(health, vehicleFor(def).id, damage);
    if (mayPersist(ADMIN)) saveHealth(health);
    return finish(false, `You hit something: -${damage} HP, ${left} left. Ease off near cars, walls and cones.`);
  }
  // Record the resolved pose, so frames never show the car inside an obstacle.
  recorder.step(car);

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
    hud.setPark(parkHold / PARK_HOLD, label, parkChecklist(park, def.bothWays));
  } else hud.setPark(null, '', '');
  if (holdComplete(parkHold)) return finish(true, '');

  // Parking sensors, active when slow. The proximity test only runs at
  // SENSOR_CHECK_HZ; the beep timer still ticks every step. The HUD bars show
  // both ends whenever slow (also when stopped); the beep needs the car to move.
  sensorTimer -= dt;
  if (Math.abs(car.v) < 4) {
    sensorCheckTimer -= dt;
    if (sensorCheckTimer <= 0) {
      sensorCheckTimer = 1 / SENSOR_CHECK_HZ;
      const r = sensorReading(car.obb, nearby);
      sensorEnd = r.front >= r.rear ? 1 : -1;
      sensorBeep = sensorInterval(Math.max(r.front, r.rear));
      if (r.front !== sensorShown.front || r.rear !== sensorShown.rear) {
        sensorShown = r;
        hud.setSensors(r.front, r.rear);
      }
    }
    if (Math.abs(car.v) > 0.05 && sensorBeep !== null && sensorTimer <= 0) {
      sfx.sensor(sensorEnd, sensorBeep === 0);
      sensorTimer = sensorBeep || 0.1;
    }
  } else resetSensors();
}

function resetSensors(): void {
  sensorCheckTimer = 0;
  sensorBeep = null;
  if (sensorShown.front || sensorShown.rear) {
    sensorShown = { front: 0, rear: 0 };
    hud.setSensors(0, 0);
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

// CARP-134: the wheel, gear lever and pedals (plus a guard margin) never start a camera move, even when a
// finger lands just outside them. Hidden controls (keys / pad input) have no rects and guard nothing.
function onControls(e: { clientX: number; clientY: number }): boolean {
  const touch = document.getElementById('touch');
  if (!touch || touch.classList.contains('hidden') || getComputedStyle(touch).display === 'none') return false;
  const rects = [...touch.querySelectorAll<HTMLElement>('.touch-group')].map((g) => g.getBoundingClientRect());
  return inControlZone(e.clientX, e.clientY, rects);
}

// Free look: drag on the backdrop while paused or after a level to orbit the car (mouse wheel zooms).
let dragFrom: { id: number; x: number; y: number } | null = null;
function canOrbit(): boolean {
  return (state === 'paused' || state === 'done') && !settingsPanel.isOpen && !gfx.contextLost;
}
addEventListener('pointerdown', (e) => {
  if (!canOrbit() || (e.target as Element | null)?.closest('.panel, button, a')) return;
  if (onControls(e)) return;
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
    if (canOrbit() && rig.freeLook && !onControls(e)) rig.dragFree(0, 0, e.deltaY * 0.01);
  },
  { passive: true },
);

// Drive-time orbit (FOX-241): drag the empty game area to look around the car, pinch or scroll to
// zoom, double-tap or V / the Reset view button to come back. Touches that start on the wheel,
// pedals, gear lever or HUD buttons are never tracked, so they keep steering and driving.
const ORBIT_IGNORE = '#touch, #hud button, #admin-bar, #mirror, .panel, button, a, input, select';
const orbitPtrs = new Map<number, { x: number; y: number }>();
let lastTap: { t: number; x: number; y: number } | null = null;
let tapStart: { id: number; t: number; x: number; y: number; moved: boolean } | null = null;
function canDriveOrbit(): boolean {
  return state === 'playing' && !settingsPanel.isOpen && !gfx.contextLost;
}
function resetView(): void {
  rig.resetView();
}
addEventListener('pointerdown', (e) => {
  if (!canDriveOrbit() || (e.target as Element | null)?.closest(ORBIT_IGNORE)) return;
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  if (onControls(e)) return;
  orbitPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tapStart =
    orbitPtrs.size === 1 ? { id: e.pointerId, t: e.timeStamp, x: e.clientX, y: e.clientY, moved: false } : null;
});
addEventListener('pointermove', (e) => {
  const prev = orbitPtrs.get(e.pointerId);
  if (!prev) return;
  if (!canDriveOrbit()) return void orbitPtrs.clear();
  if (tapStart && tapStart.id === e.pointerId && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 10) {
    tapStart.moved = true;
  }
  if (orbitPtrs.size === 1) {
    rig.orbitBy(-(e.clientX - prev.x) * 0.008, (e.clientY - prev.y) * 0.008);
  } else if (orbitPtrs.size === 2) {
    const other = [...orbitPtrs.entries()].find(([id]) => id !== e.pointerId)![1];
    const before = Math.hypot(prev.x - other.x, prev.y - other.y);
    const now = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    rig.orbitBy(0, 0, pinchFactor(before, now));
  }
  prev.x = e.clientX;
  prev.y = e.clientY;
});
// A cancelled touch (finger off the edge, system gesture) just stops tracking: the view stays where it is.
const endOrbit = (e: PointerEvent): void => {
  if (!orbitPtrs.delete(e.pointerId)) return;
  if (e.type === 'pointerup' && tapStart && tapStart.id === e.pointerId && !tapStart.moved) {
    if (lastTap && isDoubleTap(e.timeStamp - lastTap.t, Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y))) {
      resetView();
      lastTap = null;
    } else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  }
  tapStart = null;
};
addEventListener('pointerup', endOrbit);
addEventListener('pointercancel', endOrbit);
addEventListener(
  'wheel',
  (e) => {
    if (canDriveOrbit() && !(e.target as Element | null)?.closest(ORBIT_IGNORE) && !onControls(e))
      rig.orbitBy(0, 0, wheelFactor(e.deltaY));
  },
  { passive: true },
);
addEventListener('contextmenu', (e) => {
  if (state === 'playing' && (e.target as Element | null)?.id === 'game') e.preventDefault();
});
input.on('KeyV', () => {
  if (state === 'playing') resetView();
});
const resetBtn = document.getElementById('btn-reset-view')!;
resetBtn.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (state === 'playing') resetView();
});

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
  document.getElementById('error-reload')!.addEventListener('click', recoverNow);
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
    updateGhost(elapsed);
    hud.update(settings.timeLimit ? LEVELS[levelIndex].time - elapsed : elapsed, player.physics.v, !settings.timeLimit);
    if (gfx.monitor(now - frameStart)) hud.showHint('Graphics set to Low for smoother play (change in ⚙ Settings)', 4);
    syncAdminBar();
  }
  hud.tick(dt);

  if (replay) {
    // Drive the car along the recording; the speed (for wheel spin and the camera) comes from the pose change.
    const p = player.physics;
    const before = { x: p.x, z: p.z };
    replay.t += dt;
    const pose = poseAt(replay.frames, replay.t);
    if (pose) {
      p.x = pose.x;
      p.y = pose.y;
      p.z = pose.z;
      p.heading = pose.heading;
      p.pitch = pose.pitch;
      const fwd = (p.x - before.x) * Math.sin(p.heading) + (p.z - before.z) * Math.cos(p.heading);
      p.v = dt > 0 ? fwd / dt : 0;
    }
    if (replay.t >= duration(replay.frames) + 1) stopReplay();
  }
  player.sync(state === 'playing' || replay ? dt : 0);
  if (level && !reducedMotion.matches) {
    level.marker.rotation.y += dt * 1.5;
    level.marker.position.y = level.markerY + Math.sin(now / 400) * 0.25;
  }
  if (level) {
    const playing = state === 'playing';
    const orbiting = rig.freeLook && (state === 'paused' || state === 'done');
    level.setView(
      playing || orbiting ? player.physics.y : 0,
      (playing || orbiting) && hidesCeilings(rig.mode, orbiting || rig.orbited),
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
    resetBtn.classList.toggle('off-centre', rig.orbited);
    const inside = bodyHidden(rig.mode, rig.progress);
    player.model.body.visible = !inside;
    cockpit.visible = inside;
    cockpit.setSteer(player.physics.steer);
  }

  gfx.render(camera);
  mirror.visible =
    settings.mirror &&
    mirrorAllowed(gfx.quality) &&
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
if (direct >= 0 && direct < LEVELS.length) {
  await laterModels; // a test jump starts at once, so wait for the parked-car models
  startLevel(direct);
} else showMenu();
loadingEl.remove();
startLoop();
void runUpdateCheck();
