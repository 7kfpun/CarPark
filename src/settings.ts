import { nextFocusIndex } from './focus';
import type { CamMode } from './camera';

export type QualitySetting = 'auto' | 'low' | 'high';

export interface Settings {
  sound: boolean;
  quality: QualitySetting;
  camera: CamMode;
  mirror: boolean;
  wheel: 'left' | 'right';
}

const KEY = 'car-parking-3d:settings:v1';

export function loadSettings(): Settings {
  const fresh: Settings = { sound: true, quality: 'auto', camera: 'chase', mirror: true, wheel: 'left' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw) as Partial<Settings> | null;
    if (!s || typeof s !== 'object') return fresh;
    return {
      sound: typeof s.sound === 'boolean' ? s.sound : fresh.sound,
      quality: s.quality === 'low' || s.quality === 'high' || s.quality === 'auto' ? s.quality : fresh.quality,
      camera: s.camera === 'top' || s.camera === 'chase' ? s.camera : fresh.camera,
      mirror: typeof s.mirror === 'boolean' ? s.mirror : fresh.mirror,
      wheel: s.wheel === 'right' || s.wheel === 'left' ? s.wheel : fresh.wheel,
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
    { key: 'quality', values: ['low', 'high', 'auto'] },
    { key: 'camera', values: ['chase', 'top'] },
    { key: 'mirror', values: [true, false] },
    { key: 'wheel', values: ['left', 'right'] },
  ];
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
    // While open, keys don't reach the game's own actions; Escape closes the panel.
    addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen) return;
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
    const btns = [...this.root.querySelectorAll<HTMLButtonElement>('button')];
    if (!btns.length) return;
    e.preventDefault();
    btns[
      nextFocusIndex(btns.length, btns.indexOf(document.activeElement as HTMLButtonElement), e.shiftKey ? -1 : 1)
    ].focus();
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
    this.root.querySelector<HTMLButtonElement>('button.on')?.focus();
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
