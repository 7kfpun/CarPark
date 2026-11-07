import type { Controls } from './physics';

type TouchKey = 'up' | 'down' | 'left' | 'right' | 'brake';

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);

export class Input {
  private readonly keys = new Set<string>();
  private readonly touch: Record<TouchKey, boolean> = { up: false, down: false, left: false, right: false, brake: false };
  private readonly actions = new Map<string, () => void>();

  constructor() {
    addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.actions.get(e.code)?.();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());
  }

  /** Register a one-shot action for a key code (fires on press, not repeat). */
  on(code: string, fn: () => void): void {
    this.actions.set(code, fn);
  }

  clear(): void {
    this.keys.clear();
    for (const k of Object.keys(this.touch) as TouchKey[]) this.touch[k] = false;
  }

  bindTouch(el: HTMLElement, key: TouchKey): void {
    const set = (v: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      this.touch[key] = v;
      el.classList.toggle('active', v);
      if (v) el.setPointerCapture(e.pointerId);
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  get controls(): Controls {
    const up = this.touch.up || this.any('KeyW', 'ArrowUp');
    const down = this.touch.down || this.any('KeyS', 'ArrowDown');
    const left = this.touch.left || this.any('KeyA', 'ArrowLeft');
    const right = this.touch.right || this.any('KeyD', 'ArrowRight');
    return {
      throttle: (up ? 1 : 0) - (down ? 1 : 0),
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: this.touch.brake || this.any('Space'),
    };
  }
}
