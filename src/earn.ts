/**
 * Hourly earn: in-game money that accrues with real time and is claimed from the menu.
 * Client-side only (localStorage, the device clock); a trusted server clock comes with the mobile apps.
 */
export interface Earn {
  v: 1;
  balance: number; // whole coins the player holds
  lastClaim: number; // ms epoch: start of the time not yet paid out
}

const KEY = 'carpark.earn';
export const COINS_PER_HOUR = 50;
export const HOUR_MS = 3_600_000;
/** Time stops accruing after this long, so a long absence is worth a day, not a week. */
export const MAX_HOURS = 8;

function whole(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/** A new player starts the clock now and has nothing to claim yet. */
export function freshEarn(now: number): Earn {
  return { v: 1, balance: 0, lastClaim: now };
}

/** Turn whatever was stored into a valid state; a clock set behind the last claim restarts the clock. */
export function parseEarn(raw: unknown, now: number): Earn {
  if (!raw || typeof raw !== 'object') return freshEarn(now);
  const p = raw as { balance?: unknown; lastClaim?: unknown };
  const last = whole(p.lastClaim, now);
  return { v: 1, balance: whole(p.balance, 0), lastClaim: last > now ? now : last };
}

/** Whole hours ready to claim, capped at MAX_HOURS. */
export function hoursReady(e: Earn, now: number): number {
  const ms = now - e.lastClaim;
  if (!(ms > 0)) return 0;
  return Math.min(MAX_HOURS, Math.floor(ms / HOUR_MS));
}

export function pendingCoins(e: Earn, now: number): number {
  return hoursReady(e, now) * COINS_PER_HOUR;
}

/** Milliseconds until the next whole hour is ready; 0 once the cap is reached. */
export function msToNext(e: Earn, now: number): number {
  if (hoursReady(e, now) >= MAX_HOURS) return 0;
  const ms = Math.max(0, now - e.lastClaim);
  return HOUR_MS - (ms % HOUR_MS);
}

/** Pays out the ready hours. Returns the coins added. A capped wait restarts the clock; otherwise leftover time is kept. */
export function claim(e: Earn, now: number): number {
  const hours = hoursReady(e, now);
  if (!hours) return 0;
  const coins = hours * COINS_PER_HOUR;
  e.balance += coins;
  e.lastClaim = hours >= MAX_HOURS ? now : e.lastClaim + hours * HOUR_MS;
  return coins;
}

/** "42m" / "1h 05m" style label for a duration. */
export function waitLabel(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

export function loadEarn(now: number = Date.now()): Earn {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseEarn(JSON.parse(raw), now) : freshEarn(now);
  } catch {
    return freshEarn(now);
  }
}

export function saveEarn(e: Earn): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(e));
  } catch {
    // storage unavailable - earnings just won't persist
  }
}
