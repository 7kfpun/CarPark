/**
 * Admin mode: a client-only testing aid (not a security feature). `?admin=1` turns it on for the
 * session, `?admin=0` turns it off. While on, every level is unlocked, levels can be skipped, and
 * saved progress is never written. Kept in one file so it is easy to remove or gate later.
 */
import type { Progress } from './progress';

const KEY = 'car-parking-3d:admin';

/** Admin state from the `admin` URL param and the remembered session value. */
export function resolveAdmin(param: string | null, stored: string | null): boolean {
  if (param === '1') return true;
  if (param === '0') return false;
  return stored === '1';
}

/** Reads `?admin=` and the session, and remembers the result for the rest of the session. */
export function initAdmin(search: string): boolean {
  const param = new URLSearchParams(search).get('admin');
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(KEY);
  } catch {
    // storage unavailable: admin then only lasts for this page load
  }
  const on = resolveAdmin(param, stored);
  try {
    if (on) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return on;
}

/** A copy of `p` with every level unlocked; the original (what is saved) is left alone. */
export function unlockAll(p: Progress, ids: string[]): Progress {
  return { ...p, stars: { ...p.stars }, best: { ...p.best }, unlocked: [...ids] };
}

/** Index to jump to from `index` by `dir` (+1 next, -1 back), or null at either end. */
export function skipTarget(index: number, dir: 1 | -1, count: number): number | null {
  const t = index + dir;
  return t >= 0 && t < count ? t : null;
}

/** Saved progress is only written outside admin mode. */
export function mayPersist(admin: boolean): boolean {
  return !admin;
}

const CONTROLS_KEY = 'car-parking-3d:admin-controls';

/** Whether the on-screen skip buttons are shown: on unless the badge turned them off this session. */
export function loadControls(): boolean {
  try {
    return sessionStorage.getItem(CONTROLS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveControls(on: boolean): void {
  try {
    sessionStorage.setItem(CONTROLS_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}

/** Skip buttons show only in admin mode, with the toggle on, while a level is open. */
export function showSkipButtons(admin: boolean, controls: boolean, playing: boolean): boolean {
  return admin && controls && playing;
}
