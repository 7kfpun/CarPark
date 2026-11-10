import { obstacleOBB, type LevelDef } from './layout';
import { sat } from './collision';

/** Largest yaw (rad) a parked car may be off its row's heading: about 4 degrees reads as casual, not crooked. */
export const MAX_PARK_YAW = (4 * Math.PI) / 180;

/** Problems with how a street's parked cars look: empty when the row reads as natural and stays solid. */
export function streetProblems(def: LevelDef): string[] {
  const out: string[] = [];
  const cars = def.obstacles.filter((o) => o.kind === 'car');
  const models = new Set(cars.map((c) => c.body));
  if (models.size < 4) out.push(`only ${models.size} body types in the street (want 4+)`);
  const colours = new Set(cars.map((c) => c.color));
  if (colours.size < 6) out.push(`only ${colours.size} car colours in the street (want 6+)`);
  cars.forEach((c, i) => {
    const heading = Math.round((c.rot ?? 0) / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs((c.rot ?? 0) - heading) > MAX_PARK_YAW + 1e-9) out.push(`car #${i} is more than 4° off its row`);
    cars.slice(i + 1).forEach((d, j) => {
      if (sat(obstacleOBB(c), obstacleOBB(d))) out.push(`cars #${i} and #${i + 1 + j} overlap`);
    });
  });
  // Spacing along each row must not be uniform.
  for (const z of new Set(cars.map((c) => c.z))) {
    const xs = cars
      .filter((c) => c.z === z)
      .map((c) => c.x)
      .sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    if (gaps.length > 2 && Math.max(...gaps) - Math.min(...gaps) < 0.5) out.push(`row z=${z} is evenly spaced`);
  }
  return out;
}
