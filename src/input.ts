import type { Controls } from './physics';

type Pedal = 'up' | 'down' | 'brake';

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

/** Keys a focused control activates natively (button click, link follow...). */
const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

function isInteractive(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || el.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
  );
}

/** Steering pad: finger travel (px) from the touch-down point for full lock. */
const STEER_TRAVEL = 56;
const STEER_DEADZONE = 0.08;
/** Pedal hit-test slack (px) so sliding across the gap between pedals doesn't drop out. */
const PEDAL_SLACK = 14;
const STICK_DEADZONE = 0.15;
const TRIGGER_DEADZONE = 0.05;

/**
 * Standard-mapping gamepad buttons -> key codes, so pad presses fire the same
 * actions registered via `on()`: Start = pause, Y / Back = camera, X = restart.
 */
const PAD_ACTIONS: ReadonlyArray<readonly [number, string]> = [
  [9, 'Escape'],
  [3, 'KeyC'],
  [8, 'KeyC'],
  [2, 'KeyR'],
];

/** Zero inside the dead zone, then rescaled so the output still spans 0..±1 (clamped). */
export function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (!(a > dz)) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** Combine several -1..1 inputs by taking the one with the largest magnitude. */
export function strongest(...values: number[]): number {
  let best = 0;
  for (const v of values) if (Math.abs(v) > Math.abs(best)) best = v;
  return best;
}

/** Map a horizontal finger offset (px) from the touch-down point to steer -1..1. */
export function steerFromOffset(dx: number, travel = STEER_TRAVEL, dz = STEER_DEADZONE): number {
  return deadzone(dx / travel, dz);
}

/** Capture so moves keep arriving after the finger leaves the element (throws if the pointer is already gone). */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already released; the up/cancel handlers clean up.
  }
}

interface PadState {
  steer: number;
  throttle: number;
  handbrake: boolean;
}

export class Input {
  private readonly keys = new Set<string>();
  private readonly actions = new Map<string, () => void>();
  /** Active pedal / handbrake pointers -> the pedal each is over (null = slid off). */
  private readonly pedalPointers = new Map<number, Pedal | null>();
  private readonly pedalEls: Partial<Record<Pedal, HTMLElement>> = {};
  private steerEl: HTMLElement | null = null;
  private steerKnob: HTMLElement | null = null;
  private steerPointer: number | null = null;
  private steerOrigin = 0;
  private touchSteer = 0;
  private pad: PadState = { steer: 0, throttle: 0, handbrake: false };
  private readonly padButtons = new Map<number, boolean>();
  private padLoop = 0;

  /** Set by the game: true while the car is being driven (game keys are captured). */
  driving: () => boolean = () => false;
  /** Set by the game: false while an overlay (e.g. settings) owns input; gamepad actions are skipped. */
  actionsEnabled: () => boolean = () => true;

  constructor() {
    addEventListener('keydown', (e) => {
      const driving = this.driving();
      const focused = isInteractive(e.target);
      if (driving) {
        // Swallow drive keys (and Enter, so a stray focused HUD button can't be clicked).
        if (GAME_KEYS.has(e.code) || ACTIVATE_KEYS.has(e.code)) e.preventDefault();
        this.keys.add(e.code);
      } else if (e.code === 'Space' && !focused) {
        e.preventDefault(); // no page scroll; arrows stay free for menu navigation
      }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // A focused button gets its native Enter/Space activation instead of the global action.
      if (!driving && focused && ACTIVATE_KEYS.has(e.code)) return;
      this.actions.get(e.code)?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());
    addEventListener('gamepadconnected', () => this.startPadLoop());
  }

  /** Register a one-shot action for a key code (fires on press, not repeat). */
  on(code: string, fn: () => void): void {
    this.actions.set(code, fn);
  }

  clear(): void {
    this.keys.clear();
    this.releaseTouch();
  }

  /**
   * Wire up the on-screen controls inside `root`: the analog steering pad
   * (#t-steer with a .knob child), the ▲ / ▼ pedals (#t-up / #t-down inside
   * .pedals; slide between them without lifting) and the P handbrake (#t-brake).
   */
  bindTouch(root: HTMLElement): void {
    const steer = root.querySelector<HTMLElement>('#t-steer');
    if (steer) this.bindSteer(steer);
    for (const key of ['up', 'down', 'brake'] as const) {
      const el = root.querySelector<HTMLElement>(`#t-${key}`);
      if (el) this.pedalEls[key] = el;
    }
    const pedals = root.querySelector<HTMLElement>('.pedals');
    if (pedals) this.bindPedalZone(pedals, ['up', 'down']);
    if (this.pedalEls.brake) this.bindPedalZone(this.pedalEls.brake, ['brake']);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindSteer(el: HTMLElement): void {
    this.steerEl = el;
    this.steerKnob = el.querySelector<HTMLElement>('.knob');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.steerPointer !== null) return;
      this.steerPointer = e.pointerId;
      this.steerOrigin = e.clientX;
      capture(el, e.pointerId);
      el.classList.add('active');
      this.setSteer(0);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer) return;
      e.preventDefault();
      this.setSteer(steerFromOffset(e.clientX - this.steerOrigin));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.steerPointer) this.releaseSteer();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private setSteer(v: number): void {
    this.touchSteer = v;
    const knob = this.steerKnob;
    if (!knob || !this.steerEl) return;
    // Keep the knob inside the pad even if it's narrower than the steering travel.
    const room = Math.max(0, (this.steerEl.clientWidth - knob.offsetWidth) / 2);
    knob.style.transform = `translateX(${(v * Math.min(STEER_TRAVEL, room)).toFixed(1)}px)`;
  }

  private releaseSteer(): void {
    this.steerPointer = null;
    this.setSteer(0);
    this.steerEl?.classList.remove('active');
  }

  /** Pointer-tracked zone: whichever of `keys` each finger is currently over is pressed. */
  private bindPedalZone(zone: HTMLElement, keys: readonly Pedal[]): void {
    const hit = (x: number, y: number): Pedal | null => {
      let best: Pedal | null = null;
      let bestDist = PEDAL_SLACK;
      for (const k of keys) {
        const r = this.pedalEls[k]?.getBoundingClientRect();
        if (!r) continue;
        const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
        if (d <= bestDist) {
          best = k;
          bestDist = d;
        }
      }
      return best;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const k = hit(e.clientX, e.clientY);
      if (!k) return;
      capture(zone, e.pointerId);
      this.pedalPointers.set(e.pointerId, k);
      this.refreshPedals();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!this.pedalPointers.has(e.pointerId)) return;
      e.preventDefault();
      const k = hit(e.clientX, e.clientY);
      if (k === this.pedalPointers.get(e.pointerId)) return;
      this.pedalPointers.set(e.pointerId, k);
      this.refreshPedals();
    });
    const end = (e: PointerEvent) => {
      if (this.pedalPointers.delete(e.pointerId)) this.refreshPedals();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private pedal(k: Pedal): boolean {
    for (const v of this.pedalPointers.values()) if (v === k) return true;
    return false;
  }

  private refreshPedals(): void {
    for (const k of ['up', 'down', 'brake'] as const) this.pedalEls[k]?.classList.toggle('active', this.pedal(k));
  }

  private releaseTouch(): void {
    this.pedalPointers.clear();
    this.refreshPedals();
    this.releaseSteer();
  }

  // --- Gamepad -----------------------------------------------------------------
  private startPadLoop(): void {
    if (this.padLoop) return;
    const tick = () => {
      this.padLoop = this.poll() ? requestAnimationFrame(tick) : 0;
    };
    this.padLoop = requestAnimationFrame(tick);
  }

  /**
   * Read connected gamepads: updates the analog state and fires `on()` actions
   * on button press edges. Runs every frame by itself while a pad is connected
   * (safe to call extra times). Returns whether any gamepad is connected.
   */
  poll(): boolean {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const next: PadState = { steer: 0, throttle: 0, handbrake: false };
    const pressed = new Set<number>();
    let connected = false;
    for (const gp of pads) {
      if (!gp?.connected) continue;
      connected = true;
      const btn = (i: number) => gp.buttons[i];
      const trigger = (i: number) => deadzone(btn(i)?.value ?? 0, TRIGGER_DEADZONE);
      next.steer = strongest(next.steer, deadzone(gp.axes[0] ?? 0, STICK_DEADZONE));
      next.throttle = strongest(next.throttle, trigger(7) - trigger(6));
      next.handbrake ||= !!btn(0)?.pressed || !!btn(5)?.pressed;
      for (const [i] of PAD_ACTIONS) if (btn(i)?.pressed) pressed.add(i);
    }
    this.pad = next;
    const fired = new Set<string>();
    for (const [i, code] of PAD_ACTIONS) {
      const down = pressed.has(i);
      if (down && !this.padButtons.get(i) && !fired.has(code) && this.actionsEnabled()) {
        fired.add(code);
        this.actions.get(code)?.();
      }
      this.padButtons.set(i, down);
    }
    return connected;
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  get controls(): Controls {
    const up = this.pedal('up') || this.any('KeyW', 'ArrowUp');
    const down = this.pedal('down') || this.any('KeyS', 'ArrowDown');
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');
    return {
      throttle: strongest((up ? 1 : 0) - (down ? 1 : 0), this.pad.throttle),
      steer: strongest((right ? 1 : 0) - (left ? 1 : 0), this.touchSteer, this.pad.steer),
      handbrake: this.pedal('brake') || this.pad.handbrake || this.any('Space'),
    };
  }
}
