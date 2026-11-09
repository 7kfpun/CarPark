import { padConfirmAction } from './guards';
import type { Controls } from './physics';

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

/** Keys a focused control activates natively (button click, link follow...). */
const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

function isInteractive(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || el.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
  );
}

/** Steering wheel: rotation (degrees) either side of centre that gives full lock. */
export const WHEEL_LOCK = 120;
/** Fraction of full lock that still counts as straight ahead. */
const WHEEL_DEADZONE = 0.05;
/** Finger distance (px) from the wheel centre inside which the grab angle is too noisy to follow. */
const WHEEL_MIN_RADIUS = 14;
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

/** D-pad buttons (standard mapping) -> focus direction. */
const PAD_DPAD: ReadonlyArray<readonly [number, Dir]> = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];
/** Left stick deflection that counts as a d-pad press for menu focus. */
const NAV_STICK = 0.6;

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Index of the box to focus when moving `dir` from box `from` (null = nothing focused:
 * first box for down/right, last for up/left). Prefers the nearest box in that direction,
 * penalising sideways drift; returns -1 when nothing lies that way.
 */
export function pickNeighbor(from: Box | null, boxes: readonly Box[], dir: Dir): number {
  if (!boxes.length) return -1;
  if (!from) return dir === 'down' || dir === 'right' ? 0 : boxes.length - 1;
  const cx = (b: Box) => (b.left + b.right) / 2;
  const cy = (b: Box) => (b.top + b.bottom) / 2;
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    const along = horizontal ? cx(b) - cx(from) : cy(b) - cy(from);
    const across = horizontal ? cy(b) - cy(from) : cx(b) - cx(from);
    if (along * sign <= 1) return;
    const score = along * sign + Math.abs(across) * 3;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

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

/** Angle (degrees, 0 = straight up, clockwise positive) of a point `dx`, `dy` (screen px) from the wheel centre. */
export function pointerAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Shortest signed difference `to - from` between two angles in degrees, in -180..180. */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Wheel rotation after the finger moved from angle `prev` to `next`, clamped to the lock (degrees). */
export function turnWheel(wheel: number, prev: number, next: number, lock = WHEEL_LOCK): number {
  return Math.max(-lock, Math.min(lock, wheel + angleDelta(prev, next)));
}

/** Map wheel rotation (degrees, + = clockwise = right) to steer -1..1, the same range as the keyboard. */
export function steerFromWheel(wheel: number, lock = WHEEL_LOCK, dz = WHEEL_DEADZONE): number {
  return deadzone(wheel / lock, dz);
}

/**
 * Map the on-screen pedals to drive controls. Brake wins over the accelerator and holds the car
 * (never reverses it); the accelerator drives forward, or backward while the gear is reverse.
 */
export function pedalControls(
  accel: boolean,
  brake: boolean,
  reverse: boolean,
): { throttle: number; handbrake: boolean } {
  if (brake) return { throttle: 0, handbrake: true };
  return { throttle: accel ? (reverse ? -1 : 1) : 0, handbrake: false };
}

/** Which input device last drove the game; the on-screen cockpit only shows for touch. */
export type InputSource = 'touch' | 'keys' | 'pad';

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
  private wheelEl: HTMLElement | null = null;
  private wheelRot: HTMLElement | null = null;
  private wheelLabel: HTMLElement | null = null;
  private wheelPointer: number | null = null;
  private wheelPrev = 0;
  private wheelAngle = 0;
  private touchSteer = 0;
  private accelPointers = new Set<number>();
  private brakePointers = new Set<number>();
  private accelEl: HTMLElement | null = null;
  private brakeEl: HTMLElement | null = null;
  private gearEl: HTMLElement | null = null;
  private reverse = false;
  private source: InputSource = 'touch';
  private pad: PadState = { steer: 0, throttle: 0, handbrake: false };
  private readonly padButtons = new Map<number, boolean>();
  private readonly navDirs = new Set<Dir>();
  private padLoop = 0;

  /** Set by the game: true while the car is being driven (game keys are captured). */
  driving: () => boolean = () => false;
  /** Set by the game: false while an overlay (e.g. settings) owns input; gamepad actions are skipped. */
  actionsEnabled: () => boolean = () => true;
  /** Set by the game: the topmost open menu / modal / settings panel the pad moves focus within (null = none). */
  navRoot: () => HTMLElement | null = () => null;

  constructor() {
    addEventListener('keydown', (e) => {
      const driving = this.driving();
      const focused = isInteractive(e.target);
      if (GAME_KEYS.has(e.code)) this.setSource('keys');
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
    addEventListener('gamepadconnected', () => {
      this.setSource('pad');
      this.startPadLoop();
    });
    addEventListener('gamepaddisconnected', () => this.setSource('touch'));
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setSource('touch');
    });
  }

  /** Register a one-shot action for a key code (fires on press, not repeat). */
  on(code: string, fn: () => void): void {
    this.actions.set(code, fn);
  }

  clear(): void {
    this.keys.clear();
    this.releaseTouch();
  }

  /** Track the active input device on <body data-input> so CSS can hide the cockpit for keyboard / pad. */
  private setSource(src: InputSource): void {
    if (src === this.source) return;
    this.source = src;
    document.body.dataset.input = src;
  }

  /**
   * Wire up the on-screen cockpit inside `root`: the steering wheel (#t-wheel with a .wheel-rot child,
   * dragged round its centre), the accelerator (#t-accel) and brake (#t-brake) pedals and the
   * R / D gear toggle (#t-gear).
   */
  bindTouch(root: HTMLElement): void {
    document.body.dataset.input = this.source;
    const wheel = root.querySelector<HTMLElement>('#t-wheel');
    if (wheel) this.bindWheel(wheel);
    this.accelEl = root.querySelector<HTMLElement>('#t-accel');
    this.brakeEl = root.querySelector<HTMLElement>('#t-brake');
    if (this.accelEl) this.bindPedal(this.accelEl, this.accelPointers);
    if (this.brakeEl) this.bindPedal(this.brakeEl, this.brakePointers);
    this.gearEl = root.querySelector<HTMLElement>('#t-gear');
    this.gearEl?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setReverse(!this.reverse);
    });
    this.setReverse(false);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Select reverse (true) or drive (false) for the accelerator pedal. */
  setReverse(on: boolean): void {
    this.reverse = on;
    const g = this.gearEl;
    if (!g) return;
    g.textContent = on ? 'R' : 'D';
    g.classList.toggle('reverse', on);
    g.setAttribute('aria-pressed', String(on));
    this.accelEl?.classList.toggle('reverse', on);
  }

  private bindWheel(el: HTMLElement): void {
    this.wheelEl = el;
    this.wheelRot = el.querySelector<HTMLElement>('.wheel-rot');
    this.wheelLabel = el.querySelector<HTMLElement>('.wheel-lock');
    const angleAt = (e: PointerEvent): number | null => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      return Math.hypot(dx, dy) < WHEEL_MIN_RADIUS ? null : pointerAngle(dx, dy);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.wheelPointer !== null) return;
      this.wheelPointer = e.pointerId;
      this.wheelPrev = angleAt(e) ?? 0;
      capture(el, e.pointerId);
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.wheelPointer) return;
      e.preventDefault();
      const a = angleAt(e);
      if (a === null) return;
      this.setWheel(turnWheel(this.wheelAngle, this.wheelPrev, a));
      this.wheelPrev = a;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.wheelPointer) this.releaseWheel();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private setWheel(deg: number): void {
    this.wheelAngle = deg;
    this.touchSteer = steerFromWheel(deg);
    if (this.wheelRot) this.wheelRot.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    if (this.wheelLabel) this.wheelLabel.textContent = `${Math.round(Math.abs(deg))}°`;
  }

  /** Let go of the wheel: it springs back to centre. */
  private releaseWheel(): void {
    this.wheelPointer = null;
    this.setWheel(0);
    this.wheelEl?.classList.remove('active');
  }

  /** A pedal is pressed while any finger that landed on it is down (multi-touch safe). */
  private bindPedal(el: HTMLElement, pointers: Set<number>): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      pointers.add(e.pointerId);
      el.classList.add('active');
    });
    const end = (e: PointerEvent) => {
      if (pointers.delete(e.pointerId) && !pointers.size) el.classList.remove('active');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private releaseTouch(): void {
    for (const [set, el] of [
      [this.accelPointers, this.accelEl],
      [this.brakePointers, this.brakeEl],
    ] as const) {
      set.clear();
      el?.classList.remove('active');
    }
    this.releaseWheel();
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
    const navPressed = new Set<Dir>();
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
      if (btn(0)?.pressed) pressed.add(0);
      for (const [i, dir] of PAD_DPAD) if (btn(i)?.pressed) navPressed.add(dir);
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      if (ax < -NAV_STICK) navPressed.add('left');
      if (ax > NAV_STICK) navPressed.add('right');
      if (ay < -NAV_STICK) navPressed.add('up');
      if (ay > NAV_STICK) navPressed.add('down');
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
    // Menu / modal navigation: A confirms (it is the handbrake while driving), d-pad / stick moves focus.
    // Edges are tracked every frame so a button held down while driving doesn't fire when a modal opens.
    const aDown = pressed.has(0);
    if (aDown && !this.padButtons.get(0) && !this.driving()) this.confirm();
    this.padButtons.set(0, aDown);
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const down = navPressed.has(dir);
      if (down && !this.navDirs.has(dir) && !this.driving()) this.navigate(dir);
      if (down) this.navDirs.add(dir);
      else this.navDirs.delete(dir);
    }
    return connected;
  }

  /** Move focus between the enabled buttons of the open overlay (pad d-pad / left stick). */
  private navigate(dir: Dir): void {
    const root = this.navRoot();
    if (!root) return;
    const btns = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(
      (b) => b.offsetWidth > 0 || b.offsetHeight > 0,
    );
    const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
    const i = pickNeighbor(
      cur < 0 ? null : btns[cur].getBoundingClientRect(),
      btns.map((b) => b.getBoundingClientRect()),
      dir,
    );
    btns[i]?.focus();
  }

  /** Pad A while no car is being driven: click the focused button, else the Enter action. */
  private confirm(): void {
    const root = this.navRoot();
    const el = document.activeElement;
    const inNav = !!root && el instanceof HTMLButtonElement && root.contains(el) && !el.disabled;
    const act = padConfirmAction(inNav, this.actionsEnabled());
    if (act === 'click') (el as HTMLButtonElement).click();
    else if (act === 'enter') this.actions.get('Enter')?.();
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  get controls(): Controls {
    const up = this.any('KeyW', 'ArrowUp');
    const down = this.any('KeyS', 'ArrowDown');
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');
    const touch = pedalControls(this.accelPointers.size > 0, this.brakePointers.size > 0, this.reverse);
    return {
      throttle: strongest((up ? 1 : 0) - (down ? 1 : 0), touch.throttle, this.pad.throttle),
      steer: strongest((right ? 1 : 0) - (left ? 1 : 0), this.touchSteer, this.pad.steer),
      handbrake: touch.handbrake || this.pad.handbrake || this.any('Space'),
    };
  }
}
