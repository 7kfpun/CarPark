import type { LevelDef } from './layout';
import { bestFor, isUnlocked, starsFor, type Progress } from './progress';
import { APP_VERSION } from './version';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

function starString(n: number, total = 3): string {
  return '★'.repeat(n) + '☆'.repeat(total - n);
}

function starLabel(n: number, total = 3): string {
  return `${n} of ${total} star${total === 1 ? '' : 's'}`;
}

export function bestLabel(t: number): string {
  return `${t.toFixed(1)}s`;
}

export class Hud {
  private readonly hud = $('hud');
  private readonly menu = $('menu');
  private readonly modal = $('modal');
  private readonly touch = $('touch');
  private readonly level = $('hud-level');
  private readonly timer = $('hud-timer');
  private readonly hits = $('hud-hits');
  private readonly gear = $('hud-gear');
  private readonly hint = $('hud-hint');
  private readonly meter = $('park-meter');
  private readonly meterFill = $('park-fill');
  private readonly meterLabel = $('park-label');
  private readonly flash = $('flash');
  private readonly live = $('sr-status');
  private hintTimer = 0;
  private livesLabel = '';
  private parkLabel = '';
  private liveTimer = 0;

  readonly touchEnabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  showMenu(levels: LevelDef[], progress: Progress, onSelect: (i: number) => void): void {
    $('tagline').textContent = `${levels.length} lots. One bay each. Don't scratch the paint.`;
    const grid = $('level-grid');
    grid.replaceChildren();
    levels.forEach((lvl, i) => {
      const b = document.createElement('button');
      b.className = 'level-btn';
      const locked = !isUnlocked(progress, lvl.id);
      const stars = starsFor(progress, lvl.id);
      b.disabled = locked;
      const best = bestFor(progress, lvl.id);
      b.setAttribute(
        'aria-label',
        `Level ${i + 1}, ${lvl.name}, ${locked ? 'locked' : starLabel(stars)}${best ? `, best time ${bestLabel(best)}` : ''}`,
      );
      b.innerHTML = `<span class="num" aria-hidden="true">${locked ? '🔒' : i + 1}</span><span class="name">${lvl.name}</span><span class="stars" aria-hidden="true">${starString(stars)}</span>${best ? `<span class="best" aria-hidden="true">${bestLabel(best)}</span>` : ''}`;
      b.addEventListener('click', () => onSelect(i));
      grid.appendChild(b);
    });
    const total = levels.reduce((a, l) => a + starsFor(progress, l.id), 0);
    $('menu-total').innerHTML =
      `${total} / ${levels.length * 3} <span aria-hidden="true">★</span><span class="sr-only">stars</span>`;
    $('menu-version').textContent = `v${APP_VERSION}`;
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.touch.classList.add('hidden');
    this.hideModal();
  }

  startLevel(index: number, def: LevelDef): void {
    this.menu.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.touch.classList.toggle('hidden', !this.touchEnabled);
    this.level.textContent = `${index + 1}. ${def.name}`;
    this.setPark(null, '');
    this.showHint(def.hint, 5);
    this.hideModal();
  }

  update(timeLeft: number, hits: number, maxHits: number, speed: number): void {
    const t = Math.max(0, Math.ceil(timeLeft));
    this.timer.textContent = `⏱ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('warn', timeLeft < 10);
    this.hits.textContent = '♥'.repeat(Math.max(0, maxHits - hits)) + '♡'.repeat(Math.min(maxHits, hits));
    const lives = `${Math.max(0, maxHits - hits)} of ${maxHits} lives left`;
    if (lives !== this.livesLabel) {
      this.livesLabel = lives;
      this.hits.setAttribute('aria-label', lives);
    }
    const kmh = Math.round(Math.abs(speed) * 3.6);
    this.gear.textContent = `${speed < -0.05 ? 'R' : 'D'} · ${kmh} km/h`;
    this.gear.classList.toggle('reverse', speed < -0.05);
  }

  tick(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.add('fade');
    }
  }

  showHint(text: string, seconds: number): void {
    this.hint.textContent = text;
    this.hint.classList.remove('fade');
    this.hintTimer = seconds;
    this.announce(text);
  }

  /** Polite screen-reader announcement; repeated text is re-read. */
  announce(text: string): void {
    clearTimeout(this.liveTimer);
    this.live.textContent = '';
    this.liveTimer = window.setTimeout(() => (this.live.textContent = text), 60);
  }

  /** fraction null hides the meter. */
  setPark(fraction: number | null, label: string): void {
    this.meter.classList.toggle('hidden', fraction === null);
    if (fraction !== null) {
      this.meterFill.style.width = `${Math.round(fraction * 100)}%`;
      this.meterLabel.textContent = label;
    }
    // Announce status changes only, never every frame.
    if (label !== this.parkLabel) {
      this.parkLabel = label;
      if (label) this.announce(label);
    }
  }

  flashHit(): void {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
  }

  showModal(title: string, body: string, stars: number | null, buttons: ModalButton[]): void {
    $('modal-title').textContent = title;
    $('modal-body').textContent = body;
    const s = $('modal-stars');
    s.textContent = stars === null ? '' : starString(stars);
    s.classList.toggle('hidden', stars === null);
    if (stars === null) s.removeAttribute('aria-label');
    else s.setAttribute('aria-label', starLabel(stars));
    const row = $('modal-buttons');
    row.replaceChildren();
    // One transition per modal: a double click must not fire twice (e.g. skip two levels).
    let used = false;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.classList.add('primary');
      el.addEventListener('click', () => {
        if (used) return;
        used = true;
        b.onClick();
      });
      row.appendChild(el);
    }
    this.modal.classList.remove('hidden');
    this.announce(stars === null ? `${title}. ${body}` : `${title} ${starLabel(stars)}. ${body}`);
    (row.querySelector('.primary') as HTMLButtonElement | null)?.focus();
  }

  hideModal(): void {
    this.modal.classList.add('hidden');
  }

  /** Click the modal's primary button (keyboard shortcut when nothing is focused). */
  clickPrimary(): void {
    if (this.modalOpen) (this.modal.querySelector('#modal-buttons .primary') as HTMLButtonElement | null)?.click();
  }

  private modalButtons(): HTMLButtonElement[] {
    return [...this.modal.querySelectorAll<HTMLButtonElement>('#modal-buttons button')];
  }

  /** Keep keyboard focus inside the open modal; arrows move between its buttons. */
  private trapFocus = (e: KeyboardEvent): void => {
    if (!this.modalOpen) return;
    const dir = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const btns = this.modalButtons();
    if (!btns.length) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = i < 0 ? (dir > 0 ? 0 : btns.length - 1) : (i + dir + btns.length) % btns.length;
    btns[next].focus();
  };

  constructor() {
    document.addEventListener('keydown', this.trapFocus);
  }

  get modalOpen(): boolean {
    return !this.modal.classList.contains('hidden');
  }
}
