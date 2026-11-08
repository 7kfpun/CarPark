export interface Progress {
  unlocked: number; // number of levels playable
  stars: number[]; // best stars per level
  best: number[]; // best completion time per level in seconds, 0 = none
}

const KEY = 'car-parking-3d:progress';

/** A stored best time is only valid when it is a finite, positive number. */
function cleanTime(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Turns parsed saved data (any shape, `best` may be missing) into a valid Progress. */
export function sanitizeProgress(p: Partial<Progress> | null | undefined, count: number): Progress {
  const stars = new Array<number>(count).fill(0).map((_, i) => Number(p?.stars?.[i]) || 0);
  const best = new Array<number>(count).fill(0).map((_, i) => cleanTime(Array.isArray(p?.best) ? p.best[i] : 0));
  return { unlocked: Math.min(count, Math.max(1, Number(p?.unlocked) || 1)), stars, best };
}

/** Stores `time` as the level's best if it beats the saved one. Returns true when it did. */
export function recordBest(p: Progress, level: number, time: number): boolean {
  const t = cleanTime(time);
  if (!t) return false;
  const old = p.best[level] ?? 0;
  if (old && t >= old) return false;
  p.best[level] = t;
  return true;
}

export function loadProgress(count: number): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeProgress(raw ? (JSON.parse(raw) as Partial<Progress>) : null, count);
  } catch {
    return sanitizeProgress(null, count);
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode etc.) - progress just won't persist
  }
}
