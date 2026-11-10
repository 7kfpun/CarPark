/** The player's garage: coins, the cars they own and the one they drive. Stored on its own, in this browser only. */
export interface Garage {
  v: 1;
  coins: number;
  owned: string[]; // vehicle ids
  selected: string; // vehicle id, always owned
}

export interface ShopCar {
  id: string; // a vehicle id from src/vehicles.ts
  price: number; // coins; 0 = the starter car
}

/** Cars on sale. Only the passenger cars: the bigger vehicles belong to their own levels. */
export const SHOP: readonly ShopCar[] = [
  { id: 'hatchback', price: 0 },
  { id: 'sedan', price: 300 },
  { id: 'suv', price: 500 },
];

/** Placeholder balance until the earning ticket (CARP-128) feeds `coins`. */
export const START_COINS = 500;

const KEY = 'carpark.garage';
const MAX_COINS = 1_000_000_000;

const priceOf = (id: string): number | undefined => SHOP.find((c) => c.id === id)?.price;

export function freshGarage(): Garage {
  return { v: 1, coins: START_COINS, owned: [SHOP[0].id], selected: SHOP[0].id };
}

/** Turn whatever was stored into a valid garage: unknown cars dropped, starter car always owned. */
export function parseGarage(raw: unknown): Garage {
  const out = freshGarage();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as { coins?: unknown; owned?: unknown; selected?: unknown };
  if (typeof p.coins === 'number' && Number.isFinite(p.coins)) {
    out.coins = Math.min(MAX_COINS, Math.max(0, Math.floor(p.coins)));
  }
  if (Array.isArray(p.owned)) {
    for (const id of p.owned)
      if (typeof id === 'string' && priceOf(id) !== undefined && !out.owned.includes(id)) out.owned.push(id);
  }
  if (typeof p.selected === 'string' && out.owned.includes(p.selected)) out.selected = p.selected;
  return out;
}

export type BuyResult = 'bought' | 'owned' | 'poor' | 'unknown';

/** Spends coins on a car and selects it. Changes `g` only when it returns 'bought'. */
export function buyCar(g: Garage, id: string): BuyResult {
  const price = priceOf(id);
  if (price === undefined) return 'unknown';
  if (g.owned.includes(id)) return 'owned';
  if (g.coins < price) return 'poor';
  g.coins -= price;
  g.owned.push(id);
  g.selected = id;
  return 'bought';
}

/** Switches to an owned car. Returns false for one the player doesn't own. */
export function selectCar(g: Garage, id: string): boolean {
  if (!g.owned.includes(id)) return false;
  g.selected = id;
  return true;
}

/** The vehicle to drive: a level with its own vehicle keeps it, any other level uses the selected car. */
export function driveVehicleId(levelVehicle: string | undefined, g: Garage): string {
  return levelVehicle ?? g.selected;
}

export function loadGarage(): Garage {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseGarage(JSON.parse(raw)) : freshGarage();
  } catch {
    return freshGarage();
  }
}

export function saveGarage(g: Garage): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // storage unavailable (private mode etc.) - the garage just won't persist
  }
}
