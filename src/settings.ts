import { nextFocusIndex } from './focus';
import { CAM_MODES, parseCamMode, type CamMode } from './views';

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export const TEXT_SIZES = ['normal', 'large', 'xlarge'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/** UI zoom factor for each text size. */
export const TEXT_SCALE: Record<TextSize, number> = { normal: 1, large: 1.25, xlarge: 1.5 };

export function parseTextSize(v: unknown, fallback: TextSize = 'normal'): TextSize {
  return TEXT_SIZES.find((t) => t === v) ?? fallback;
}

export type QualitySetting = 'auto' | 'low' | 'high';

export interface Settings {
  sound: boolean;
  /** Background music on/off (needs sound on). */
  music: boolean;
  /** Index into VOLUME_STEPS for effects/engine and for music. */
  sfxVol: number;
  musicVol: number;
  quality: QualitySetting;
  camera: CamMode;
  /** Switch to the corner (rear) view while reversing. */
  autoRear: boolean;
  mirror: boolean;
  wheel: 'left' | 'right';
  /** Fail a level when its time runs out. Off: the timer counts up and stars still follow the finish time. */
  timeLimit: boolean;
  /** Scale of the menus, HUD text and panels. */
  textSize: TextSize;
}

const KEY = 'car-parking-3d:settings:v1';

export function loadSettings(): Settings {
  const fresh: Settings = {
    sound: true,
    music: true,
    sfxVol: 1,
    musicVol: 1,
    quality: 'auto',
    camera: 'chase',
    autoRear: false,
    mirror: true,
    wheel: 'left',
    timeLimit: true,
    textSize: 'normal',
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw) as Partial<Settings> | null;
    if (!s || typeof s !== 'object') return fresh;
    return {
      sound: typeof s.sound === 'boolean' ? s.sound : fresh.sound,
      music: typeof s.music === 'boolean' ? s.music : fresh.music,
      sfxVol: s.sfxVol === 0 || s.sfxVol === 1 || s.sfxVol === 2 ? s.sfxVol : fresh.sfxVol,
      musicVol: s.musicVol === 0 || s.musicVol === 1 || s.musicVol === 2 ? s.musicVol : fresh.musicVol,
      quality: s.quality === 'low' || s.quality === 'high' || s.quality === 'auto' ? s.quality : fresh.quality,
      camera: parseCamMode(s.camera, fresh.camera),
      autoRear: typeof s.autoRear === 'boolean' ? s.autoRear : fresh.autoRear,
      mirror: typeof s.mirror === 'boolean' ? s.mirror : fresh.mirror,
      wheel: s.wheel === 'right' || s.wheel === 'left' ? s.wheel : fresh.wheel,
      timeLimit: typeof s.timeLimit === 'boolean' ? s.timeLimit : fresh.timeLimit,
      textSize: parseTextSize(s.textSize, fresh.textSize),
    };
  } catch {
    return fresh;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode etc.) - settings just won't persist
  }
}

type Choice<K extends keyof Settings> = { key: K; values: Settings[K][] };

/** The settings screen (#settings): segmented buttons wired to a Settings object. */
export class SettingsPanel {
  private readonly root = document.getElementById('settings')!;
  private readonly rows: Choice<keyof Settings>[] = [
    { key: 'sound', values: [true, false] },
    { key: 'sfxVol', values: [0, 1, 2] },
    { key: 'music', values: [true, false] },
    { key: 'musicVol', values: [0, 1, 2] },
    { key: 'quality', values: ['low', 'high', 'auto'] },
    { key: 'camera', values: [...CAM_MODES] },
    { key: 'autoRear', values: [true, false] },
    { key: 'mirror', values: [true, false] },
    { key: 'wheel', values: ['left', 'right'] },
    { key: 'timeLimit', values: [true, false] },
    { key: 'textSize', values: [...TEXT_SIZES] },
  ];
  private readonly tabs = [...this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  private onClose: (() => void) | null = null;
  private opener: HTMLElement | null = null;

  constructor(
    readonly settings: Settings,
    private readonly onChange: (s: Settings, key: keyof Settings) => void,
  ) {
    for (const row of this.rows) {
      for (const v of row.values) {
        this.button(row.key, v)?.addEventListener('click', () => this.set(row.key, v));
      }
    }
    document.getElementById('settings-done')!.addEventListener('click', () => this.close());
    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab!));
      tab.addEventListener('keydown', (e) => {
        const last = this.tabs.length - 1;
        const at = this.tabs.indexOf(tab);
        const to =
          e.key === 'ArrowRight'
            ? (at + 1) % this.tabs.length
            : e.key === 'ArrowLeft'
              ? (at + last) % this.tabs.length
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? last
                  : -1;
        if (to < 0) return;
        const next = this.tabs[to];
        this.showTab(next.dataset.tab!);
        next.focus();
        e.preventDefault();
        e.stopPropagation(); // keep the arrows away from the game's own key handlers
      });
    });
    this.showTab(this.tabs[0].dataset.tab!);
    // While open, keys don't reach the game's own actions; Escape closes the panel.
    addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen) return;
        // Tablist navigation reaches the tab's own handler (which stops it there).
        if (NAV_KEYS.has(e.key) && (e.target as Element | null)?.closest?.('[data-tab]')) return;
        e.stopImmediatePropagation();
        if (e.code === 'Escape') this.close();
        else if (e.key === 'Tab') this.trapTab(e);
      },
      true,
    );
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Keep Tab / Shift+Tab inside the dialog's buttons. */
  private trapTab(e: KeyboardEvent): void {
    const btns = [...this.root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.closest('[hidden]'));
    if (!btns.length) return;
    e.preventDefault();
    btns[
      nextFocusIndex(btns.length, btns.indexOf(document.activeElement as HTMLButtonElement), e.shiftKey ? -1 : 1)
    ].focus();
  }

  /** Show one section; only the selected tab is in the Tab order. */
  private showTab(name: string): void {
    for (const tab of this.tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      this.root.querySelector<HTMLElement>(`[data-pane="${tab.dataset.tab}"]`)!.hidden = !on;
    }
  }

  private button(key: keyof Settings, v: Settings[keyof Settings]): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`[data-setting="${key}"][data-value="${String(v)}"]`);
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    saveSettings(this.settings);
    this.refresh();
    this.onChange(this.settings, key);
  }

  private refresh(): void {
    for (const row of this.rows) {
      for (const v of row.values) {
        const b = this.button(row.key, v);
        if (!b) continue;
        const on = this.settings[row.key] === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
  }

  /** Show the panel; onClose runs once when it is dismissed. */
  open(onClose: () => void, opener: HTMLElement | null = null): void {
    this.onClose = onClose;
    this.opener = opener;
    this.refresh();
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-tab][aria-selected="true"]')?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.add('hidden');
    const cb = this.onClose;
    this.onClose = null;
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
    cb?.();
  }
}
