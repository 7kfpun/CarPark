import { corners, pointInOBB, wrapAngle, type OBB } from './collision';
import { ALIGN_TOL, STOP_SPEED } from './config';
import { bayOBB, type BayDef } from './layout';

export interface ParkEval {
  inside: boolean;
  aligned: boolean;
  stopped: boolean;
  ok: boolean;
}

export function evaluateParking(car: OBB, speed: number, bay: BayDef, bothWays: boolean): ParkEval {
  const box = bayOBB(bay);
  const inside = corners(car).every(([x, z]) => pointInOBB(x, z, box));
  const d = Math.abs(wrapAngle(car.rot - bay.rot));
  const aligned = d <= ALIGN_TOL || (bothWays && Math.PI - d <= ALIGN_TOL);
  const stopped = Math.abs(speed) < STOP_SPEED;
  return { inside, aligned, stopped, ok: inside && aligned && stopped };
}
