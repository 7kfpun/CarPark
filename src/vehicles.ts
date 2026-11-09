import { ACCEL, CAR_L, CAR_W, MAX_FWD, MAX_REV, MAX_STEER, REV_ACCEL, STEER_RATE, WHEELBASE } from './config';

/** How a vehicle is drawn: a loaded CC0 model, or a simple coloured body built in code. */
export type VehicleShape = 'model' | 'minibus' | 'bus' | 'truck';

/** Everything that makes one vehicle drive, collide, park and look different (metres, seconds, radians). */
export interface VehicleDef {
  /** Permanent id (kebab-case): levels refer to it. */
  id: string;
  name: string;
  shape: VehicleShape;
  /** Car Kit model file (without .glb); only for shape 'model'. */
  model?: string;
  /** Body colour of a coded vehicle. */
  color: number;
  /** Collision box. */
  length: number;
  width: number;
  /** Rear axle to front axle: the car pivots about the rear axle. */
  wheelbase: number;
  /** Steering lock at the front wheels. */
  maxSteer: number;
  /** How fast the wheel turns towards full lock (rad/s): a bus winds slower. */
  steerRate: number;
  accel: number;
  revAccel: number;
  maxFwd: number;
  maxRev: number;
  /** Chase camera: metres behind the car and above the ground. */
  camDistance: number;
  camHeight: number;
  /** Rear-view mirror eye point: metres behind the centre and above the ground. */
  eyeBack: number;
  eyeHeight: number;
}

export const DEFAULT_VEHICLE = 'hatchback';

export const VEHICLES: VehicleDef[] = [
  {
    id: 'hatchback',
    name: 'Hatchback',
    shape: 'model',
    model: 'sedan-sports',
    color: 0xffb81c,
    length: CAR_L,
    width: CAR_W,
    wheelbase: WHEELBASE,
    maxSteer: MAX_STEER,
    steerRate: STEER_RATE,
    accel: ACCEL,
    revAccel: REV_ACCEL,
    maxFwd: MAX_FWD,
    maxRev: MAX_REV,
    camDistance: 7.5,
    camHeight: 3.8,
    eyeBack: 0.7,
    eyeHeight: 1.75,
  },
  {
    id: 'sedan',
    name: 'Sedan',
    shape: 'model',
    model: 'sedan',
    color: 0x2f6fde,
    length: 4.7,
    width: 1.85,
    wheelbase: 2.8,
    maxSteer: 0.58,
    steerRate: 1.2,
    accel: 1.5,
    revAccel: 1.2,
    maxFwd: 3.6,
    maxRev: 2,
    camDistance: 8,
    camHeight: 3.9,
    eyeBack: 0.8,
    eyeHeight: 1.75,
  },
  {
    id: 'suv',
    name: 'SUV',
    shape: 'model',
    model: 'suv',
    color: 0x2e8b57,
    length: 4.7,
    width: 2,
    wheelbase: 2.9,
    maxSteer: 0.55,
    steerRate: 1.1,
    accel: 1.4,
    revAccel: 1.1,
    maxFwd: 3.5,
    maxRev: 2,
    camDistance: 8.2,
    camHeight: 4.3,
    eyeBack: 0.8,
    eyeHeight: 2.05,
  },
  {
    id: 'van',
    name: 'Van',
    shape: 'model',
    model: 'van',
    color: 0xe8e8e8,
    length: 5.3,
    width: 2,
    wheelbase: 3.3,
    maxSteer: 0.55,
    steerRate: 1,
    accel: 1.2,
    revAccel: 1,
    maxFwd: 3.3,
    maxRev: 1.9,
    camDistance: 9,
    camHeight: 4.6,
    eyeBack: 1,
    eyeHeight: 2.2,
  },
  {
    id: 'minibus',
    name: 'Minibus',
    shape: 'minibus',
    color: 0xf2f2f2,
    length: 6.4,
    width: 2.1,
    wheelbase: 3.9,
    maxSteer: 0.52,
    steerRate: 0.9,
    accel: 1.1,
    revAccel: 0.9,
    maxFwd: 3.2,
    maxRev: 1.8,
    camDistance: 10,
    camHeight: 5,
    eyeBack: 1.6,
    eyeHeight: 2.5,
  },
  {
    id: 'bus',
    name: 'City Bus',
    shape: 'bus',
    color: 0xd7372f,
    length: 10.5,
    width: 2.55,
    wheelbase: 5.9,
    maxSteer: 0.5,
    steerRate: 0.7,
    accel: 0.8,
    revAccel: 0.7,
    maxFwd: 3,
    maxRev: 1.6,
    camDistance: 13.5,
    camHeight: 6.5,
    eyeBack: 3.6,
    eyeHeight: 3.3,
  },
  {
    id: 'box-truck',
    name: 'Box Truck',
    shape: 'truck',
    color: 0x2f6fde,
    length: 7.6,
    width: 2.4,
    wheelbase: 4.5,
    maxSteer: 0.5,
    steerRate: 0.8,
    accel: 0.9,
    revAccel: 0.8,
    maxFwd: 3.1,
    maxRev: 1.7,
    camDistance: 11,
    camHeight: 5.6,
    eyeBack: 2.4,
    eyeHeight: 3.2,
  },
];

const BY_ID = new Map(VEHICLES.map((v) => [v.id, v]));

/** The vehicle with this id (the hatchback when omitted). Throws on an unknown id. */
export function vehicleOf(id: string = DEFAULT_VEHICLE): VehicleDef {
  const v = BY_ID.get(id);
  if (!v) throw new Error(`unknown vehicle "${id}"`);
  return v;
}

/** Smallest circle (m) the rear axle can follow at full lock. */
export function minTurnRadius(v: VehicleDef): number {
  return v.wheelbase / Math.tan(v.maxSteer);
}
