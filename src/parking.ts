import { corners, pointInOBB, wrapAngle, type OBB } from './collision';
import { ALIGN_TOL, STOP_SPEED } from './config';
import { bayOBB, DEFAULT_FLOOR, type BayDef } from './layout';

export interface ParkEval {
  inside: boolean;
  aligned: boolean;
  stopped: boolean;
  /** The car is on the bay's floor. */
  onFloor: boolean;
  ok: boolean;
}

export function evaluateParking(
  car: OBB,
  speed: number,
  bay: BayDef,
  bothWays: boolean,
  layer = DEFAULT_FLOOR,
): ParkEval {
  const box = bayOBB(bay);
  const inside = corners(car).every(([x, z]) => pointInOBB(x, z, box));
  const d = Math.abs(wrapAngle(car.rot - bay.rot));
  const aligned = d <= ALIGN_TOL || (bothWays && Math.PI - d <= ALIGN_TOL);
  const stopped = Math.abs(speed) < STOP_SPEED;
  const onFloor = layer === (bay.floor ?? DEFAULT_FLOOR);
  return { inside, aligned, stopped, onFloor, ok: inside && aligned && stopped && onFloor };
}
