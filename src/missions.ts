/** Daily missions: a few small goals that pay in-game money, reset once per local calendar day. Client storage only. */

export type MissionId = 'park3' | 'star3' | 'worlds2';

export interface MissionDef {
  id: MissionId;
  label: string;
  goal: number;
  reward: number;
}

/** The fixed daily set. Kept short and achievable in a few minutes. */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'park3', label: 'Park 3 times', goal: 3, reward: 100 },
  { id: 'star3', label: 'Earn a 3★ park', goal: 1, reward: 150 },
  { id: 'worlds2', label: 'Park on 2 different levels', goal: 2, reward: 100 },
];

export interface Missions {
  v: 1;
  day: string; // local calendar day, YYYY-MM-DD
  parks: number; // wins today
  star3: number; // 3-star wins today
  levels: string[]; // distinct level ids won today
  claimed: MissionId[];
}

export interface Wallet {
  v: 1;
  money: number;
}

export const MISSIONS_KEY = 'carpark.missions';
/** Minimal currency balance; to be reconciled with the other garage-economy slices once one lands on main. */
export const WALLET_KEY = 'carpark.money';

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function freshMissions(day: string): Missions {
  return { v: 1, day, parks: 0, star3: 0, levels: [], claimed: [] };
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 999999) : 0;
}

/** Turn whatever was stored into today's missions; a different day or junk starts fresh. */
export function parseMissions(raw: unknown, day: string): Missions {
  const out = freshMissions(day);
  if (!raw || typeof raw !== 'object') return out;
  const m = raw as Partial<Record<keyof Missions, unknown>>;
  if (m.day !== day) return out;
  out.parks = count(m.parks);
  out.star3 = count(m.star3);
  if (Array.isArray(m.levels)) out.levels = [...new Set(m.levels.filter((x): x is string => typeof x === 'string'))];
  if (Array.isArray(m.claimed)) {
    const claimed = m.claimed as unknown[];
    out.claimed = MISSIONS.map((d) => d.id).filter((id) => claimed.includes(id));
  }
  return out;
}

/** Roll over to a new day: progress and claims reset. */
export function rollDay(m: Missions, day: string): Missions {
  return m.day === day ? m : freshMissions(day);
}

/** Count a finished level. Returns a new object. */
export function recordPark(m: Missions, levelId: string, stars: number): Missions {
  return {
    ...m,
    parks: m.parks + 1,
    star3: m.star3 + (stars >= 3 ? 1 : 0),
    levels: m.levels.includes(levelId) ? m.levels : [...m.levels, levelId],
  };
}

function defOf(id: MissionId): MissionDef {
  return MISSIONS.find((d) => d.id === id)!;
}

export function progressFor(m: Missions, id: MissionId): number {
  const v = id === 'park3' ? m.parks : id === 'star3' ? m.star3 : m.levels.length;
  return Math.min(v, defOf(id).goal);
}

export function isComplete(m: Missions, id: MissionId): boolean {
  return progressFor(m, id) >= defOf(id).goal;
}

export function canClaim(m: Missions, id: MissionId): boolean {
  return isComplete(m, id) && !m.claimed.includes(id);
}

/** Claim a finished mission once. Returns the new state and the money it pays (0 when not claimable). */
export function claim(m: Missions, id: MissionId): { missions: Missions; reward: number } {
  if (!canClaim(m, id)) return { missions: m, reward: 0 };
  return { missions: { ...m, claimed: [...m.claimed, id] }, reward: defOf(id).reward };
}

export function parseWallet(raw: unknown): Wallet {
  const money = raw && typeof raw === 'object' ? count((raw as { money?: unknown }).money) : 0;
  return { v: 1, money };
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** True when the value was stored. */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // storage unavailable (private mode etc.) - just won't persist
    return false;
  }
}

export function loadMissions(now: Date = new Date()): Missions {
  return parseMissions(read(MISSIONS_KEY), dayKey(now));
}

export function saveMissions(m: Missions): void {
  write(MISSIONS_KEY, m);
}

export function loadWallet(): Wallet {
  return parseWallet(read(WALLET_KEY));
}

/** True when the wallet was stored. */
export function saveWallet(w: Wallet): boolean {
  return write(WALLET_KEY, w);
}
