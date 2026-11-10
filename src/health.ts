/** Car HP: every vehicle starts at full HP and loses some in each crash. Kept in the browser only. */
export interface Health {
  v: 1;
  hp: Record<string, number>; // current HP per vehicle id; a missing id means full HP
}

export const MAX_HP = 100;
/** HP lost per m/s of approach speed in a crash. */
export const DAMAGE_PER_MPS = 5;
/** Even a gentle bump costs this much. */
export const MIN_DAMAGE = 1;

const KEY = 'carpark.health';

export function freshHealth(): Health {
  return { v: 1, hp: {} };
}

/** HP lost for a crash at `impact` m/s: proportional to speed, at least MIN_DAMAGE, at most MAX_HP. */
export function crashDamage(impact: number): number {
  if (!Number.isFinite(impact) || impact <= 0) return 0;
  return Math.min(MAX_HP, Math.max(MIN_DAMAGE, Math.round(impact * DAMAGE_PER_MPS)));
}

/** Current HP of a vehicle, 0 to MAX_HP. */
export function hpFor(h: Health, id: string): number {
  const n = h.hp[id];
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_HP, Math.max(0, Math.floor(n))) : MAX_HP;
}

/** Takes `damage` off the vehicle's HP (never below 0). Returns its HP left. */
export function applyDamage(h: Health, id: string, damage: number): number {
  const left = Math.max(0, hpFor(h, id) - Math.max(0, Math.floor(damage)));
  h.hp[id] = left;
  return left;
}

/** Turns whatever was stored into health; junk and out-of-range values are dropped. */
export function parseHealth(raw: unknown): Health {
  const out = freshHealth();
  if (!raw || typeof raw !== 'object') return out;
  const hp = (raw as { hp?: unknown }).hp;
  if (!hp || typeof hp !== 'object' || Array.isArray(hp)) return out;
  for (const [id, n] of Object.entries(hp)) {
    if (typeof n === 'number' && Number.isFinite(n)) out.hp[id] = Math.min(MAX_HP, Math.max(0, Math.floor(n)));
  }
  return out;
}

export function loadHealth(): Health {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseHealth(JSON.parse(raw)) : freshHealth();
  } catch {
    return freshHealth();
  }
}

export function saveHealth(h: Health): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // storage unavailable (private mode etc.) - HP just won't persist
  }
}
