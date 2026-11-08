import * as THREE from 'three';
import type { QualitySetting } from './settings';

export type Quality = 'low' | 'high';

interface Preset {
  pixelRatio: () => number;
  shadowSize: number;
  shadowRadius: number;
  decorShadows: boolean;
}

// PCFSoftShadowMap was removed from three.js; PCF with a wider radius gives the soft look.
const PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: () => 1, shadowSize: 1024, shadowRadius: 1, decorShadows: false },
  high: { pixelRatio: () => Math.min(devicePixelRatio, 2), shadowSize: 2048, shadowRadius: 2.5, decorShadows: true },
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

function overlay(id: string, title: string, body: string): HTMLElement {
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
  private readonly lostOverlay: HTMLElement;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
    hooks: { onLost: () => void; onRestored: () => void },
  ) {
    this.lostOverlay = overlay(
      'gfx-lost',
      'Graphics reset…',
      'The graphics driver restarted. Hang on, the game will be back in a moment.',
    );
    try {
      if (!webglAvailable()) throw new Error('WebGL unavailable');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
      console.error(err);
      canvas.classList.add('hidden');
      overlay(
        'gfx-fatal',
        "Can't start 3D graphics",
        "Your browser or device can't run 3D graphics (WebGL). Try turning on hardware acceleration in your browser settings, updating your browser, or using a different device.",
      ).classList.remove('hidden');
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
      hooks.onLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // three.js re-inits its GL state and lazily re-uploads geometry,
      // textures (incl. the canvas asphalt) and programs. The shadow map's
      // render target is re-created on the next shadow pass.
      this.lost = false;
      this.lostOverlay.classList.add('hidden');
      hooks.onRestored();
    });
  }

  get ok(): boolean {
    return this.renderer !== null;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  private disposeShadowMap(): void {
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  setQuality(setting: QualitySetting): void {
    this.setting = setting;
    this.slowTime = 0;
    this.apply(setting === 'auto' ? (this.autoDropped ? 'low' : autoQuality()) : setting);
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
    this.applyDecor(this.scene);
  }

  /** Trees etc. (userData.decor) only cast shadows on High. Call after adding a level. */
  applyDecor(root: THREE.Object3D): void {
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
    if (this.setting !== 'auto' || this.quality === 'low' || this.lost) return false;
    if (frameMs > 250) return false; // tab switch / hitch, not sustained load
    this.sampleTime += frameMs / 1000;
    this.sampleFrames++;
    if (this.sampleTime < 0.5) return false;
    const avg = (this.sampleTime * 1000) / this.sampleFrames;
    this.slowTime = avg > SLOW_FRAME_MS ? this.slowTime + this.sampleTime : 0;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    if (this.slowTime < SLOW_WINDOW_S) return false;
    this.autoDropped = true;
    this.apply('low');
    return true;
  }
}
