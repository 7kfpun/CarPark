/**
 * Spend-to-repair for a damaged car (CARP-126).
 *
 * Self-contained slice: `coins` and `hp` live here under their own storage key until the currency
 * (CARP-124) and HP/crash damage (CARP-125) modules land on main; those should replace `RepairState`
 * with their own balance and HP and keep `repairCost` / `repair` as the spend rule.
 */
export interface RepairState {
  v: 1;
  coins: number; // whole in-game currency the player holds
  hp: number; // current hit points of the car, 0..MAX_HP
}

export const MAX_HP = 100;
/** Coins charged per missing HP point. */
export const COST_PER_HP = 2;

const KEY = 'carpark.repair';

export function freshRepair(): RepairState {
  return { v: 1, coins: 0, hp: MAX_HP };
}

function toInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** Turn whatever was stored (valid, partial or junk) into a sane state. */
export function parseRepair(raw: unknown): RepairState {
  const out = freshRepair();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as { coins?: unknown; hp?: unknown };
  out.coins = toInt(p.coins, 0, Number.MAX_SAFE_INTEGER, 0);
  out.hp = toInt(p.hp, 0, MAX_HP, MAX_HP);
  return out;
}

/** True when the car is below full HP, so a repair makes sense. */
export function isDamaged(s: RepairState): boolean {
  return s.hp < MAX_HP;
}

/** Coins needed to restore the car to full HP. */
export function repairCost(s: RepairState): number {
  return (MAX_HP - s.hp) * COST_PER_HP;
}

/** Whether the player can pay for a full repair of a damaged car. */
export function canRepair(s: RepairState): boolean {
  return isDamaged(s) && s.coins >= repairCost(s);
}

/** Pays for a full repair. Returns false and changes nothing when the car is undamaged or coins fall short. */
export function repair(s: RepairState): boolean {
  if (!canRepair(s)) return false;
  s.coins -= repairCost(s);
  s.hp = MAX_HP;
  return true;
}

export function loadRepair(): RepairState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseRepair(JSON.parse(raw)) : freshRepair();
  } catch {
    return freshRepair();
  }
}

export function saveRepair(s: RepairState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode etc.) - the repair just won't persist
  }
}
