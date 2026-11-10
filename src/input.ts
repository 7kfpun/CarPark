import { padConfirmAction } from './guards';
import type { Controls } from './physics';

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

/** True when a Cmd/Ctrl/Alt modifier is held: a browser or OS shortcut, never a drive key. */
export function isShortcut(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

/** Meta keyup: macOS swallows the keyup of any key pressed while Cmd is held, so held keys must be dropped. */
export function isMetaKey(code: string): boolean {
  return code === 'MetaLeft' || code === 'MetaRight';
}

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

/** Reverse held shorter than this (s) does nothing: a brush of S or the R gear never backs the car out. */
export const REVERSE_DELAY = 0.15;
/** After the delay, reverse pull ramps from REVERSE_START to full over REVERSE_RAMP seconds. */
export const REVERSE_RAMP = 0.6;
export const REVERSE_START = 0.35;

/** Soften a throttle command: forward is untouched, reverse is delayed then eased in by how long it has been held. */
export function softReverse(throttle: number, heldSeconds: number): number {
  if (throttle >= 0) return throttle;
  if (heldSeconds < REVERSE_DELAY) return 0;
  const k = Math.min(1, (heldSeconds - REVERSE_DELAY) / REVERSE_RAMP);
  return throttle * (REVERSE_START + (1 - REVERSE_START) * k);
}

/** Gear lever slots: D at the top of the gate (0), R at the bottom (1). */
export type Gear = 'D' | 'R';

/** Nearest gear for a lever position (0 = top slot D, 1 = bottom slot R); the midpoint goes to R. */
export function gearFromGate(pos: number): Gear {
  return pos >= 0.5 ? 'R' : 'D';
}

/** Resting lever position for a gear. */
export function gateSlot(gear: Gear): number {
  return gear === 'R' ? 1 : 0;
}

/** Lever position (clamped 0..1) for a pointer at `y` on a gate spanning `top`..`top + height` (knob travel only). */
export function gatePos(y: number, top: number, height: number): number {
  if (height <= 0) return 0;
  return Math.min(1, Math.max(0, (y - top) / height));
}

/** Gear after an arrow / Home / End key on the lever (Up = D, Down = R); null for any other key. */
export function gearFromKey(code: string, current: Gear): Gear | null {
  if (code === 'ArrowUp' || code === 'Home') return 'D';
  if (code === 'ArrowDown' || code === 'End') return 'R';
  if (code === 'ArrowLeft' || code === 'ArrowRight') return current;
  return null;
}

/** How long (ms) a touch that the browser cancelled (edge swipe, system gesture) is held before it counts as released. */
export const GRIP_GRACE_MS = 250;

/** A touch the browser cancelled while the finger may still be down: remember when it was first lost. */
export function gripLost(lostAt: number | null, now: number): number {
  return lostAt ?? now;
}

/** True once a lost touch has gone unclaimed for the whole grace period (null = never lost = not expired). */
export function gripExpired(lostAt: number | null, now: number, grace = GRIP_GRACE_MS): boolean {
  return lostAt !== null && now - lostAt >= grace;
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
  /** When the wheel touch was cancelled by the browser (held for a grace period), else null. */
  private wheelLostAt: number | null = null;
  private wheelPrev = 0;
  private wheelAngle = 0;
  private touchSteer = 0;
  /** Pointer id -> time the browser cancelled it (null while it is a live touch). */
  private accelPointers = new Map<number, number | null>();
  private brakePointers = new Map<number, number | null>();
  private graceTimer = 0;
  private accelEl: HTMLElement | null = null;
  private brakeEl: HTMLElement | null = null;
  private gearEl: HTMLElement | null = null;
  /** Pointer currently dragging the gear lever, else null. */
  private gearPointer: number | null = null;
  private reverse = false;
  /** When reverse was first asked for in the current press, or null. */
  private reverseSince: number | null = null;
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
      // Cmd/Ctrl/Alt combos belong to the browser: don't track them (their keyup may never arrive) or swallow them.
      if (isShortcut(e)) return;
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
      if (e.repeat) return;
      // A focused button gets its native Enter/Space activation instead of the global action.
      if (!driving && focused && ACTIVATE_KEYS.has(e.code)) return;
      this.actions.get(e.code)?.();
    });
    addEventListener('keyup', (e) => {
      if (isMetaKey(e.code)) this.keys.clear();
      else this.keys.delete(e.code);
    });
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
   * R / D gear lever (#t-gear).
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
    if (this.gearEl) this.bindGear(this.gearEl);
    this.setReverse(false);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Select reverse (true) or drive (false) for the accelerator pedal; the lever, pill and aria follow. */
  setReverse(on: boolean): void {
    this.reverse = on;
    this.accelEl?.classList.toggle('reverse', on);
    this.drawGear(on ? 'R' : 'D', null);
  }

  /** Paint the lever: knob at the slot (or at drag position `pos`), letter glow, aria state. */
  private drawGear(gear: Gear, pos: number | null): void {
    const g = this.gearEl;
    if (!g) return;
    g.style.setProperty('--gate-pos', String(pos ?? gateSlot(gear)));
    g.classList.toggle('reverse', gear === 'R');
    g.classList.toggle('dragging', pos !== null);
    g.setAttribute('aria-valuenow', String(gateSlot(gear)));
    g.setAttribute('aria-valuetext', gear === 'R' ? 'Reverse' : 'Drive');
  }

  /**
   * The gear lever (#t-gear, a vertical gate): drag the knob or tap a slot. The gear changes on release,
   * so a cancelled touch (finger off the screen edge) springs the knob back instead of flipping it.
   */
  private bindGear(el: HTMLElement): void {
    const travel = (): { top: number; height: number } => {
      const r = el.getBoundingClientRect();
      const pad = r.width / 2; // half a knob at each end
      return { top: r.top + pad, height: r.height - 2 * pad };
    };
    const posAt = (e: PointerEvent): number => {
      const t = travel();
      return gatePos(e.clientY, t.top, t.height);
    };
    const current = (): Gear => (this.reverse ? 'R' : 'D');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.gearPointer !== null) return;
      this.gearPointer = e.pointerId;
      capture(el, e.pointerId);
      this.drawGear(current(), posAt(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.gearPointer) return;
      e.preventDefault();
      this.drawGear(current(), posAt(e));
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.gearPointer) return;
      this.gearPointer = null;
      this.setReverse(gearFromGate(posAt(e)) === 'R');
    });
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== this.gearPointer) return;
      this.gearPointer = null;
      this.drawGear(current(), null);
    };
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
    el.addEventListener('keydown', (e) => {
      const next = gearFromKey(e.code, current());
      if (next === null) return;
      // Keep the arrow from also steering / scrolling.
      e.preventDefault();
      e.stopPropagation();
      this.setReverse(next === 'R');
    });
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
      // A new touch while the old one is only held (cancelled) takes over without snapping the wheel.
      if (this.wheelPointer !== null && this.wheelLostAt === null) return;
      this.wheelPointer = e.pointerId;
      this.wheelLostAt = null;
      this.wheelPrev = angleAt(e) ?? 0;
      capture(el, e.pointerId);
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (e) => {
      // clear() (pause / finish / restart) drops the grab while the finger still holds capture: re-adopt it.
      if (this.wheelPointer === null && el.hasPointerCapture(e.pointerId)) {
        this.wheelPointer = e.pointerId;
        this.wheelPrev = angleAt(e) ?? 0;
        el.classList.add('active');
      }
      if (e.pointerId !== this.wheelPointer) return;
      e.preventDefault();
      if (this.wheelLostAt !== null) {
        // The same finger is still moving after a cancel: resume from where the wheel is, no snap.
        this.wheelLostAt = null;
        this.wheelPrev = angleAt(e) ?? this.wheelPrev;
        capture(el, e.pointerId);
      }
      const a = angleAt(e);
      if (a === null) return;
      this.setWheel(turnWheel(this.wheelAngle, this.wheelPrev, a));
      this.wheelPrev = a;
    });
    // Only a real pointerup lets go at once; cancel / lost capture (edge swipes) hold for a grace period.
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.wheelPointer) this.releaseWheel();
    });
    const lost = (e: PointerEvent) => {
      if (e.pointerId !== this.wheelPointer) return;
      this.wheelLostAt = gripLost(this.wheelLostAt, performance.now());
      this.scheduleGrace();
    };
    el.addEventListener('pointercancel', lost);
    el.addEventListener('lostpointercapture', lost);
  }

  /** Arm one timer that lets go of any held (cancelled) touch that nobody re-claimed within the grace period. */
  private scheduleGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = window.setTimeout(() => {
      this.graceTimer = 0;
      const now = performance.now();
      if (gripExpired(this.wheelLostAt, now)) this.releaseWheel();
      for (const [set, el] of [
        [this.accelPointers, this.accelEl],
        [this.brakePointers, this.brakeEl],
      ] as const) {
        for (const [id, lostAt] of set) if (gripExpired(lostAt, now)) set.delete(id);
        if (!set.size) el?.classList.remove('active');
      }
      const pending = [this.wheelLostAt, ...this.accelPointers.values(), ...this.brakePointers.values()];
      if (pending.some((t) => t !== null)) this.scheduleGrace();
    }, GRIP_GRACE_MS);
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
    this.wheelLostAt = null;
    this.setWheel(0);
    this.wheelEl?.classList.remove('active');
  }

  /** A pedal is pressed while any finger that landed on it is down (multi-touch safe). */
  private bindPedal(el: HTMLElement, pointers: Map<number, number | null>): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      pointers.set(e.pointerId, null);
      el.classList.add('active');
    });
    // clear() empties the set while the finger still holds capture: re-adopt it on the next move.
    // A touch the browser cancelled (held) resumes when the same finger moves again.
    el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) {
        if (pointers.get(e.pointerId) !== null) {
          pointers.set(e.pointerId, null);
          capture(el, e.pointerId);
        }
      } else if (el.hasPointerCapture(e.pointerId)) {
        pointers.set(e.pointerId, null);
        el.classList.add('active');
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (pointers.delete(e.pointerId) && !pointers.size) el.classList.remove('active');
    });
    const lost = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, gripLost(pointers.get(e.pointerId) ?? null, performance.now()));
      this.scheduleGrace();
    };
    el.addEventListener('pointercancel', lost);
    el.addEventListener('lostpointercapture', lost);
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
    const raw = strongest((up ? 1 : 0) - (down ? 1 : 0), touch.throttle, this.pad.throttle);
    const now = performance.now();
    if (raw < 0) this.reverseSince ??= now;
    else this.reverseSince = null;
    const held = this.reverseSince === null ? 0 : (now - this.reverseSince) / 1000;
    return {
      throttle: softReverse(raw, held),
      steer: strongest((right ? 1 : 0) - (left ? 1 : 0), this.touchSteer, this.pad.steer),
      handbrake: touch.handbrake || this.pad.handbrake || this.any('Space'),
    };
  }
}
