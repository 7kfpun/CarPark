import type { LevelDef } from './layout';
import type { Progress } from './progress';

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
  private hintTimer = 0;

  readonly touchEnabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  showMenu(levels: LevelDef[], progress: Progress, onSelect: (i: number) => void): void {
    const grid = $('level-grid');
    grid.replaceChildren();
    levels.forEach((lvl, i) => {
      const b = document.createElement('button');
      b.className = 'level-btn';
      const locked = i >= progress.unlocked;
      b.disabled = locked;
      b.innerHTML = `<span class="num">${locked ? '🔒' : i + 1}</span><span class="name">${lvl.name}</span><span class="stars">${starString(progress.stars[i])}</span>`;
      b.addEventListener('click', () => onSelect(i));
      grid.appendChild(b);
    });
    const total = progress.stars.reduce((a, b) => a + b, 0);
    $('menu-total').textContent = `${total} / ${levels.length * 3} ★`;
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
  }

  /** fraction null hides the meter. */
  setPark(fraction: number | null, label: string): void {
    this.meter.classList.toggle('hidden', fraction === null);
    if (fraction !== null) {
      this.meterFill.style.width = `${Math.round(fraction * 100)}%`;
      this.meterLabel.textContent = label;
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
    const row = $('modal-buttons');
    row.replaceChildren();
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.classList.add('primary');
      el.addEventListener('click', b.onClick);
      row.appendChild(el);
    }
    this.modal.classList.remove('hidden');
    (row.querySelector('.primary') as HTMLButtonElement | null)?.focus();
  }

  hideModal(): void {
    this.modal.classList.add('hidden');
  }

  get modalOpen(): boolean {
    return !this.modal.classList.contains('hidden');
  }
}
