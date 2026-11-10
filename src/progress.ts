/** Saved progress, keyed by permanent level id so adding or reordering levels never shifts it. */
export interface Progress {
  v: 2;
  stars: Record<string, number>; // best stars per level id
  unlocked: string[]; // ids of playable levels
  best: Record<string, number>; // best completion time in seconds per level id
}

const KEY = 'car-parking-3d:progress';
const MAX_STARS = 3;

function toInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** The level order when saves were keyed by position (v1). Never edit: it describes old saves. */
export const V1_LEVEL_IDS = ['first-steps', 'back-it-in', 'parallel-pro', 'cone-gates', 'the-garage', 'rush-hour'];

/** Ids in play order; the first level is always playable. */
export function freshProgress(ids: string[]): Progress {
  return { v: 2, stars: {}, unlocked: ids.slice(0, 1), best: {} };
}

/** Stars clamped to integers 0-3; anything that isn't a finite number counts as 0. */
function starCount(n: unknown): number {
  return toInt(n, 0, MAX_STARS, 0);
}

/** True when a stored save claims a version newer than this build understands. */
function isFutureSave(raw: unknown): boolean {
  const v = raw && typeof raw === 'object' ? (raw as { v?: unknown }).v : undefined;
  return typeof v === 'number' && v > 2;
}

/** Saved entries for level ids this build doesn't list; written back so an older or smaller build never erases them. */
interface Extras {
  stars: Record<string, number>;
  unlocked: string[];
  best: Record<string, number>;
}

function emptyExtras(): Extras {
  return { stars: {}, unlocked: [], best: {} };
}

/** The valid stars, unlocks and best times stored for ids outside `ids`. */
export function unknownEntries(raw: unknown, ids: string[]): Extras {
  const out = emptyExtras();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as { v?: unknown; stars?: unknown; unlocked?: unknown; best?: unknown };
  const known = new Set(ids);
  if (p.best && typeof p.best === 'object' && !Array.isArray(p.best)) {
    for (const [id, t] of Object.entries(p.best)) if (!known.has(id) && cleanTime(t)) out.best[id] = cleanTime(t);
  }
  // Positional v1 saves only ever name the old built-in ids, so only v2+ can carry unknown ones.
  if (p.v !== undefined && p.v !== 1) {
    if (p.stars && typeof p.stars === 'object' && !Array.isArray(p.stars)) {
      for (const [id, n] of Object.entries(p.stars)) if (!known.has(id) && starCount(n)) out.stars[id] = starCount(n);
    }
    if (Array.isArray(p.unlocked)) {
      for (const id of p.unlocked) if (typeof id === 'string' && !known.has(id)) out.unlocked.push(id);
    }
  }
  return out;
}

/** `p` plus the saved entries for unknown ids; this build's own values win. */
export function withUnknown(p: Progress, extra: Extras): Progress {
  return {
    ...p,
    stars: { ...extra.stars, ...p.stars },
    unlocked: [...p.unlocked, ...extra.unlocked.filter((id) => !p.unlocked.includes(id))],
    best: { ...extra.best, ...p.best },
  };
}

/** Turn whatever was stored (v1, v2 or junk) into progress for the current level list. */
export function parseProgress(raw: unknown, ids: string[]): Progress {
  const out = freshProgress(ids);
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as { v?: unknown; stars?: unknown; unlocked?: unknown; best?: unknown };
  const known = new Set(ids);
  if (p.best && typeof p.best === 'object' && !Array.isArray(p.best)) {
    for (const [id, t] of Object.entries(p.best)) {
      const time = cleanTime(t);
      if (known.has(id) && time) out.best[id] = time;
    }
  }
  const unlocked = new Set(out.unlocked);

  // Only a missing (or 1) version is the positional v1 format; v2 and any newer save is read as v2.
  if (p.v !== undefined && p.v !== 1) {
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
    const count = toInt(p.unlocked, 1, V1_LEVEL_IDS.length, 1);
    for (const id of V1_LEVEL_IDS.slice(0, count)) if (known.has(id)) unlocked.add(id);
  }
  // Keep the saved order of the current list and make sure a starred level counts as unlocked.
  for (const id of Object.keys(out.stars)) unlocked.add(id);
  out.unlocked = ids.filter((id) => unlocked.has(id));
  return out;
}

/** A stored best time is only valid when it is a finite, positive number. */
function cleanTime(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Best time in seconds for a level id, 0 when none. */
export function bestFor(p: Progress, id: string): number {
  return cleanTime(p.best[id]);
}

/** Stores `time` as the level's best if it beats the saved one. Returns true when it did. */
export function recordBest(p: Progress, id: string, time: number): boolean {
  const t = cleanTime(time);
  if (!t) return false;
  const old = bestFor(p, id);
  if (old && t >= old) return false;
  p.best[id] = t;
  return true;
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

/** Set when the stored save is from a newer version: the best-effort parse of it, so we never overwrite it unchanged. */
let futureSnapshot: string | null = null;
/** Stored entries for level ids this build doesn't know, kept from the last load. */
let unknownSaved: Extras = emptyExtras();

export function loadProgress(ids: string[]): Progress {
  futureSnapshot = null;
  unknownSaved = emptyExtras();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshProgress(ids);
    const data: unknown = JSON.parse(raw);
    const p = parseProgress(data, ids);
    unknownSaved = unknownEntries(data, ids);
    if (isFutureSave(data)) futureSnapshot = JSON.stringify(p);
    return p;
  } catch {
    return freshProgress(ids);
  }
}

/** Writes progress. A newer-version save is left untouched until the player earns something new. */
export function saveProgress(p: Progress): void {
  if (futureSnapshot !== null) {
    if (JSON.stringify(p) === futureSnapshot) return;
    futureSnapshot = null;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(withUnknown(p, unknownSaved)));
  } catch {
    // storage unavailable (private mode etc.) - progress just won't persist
  }
}
