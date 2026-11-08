export interface Progress {
  unlocked: number; // number of levels playable
  stars: number[]; // best stars per level
}

const KEY = 'car-parking-3d:progress';
const MAX_STARS = 3;

function toInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

export function loadProgress(count: number): Progress {
  const fresh: Progress = { unlocked: 1, stars: new Array(count).fill(0) };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<Progress>;
    const saved: unknown = p?.stars;
    const stars = fresh.stars.map((_, i) => toInt(Array.isArray(saved) ? saved[i] : undefined, 0, MAX_STARS, 0));
    return { unlocked: toInt(p?.unlocked, 1, count, 1), stars };
  } catch {
    return fresh;
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode etc.) - progress just won't persist
  }
}
