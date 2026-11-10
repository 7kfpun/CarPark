import * as THREE from 'three';
import { setMaterialDetail } from './materials';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  HITCH_MS,
  loadDetected,
  MIN_PROBE_FRAMES,
  PROBE_S,
  PROBE_WARMUP_S,
  probeQuality,
  saveDetected,
} from './qualityProbe';
import { LOST_STALL_MS } from './recovery';
import type { QualitySetting } from './settings';

export type Quality = 'low' | 'high';

interface Preset {
  pixelRatio: () => number;
  shadowSize: number;
  shadowRadius: number;
  decorShadows: boolean;
  /** HDR environment map for ambient light and reflections; Low keeps the cheap hemisphere light. */
  envMap: boolean;
}

// PCFSoftShadowMap was removed from three.js; PCF with a wider radius gives the soft look.
const PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: () => 1, shadowSize: 1024, shadowRadius: 1, decorShadows: false, envMap: false },
  high: {
    pixelRatio: () => Math.min(devicePixelRatio, 2),
    shadowSize: 2048,
    shadowRadius: 3.5,
    decorShadows: true,
    envMap: true,
  },
};

const SLOW_FRAME_MS = 25;
const SLOW_WINDOW_S = 4;

/** Low on touch-first / low-memory / few-core devices, else High. */
export function autoQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const lowMem = (nav.deviceMemory ?? 8) <= 4;
  const fewCores = (nav.hardwareConcurrency || 8) <= 4;
  return coarse || lowMem || fewCores ? 'low' : 'high';
}

function overlay(id: string, title: string, body: string, onReload?: () => void): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'gfx-overlay hidden';
    el.setAttribute('role', 'alert');
    const panel = document.createElement('div');
    panel.className = 'panel small';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    panel.append(h, p);
    if (onReload) {
      const b = document.createElement('button');
      b.id = `${id}-reload`;
      b.className = 'primary hidden';
      b.textContent = 'Reload';
      b.addEventListener('click', onReload);
      panel.appendChild(b);
    }
    el.appendChild(panel);
    document.body.appendChild(el);
  }
  return el;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/**
 * Owns the WebGLRenderer: creation with a friendly fallback, context loss and
 * restore, quality presets and the slow-frame auto downgrade.
 * `renderer` is null when WebGL is unavailable; every method is then a no-op.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer | null = null;
  quality: Quality = 'high';
  private setting: QualitySetting = 'auto';
  private lost = false;
  private slowTime = 0;
  private sampleTime = 0;
  private sampleFrames = 0;
  private autoDropped = false;
  /** Elapsed seconds of the first-run probe, or -1 when it is not running. */
  private probeT = -1;
  private probeFrames = 0;
  private probeSum = 0;
  private envSource: THREE.DataTexture | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private readonly lostOverlay: HTMLElement;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
    hooks: { onLost: () => void; onRestored: () => void; onReload: () => void },
  ) {
    this.lostOverlay = overlay(
      'gfx-lost',
      'Graphics reset…',
      'The graphics driver restarted. Hang on, the game will be back in a moment.',
      hooks.onReload,
    );
    try {
      if (!webglAvailable()) throw new Error('WebGL unavailable');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
      console.error(err);
      canvas.classList.add('hidden');
      const fatal = overlay(
        'gfx-fatal',
        "Can't start 3D graphics",
        "Your browser or device can't run 3D graphics (WebGL). Try turning on hardware acceleration in your browser settings, updating your browser, or using a different device.",
        hooks.onReload,
      );
      fatal.classList.remove('hidden');
      const fb = fatal.querySelector('button');
      fb?.classList.remove('hidden');
      fb?.focus();
      return;
    }
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.lostOverlay.classList.remove('hidden');
      // If the browser never restores the context, Reload is the way out.
      clearTimeout(this.lostTimer);
      this.lostTimer = setTimeout(() => this.offerReload(), LOST_STALL_MS);
      hooks.onLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // three.js re-inits its GL state and lazily re-uploads geometry,
      // textures (incl. the canvas asphalt) and programs. The shadow map's
      // render target is re-created on the next shadow pass.
      clearTimeout(this.lostTimer);
      this.lost = false;
      this.lostOverlay.classList.add('hidden');
      this.lostOverlay.querySelector('button')?.classList.add('hidden');
      try {
        this.buildEnvironment(); // the prefiltered map's render target does not survive a context loss
        hooks.onRestored();
      } catch (err) {
        // A half-restored context must not leave a dead canvas with no way out.
        console.error('Graphics restore failed', err);
        this.lost = true;
        this.lostOverlay.classList.remove('hidden');
        this.offerReload();
      }
    });
  }

  private lostTimer: ReturnType<typeof setTimeout> | undefined;

  private offerReload(): void {
    const b = this.lostOverlay.querySelector('button');
    b?.classList.remove('hidden');
    b?.focus();
  }

  get ok(): boolean {
    return this.renderer !== null;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  /** True while the HDR environment is lighting the scene (High, once loaded). */
  get envActive(): boolean {
    return this.scene.environment !== null;
  }

  /** Loads the equirect HDR sky; until it arrives (or if it fails) the hemisphere light does the work. */
  loadEnvironment(url: string): void {
    if (!this.renderer) return;
    new HDRLoader().load(
      url,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.envSource = tex;
        this.buildEnvironment();
      },
      undefined,
      (err) => console.warn('Environment map failed to load', err),
    );
  }

  private buildEnvironment(): void {
    const r = this.renderer;
    if (!r || !this.envSource) return;
    this.envTarget?.dispose();
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTarget = pmrem.fromEquirectangular(this.envSource);
    pmrem.dispose();
    this.applyEnvironment();
  }

  private applyEnvironment(): void {
    this.scene.environment = PRESETS[this.quality].envMap && this.envTarget ? this.envTarget.texture : null;
  }

  private disposeShadowMap(): void {
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  setQuality(setting: QualitySetting): void {
    this.setting = setting;
    this.slowTime = 0;
    this.probeT = -1; // a manual choice ends any probe; going back to Auto lets the next level start re-probe
    this.apply(setting === 'auto' ? (this.autoDropped ? 'low' : (loadDetected() ?? autoQuality())) : setting);
  }

  /** Call when a level starts: on Auto with no remembered result, times the next second of frames to pick High or Low. */
  startProbe(): void {
    if (this.setting !== 'auto' || this.autoDropped || loadDetected() || !this.renderer) return;
    this.probeT = 0;
    this.probeFrames = 0;
    this.probeSum = 0;
  }

  private apply(q: Quality): void {
    this.quality = q;
    const p = PRESETS[q];
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(p.pixelRatio());
      const size = r.getSize(new THREE.Vector2());
      r.setSize(size.x, size.y, false);
    }
    const shadow = this.sun.shadow;
    shadow.radius = p.shadowRadius;
    if (shadow.mapSize.x !== p.shadowSize) {
      shadow.mapSize.set(p.shadowSize, p.shadowSize);
      this.disposeShadowMap();
    }
    this.applyEnvironment();
    this.applyDecor(this.scene);
  }

  /** Trees etc. (userData.decor) only cast shadows on High, and ground/car materials drop their extra maps on Low. Call after adding a level. */
  applyDecor(root: THREE.Object3D): void {
    setMaterialDetail(root, this.quality === 'high');
    const cast = PRESETS[this.quality].decorShadows;
    root.traverse((o) => {
      if (!o.userData.decor) return;
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) c.castShadow = cast;
      });
    });
  }

  setSize(w: number, h: number): void {
    this.renderer?.setSize(w, h, false);
  }

  render(camera: THREE.Camera): void {
    if (this.renderer && !this.lost) this.renderer.render(this.scene, camera);
  }

  /**
   * Feed real frame times while playing. On Auto, if frames average over
   * 25 ms for a few seconds, drop to Low. Returns true once when that happens.
   */
  monitor(frameMs: number): boolean {
    if (this.setting !== 'auto' || this.lost) return false;
    if (frameMs > HITCH_MS) return false; // tab switch / hitch, not sustained load
    if (this.probeT >= 0) return this.probe(frameMs);
    if (this.quality === 'low') return false;
    this.sampleTime += frameMs / 1000;
    this.sampleFrames++;
    if (this.sampleTime < 0.5) return false;
    const avg = (this.sampleTime * 1000) / this.sampleFrames;
    this.slowTime = avg > SLOW_FRAME_MS ? this.slowTime + this.sampleTime : 0;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    if (this.slowTime < SLOW_WINDOW_S) return false;
    this.autoDropped = true;
    saveDetected('low');
    this.apply('low');
    return true;
  }

  /** One probe frame. Returns true when the probe moved Auto down to Low. */
  private probe(frameMs: number): boolean {
    this.probeT += frameMs / 1000;
    if (this.probeT < PROBE_WARMUP_S) return false;
    this.probeFrames++;
    this.probeSum += frameMs;
    if (this.probeT < PROBE_WARMUP_S + PROBE_S) return false;
    this.probeT = -1;
    const q = probeQuality(this.probeSum / this.probeFrames, this.probeFrames, this.quality);
    if (this.probeFrames >= MIN_PROBE_FRAMES) saveDetected(q);
    if (q === this.quality) return false;
    this.apply(q);
    return q === 'low';
  }
}
