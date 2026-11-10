// Shared tuning constants (metres, seconds, radians).
export const CAR_W = 1.9;
export const CAR_L = 4.2;
export const WHEELBASE = 2.6;
export const WHEEL_R = 0.36;

// Car-park speeds: a gentle automatic, not a race car.
export const MAX_FWD = 3.5; // m/s (12.6 km/h)
export const MAX_REV = 2; // m/s (7.2 km/h)
export const ACCEL = 1.5; // m/s^2, light throttle
export const REV_ACCEL = 1.2;
export const BRAKE = 6; // m/s^2, firm braking (~0.6 g)
export const ROLL_DRAG = 1.2; // coasting slow-down
export const HANDBRAKE = 9;
export const MAX_STEER = 0.6; // rad at the front wheels
export const STEER_RATE = 1.2; // rad/s while turning the wheel (~0.5 s to full lock)
export const STEER_RETURN = 1.6; // rad/s self-centring when released

/** Approach speed (m/s) under which a contact is numerical resting noise, not a touch. */
export const TOUCH_MIN_SPEED = 0.02;
export const PARK_HOLD = 1.0;
/** Whether a park held for `hold` seconds is complete: the one check the game and the replay share. */
export const holdComplete = (hold: number): boolean => hold >= PARK_HOLD - 1e-9;
export const STOP_SPEED = 0.15;
export const ALIGN_TOL = (15 * Math.PI) / 180;

export const STEP = 1 / 120;

// Collision response.
export const RESTITUTION = 0.25; // bounce of the normal velocity on hard hits
export const RESTITUTION_MIN = 0.5; // m/s normal speed below which contacts don't bounce
export const RESTITUTION_FULL = 3; // m/s normal speed at which RESTITUTION fully applies
export const WALL_FRICTION = 0.3; // Coulomb friction coefficient of a new impact
export const SCRAPE_FRICTION = 0.05; // friction coefficient of a sustained scrape
export const COLLISION_YAW_TIME = 0.1; // s over which a contact impulse turns the car
export const MAX_COLLISION_YAW = 0.03; // rad, max heading change per resolveCollisions call
export const CONTACT_MEMORY = 6; // steps a contact stays "sustained" after separating

// Multi-storey.
// m/s^2 pulling the car down a slope. Arcade value: the hatchback must climb the steepest allowed ramp from rest at
// CLIMB_THROTTLE (0.6 * ACCEL / sin(RAMP_MAX_SLOPE) = 4.3 > 3). Slower vehicles climb less: see `maxClimbSlope`.
export const SLOPE_GRAVITY = 3;
export const CLIMB_THROTTLE = 0.6; // the throttle a touch-pedal player can be relied on to hold
export const RAMP_MAX_SLOPE = (12 * Math.PI) / 180; // rad, steepest ramp the 2D footprint approximation allows
