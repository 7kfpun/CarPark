/** What the Garage browser shows for each car. Pure: no DOM, no storage (rules live in src/garage.ts). */
import { repairCostFor, type Garage, type ShopCar } from './garage';
import { hpFor, MAX_HP, type Health } from './health';

export type CarStatus = 'selected' | 'owned' | 'locked';

export interface CarCard {
  id: string;
  status: CarStatus;
  /** Coins to buy; 0 once owned. */
  price: number;
  /** Current HP of an owned car; a car you do not own is always at full HP. */
  hp: number;
  wrecked: boolean;
  damaged: boolean;
  /** Coins to repair; 0 when undamaged or not owned. */
  repairCost: number;
  canBuy: boolean;
  canRepair: boolean;
  canSelect: boolean;
}

/** Index after stepping `dir` through `count` cars, wrapping at both ends. */
export function stepCar(count: number, index: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + dir) % count) + count) % count;
}

/** Where to start browsing: the car being driven, or the first car if it is not on sale. */
export function startIndex(shop: readonly ShopCar[], g: Garage): number {
  return Math.max(
    0,
    shop.findIndex((c) => c.id === g.selected),
  );
}

export function carCard(shop: readonly ShopCar[], g: Garage, h: Health, money: number, id: string): CarCard {
  const price = shop.find((c) => c.id === id)?.price ?? 0;
  const owned = g.owned.includes(id);
  const hp = owned ? hpFor(h, id) : MAX_HP;
  const repairCost = owned ? repairCostFor(h, id) : 0;
  return {
    id,
    status: g.selected === id ? 'selected' : owned ? 'owned' : 'locked',
    price: owned ? 0 : price,
    hp,
    wrecked: owned && hp === 0,
    damaged: owned && hp < MAX_HP,
    repairCost,
    canBuy: !owned && money >= price,
    canRepair: repairCost > 0 && money >= repairCost,
    canSelect: owned && g.selected !== id,
  };
}
