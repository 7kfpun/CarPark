/**
 * The Garage browser: step through every car, see it in 3D (drag to turn it) with its state, and buy,
 * drive or repair it. One WebGL renderer lives only while the Garage is open. The rules stay in src/garage.ts.
 */
import * as THREE from 'three';
import { CAR_SHARED, createVehicleModel } from './car';
import { nextFocusIndex } from './focus';
import { carCard, startIndex, stepCar } from './garageCards';
import type { Garage, ShopCar } from './garage';
import type { Health } from './health';
import { vehicleOf } from './vehicles';

export interface GarageViewDeps {
  shop: readonly ShopCar[];
  garage: Garage;
  health: Health;
  money: () => number;
  /** Each action returns an error note to show, or '' when it worked. */
  buy: (id: string) => string;
  select: (id: string) => string;
  repair: (id: string) => string;
  close: () => void;
  reducedMotion: () => boolean;
  pixelRatio?: number;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class GarageView {
  private index = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: THREE.Object3D | null = null;
  private yaw = -0.6;
  private raf = 0;
  private last = 0;
  private dragX: number | null = null;
  private pointer = -1;
  private resizer: ResizeObserver | null = null;
  private opener: HTMLElement | null = null;
  private note = '';
  private ac: AbortController | null = null;
  /** A fresh canvas per opening: a context handed back with forceContextLoss cannot be reused. */
  private canvas = document.createElement('canvas');
  private readonly root = $('garage');

  constructor(private d: GarageViewDeps) {}

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.stopRenderer(); // a second open must not leak the first renderer or its frame loop
    if (!this.isOpen) this.opener = document.activeElement as HTMLElement | null;
    this.index = startIndex(this.d.shop, this.d.garage);
    this.note = '';
    this.root.classList.remove('hidden');
    this.makeCanvas();
    this.bind();
    this.startRenderer();
    this.refresh();
    // The action button is disabled on the driven car, so focus a control that is always enabled.
    $('garage-done').focus();
  }

  /** Re-draw the car being shown, e.g. when its model finishes loading. */
  reload(): void {
    if (this.isOpen) this.showModel(this.cur());
  }

  /** Hide the Garage and free the renderer and its WebGL context. */
  close(): void {
    this.root.classList.add('hidden');
    this.ac?.abort();
    this.ac = null;
    this.stopRenderer();
    this.opener?.focus?.();
    this.opener = null;
  }

  private makeCanvas(): void {
    const old = document.getElementById('garage-canvas');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'garage-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '3D preview of the car. Drag to turn it.');
    if (old) old.replaceWith(this.canvas);
    else $('garage').querySelector('.garage-stage')!.prepend(this.canvas);
  }

  private bind(): void {
    this.ac?.abort();
    const ac = (this.ac = new AbortController());
    const on = (el: HTMLElement | Window | Document, ev: string, fn: (e: never) => void) =>
      el.addEventListener(ev, fn as EventListener, { signal: ac.signal });
    on($('garage-prev'), 'click', () => this.step(-1));
    on($('garage-next'), 'click', () => this.step(1));
    on($('garage-done'), 'click', () => this.d.close());
    on($('garage-act'), 'click', () => this.act());
    on($('garage-repair'), 'click', () => this.run(this.d.repair(this.cur())));
    this.root.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const btns = [...this.root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled);
        if (!btns.length) return;
        e.preventDefault();
        e.stopPropagation();
        const at = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[nextFocusIndex(btns.length, at, e.shiftKey ? -1 : 1)].focus();
      },
      { capture: true, signal: ac.signal },
    );
    on(this.root, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    on(this.canvas, 'pointerdown', (e: PointerEvent) => {
      this.dragX = e.clientX;
      this.pointer = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
    });
    on(this.canvas, 'pointermove', (e: PointerEvent) => {
      if (this.dragX === null || e.pointerId !== this.pointer) return;
      this.yaw += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
      this.draw();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointer) this.dragX = null;
    };
    on(this.canvas, 'pointerup', end);
    on(this.canvas, 'pointercancel', end);
    on(this.canvas, 'webglcontextlost', (e: Event) => e.preventDefault());
  }

  private cur(): string {
    return this.d.shop[this.index].id;
  }

  private step(dir: 1 | -1): void {
    this.index = stepCar(this.d.shop.length, this.index, dir);
    this.note = '';
    this.refresh();
  }

  private act(): void {
    const c = carCard(this.d.shop, this.d.garage, this.d.health, this.d.money(), this.cur());
    if (c.canSelect) this.run(this.d.select(c.id));
    else if (c.status === 'locked') this.run(this.d.buy(c.id));
  }

  private run(note: string): void {
    this.note = note;
    this.refresh();
  }

  /** Redraw the text, buttons and 3D car for the car being viewed. */
  refresh(): void {
    const id = this.cur();
    const c = carCard(this.d.shop, this.d.garage, this.d.health, this.d.money(), id);
    $('garage-coins').textContent = `You have ${this.d.money()} coins.`;
    $('garage-name').textContent = vehicleOf(id).name;
    const state = $('garage-state');
    state.className = `garage-state ${c.status}`;
    state.textContent =
      c.status === 'selected' ? 'Driving' : c.status === 'owned' ? 'Owned' : `Locked · ${c.price} coins`;
    const hp = $('garage-hp');
    hp.classList.toggle('hidden', c.status === 'locked');
    hp.classList.toggle('damaged', c.damaged && !c.wrecked);
    hp.classList.toggle('wrecked', c.wrecked);
    $('garage-hp-fill').style.width = `${c.hp}%`;
    $('garage-hp-text').textContent = c.wrecked ? '0 HP · wrecked' : `${c.hp} HP`;
    $('garage-note').textContent = this.note;
    const act = $<HTMLButtonElement>('garage-act');
    act.textContent =
      c.status === 'selected' ? '✓ Driving' : c.status === 'owned' ? 'Drive this car' : `Buy: ${c.price} coins`;
    act.disabled = c.status === 'selected';
    act.classList.toggle('primary', c.status !== 'selected');
    const rep = $<HTMLButtonElement>('garage-repair');
    rep.classList.toggle('hidden', c.repairCost <= 0);
    rep.textContent = `Repair: ${c.repairCost} coins`;
    rep.disabled = !c.canRepair;
    const dots = $('garage-dots');
    dots.replaceChildren(
      ...this.d.shop.map((_, i) => {
        const s = document.createElement('span');
        if (i === this.index) s.className = 'on';
        return s;
      }),
    );
    this.showModel(id);
  }

  private startRenderer(): void {
    try {
      const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(this.d.pixelRatio ?? devicePixelRatio, 2));
      this.renderer = r;
    } catch {
      this.renderer = null; // no WebGL: the list and actions still work without the picture
      return;
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 7, 5);
    this.scene.add(sun);
    this.camera.position.set(0, 2.4, 7.2);
    this.camera.lookAt(0, 0.7, 0);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.canvas);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private stopRenderer(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizer?.disconnect();
    this.resizer = null;
    this.clearModel();
    this.scene.clear();
    const r = this.renderer;
    this.renderer = null;
    if (r) {
      r.dispose();
      r.forceContextLoss(); // hand the WebGL context back now, not at garbage collection
    }
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!this.renderer || !w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private clearModel(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    // Model geometry and materials are shared with the game; only the per-car lamp boxes and materials are ours.
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!CAR_SHARED.has(m.geometry)) m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (!CAR_SHARED.has(mat)) mat.dispose();
    });
    this.model = null;
  }

  private showModel(id: string): void {
    if (!this.renderer) return;
    this.clearModel();
    const v = vehicleOf(id);
    const car = createVehicleModel(v);
    // Fit the car to the frame whatever its size.
    const size = new THREE.Box3().setFromObject(car.root).getSize(new THREE.Vector3());
    const fit = 5.2 / Math.max(size.x, size.z, 1);
    car.root.scale.setScalar(fit);
    const pivot = new THREE.Group();
    pivot.add(car.root);
    pivot.rotation.y = this.yaw;
    this.scene.add(pivot);
    this.model = pivot;
    this.draw();
  }

  private loop = (t: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.dragX === null && !this.d.reducedMotion()) this.yaw += dt * 0.5;
    this.draw();
  };

  private draw(): void {
    if (!this.renderer) return;
    if (this.model) this.model.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.camera);
  }
}
