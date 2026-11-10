/**
 * The player's garage: the cars they own and the one they drive. Stored on its own, in this browser only.
 * Coins are the shared wallet (src/missions.ts); HP is per vehicle (src/health.ts). Buying and repairing spend that wallet.
 */
import { COST_PER_HP } from './repair';
import { hpFor, MAX_HP, type Health } from './health';

export interface Garage {
  v: 1;
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

const KEY = 'carpark.garage';

const priceOf = (id: string): number | undefined => SHOP.find((c) => c.id === id)?.price;

export function freshGarage(): Garage {
  return { v: 1, owned: [SHOP[0].id], selected: SHOP[0].id };
}

/** Turn whatever was stored into a valid garage: unknown cars dropped, starter car always owned. */
export function parseGarage(raw: unknown): Garage {
  const out = freshGarage();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as { owned?: unknown; selected?: unknown };
  if (Array.isArray(p.owned)) {
    for (const id of p.owned)
      if (typeof id === 'string' && priceOf(id) !== undefined && !out.owned.includes(id)) out.owned.push(id);
  }
  if (typeof p.selected === 'string' && out.owned.includes(p.selected)) out.selected = p.selected;
  return out;
}

export type BuyResult = 'bought' | 'owned' | 'poor' | 'unknown';

/** The shared wallet balance (the `money` of a Wallet from src/missions.ts). */
export interface Purse {
  money: number;
}

/** Spends wallet coins on a car and selects it. Changes `g` and `w` only when it returns 'bought'. */
export function buyCar(g: Garage, w: Purse, id: string, h?: Health): BuyResult {
  const price = priceOf(id);
  if (price === undefined) return 'unknown';
  if (g.owned.includes(id)) return 'owned';
  if (w.money < price) return 'poor';
  w.money -= price;
  g.owned.push(id);
  g.selected = id;
  if (h) delete h.hp[id]; // damage taken before the purchase (as a level's forced vehicle) does not come with the car
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

/** Coins to bring a car back to full HP. */
export function repairCostFor(h: Health, id: string): number {
  return (MAX_HP - hpFor(h, id)) * COST_PER_HP;
}

export type RepairResult = 'repaired' | 'full' | 'poor';

/** Pays wallet coins to restore a car to full HP. Changes `h` and `w` only when it returns 'repaired'. */
export function repairCar(h: Health, w: Purse, id: string): RepairResult {
  const cost = repairCostFor(h, id);
  if (cost <= 0) return 'full';
  if (w.money < cost) return 'poor';
  w.money -= cost;
  h.hp[id] = MAX_HP;
  return 'repaired';
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
