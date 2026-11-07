export interface Progress {
  unlocked: number; // number of levels playable
  stars: number[]; // best stars per level
}

const KEY = 'car-parking-3d:progress';

export function loadProgress(count: number): Progress {
  const fresh: Progress = { unlocked: 1, stars: new Array(count).fill(0) };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<Progress>;
    const stars = fresh.stars.map((_, i) => Number(p.stars?.[i]) || 0);
    return { unlocked: Math.min(count, Math.max(1, Number(p.unlocked) || 1)), stars };
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
