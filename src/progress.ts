/** Saved progress, keyed by permanent level id so adding or reordering levels never shifts it. */
export interface Progress {
  v: 2;
  stars: Record<string, number>; // best stars per level id
  unlocked: string[]; // ids of playable levels
}

const KEY = 'car-parking-3d:progress';

/** The level order when saves were keyed by position (v1). Never edit: it describes old saves. */
export const V1_LEVEL_IDS = ['first-steps', 'back-it-in', 'parallel-pro', 'cone-gates', 'the-garage', 'rush-hour'];

/** Ids in play order; the first level is always playable. */
export function freshProgress(ids: string[]): Progress {
  return { v: 2, stars: {}, unlocked: ids.slice(0, 1) };
}

function starCount(n: unknown): number {
  const s = Math.floor(Number(n));
  return s >= 1 && s <= 3 ? s : 0;
}

/** Turn whatever was stored (v1, v2 or junk) into progress for the current level list. */
export function parseProgress(raw: unknown, ids: string[]): Progress {
  const out = freshProgress(ids);
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as { v?: unknown; stars?: unknown; unlocked?: unknown };
  const known = new Set(ids);
  const unlocked = new Set(out.unlocked);

  if (p.v === 2) {
    if (p.stars && typeof p.stars === 'object') {
      for (const [id, n] of Object.entries(p.stars)) if (known.has(id) && starCount(n)) out.stars[id] = starCount(n);
    }
    if (Array.isArray(p.unlocked)) for (const id of p.unlocked) if (known.has(id)) unlocked.add(id);
  } else {
    // v1: stars[] by position and `unlocked` = number of playable levels, in the old order.
    if (Array.isArray(p.stars)) {
      p.stars.forEach((n, i) => {
        const id = V1_LEVEL_IDS[i];
        if (id && known.has(id) && starCount(n)) out.stars[id] = starCount(n);
      });
    }
    const count = Math.min(V1_LEVEL_IDS.length, Math.floor(Number(p.unlocked)) || 1);
    for (const id of V1_LEVEL_IDS.slice(0, count)) if (known.has(id)) unlocked.add(id);
  }
  // Keep the saved order of the current list and make sure a starred level counts as unlocked.
  for (const id of Object.keys(out.stars)) unlocked.add(id);
  out.unlocked = ids.filter((id) => unlocked.has(id));
  return out;
}

export function isUnlocked(p: Progress, id: string): boolean {
  return p.unlocked.includes(id);
}

export function starsFor(p: Progress, id: string): number {
  return p.stars[id] ?? 0;
}

/** Index of the furthest unlocked level in play order (where "Enter" resumes). */
export function resumeIndex(p: Progress, ids: string[]): number {
  let at = 0;
  ids.forEach((id, i) => {
    if (isUnlocked(p, id)) at = i;
  });
  return at;
}

/** Record a win on ids[index]: keep the best stars and unlock the next level by position. */
export function recordWin(p: Progress, ids: string[], index: number, stars: number): void {
  const id = ids[index];
  p.stars[id] = Math.max(starsFor(p, id), stars);
  const next = ids[index + 1];
  if (next && !isUnlocked(p, next)) p.unlocked = ids.filter((x) => isUnlocked(p, x) || x === next);
}

export function loadProgress(ids: string[]): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseProgress(JSON.parse(raw), ids) : freshProgress(ids);
  } catch {
    return freshProgress(ids);
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode etc.) - progress just won't persist
  }
}
