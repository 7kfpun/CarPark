// Pure camera-view logic: which views exist, the cycle order, saved-value
// parsing, blending and the pose each view asks for. No three.js here, so
// scripts/validate.ts can test it. The camera never feeds back into physics.

/** The selectable views, in cycle order (C key / 🎥 button). Free look is not in the cycle: it is a drag-to-orbit mode while paused. */
export const CAM_MODES = ['chase', 'cockpit', 'hood', 'top', 'corner'] as const;
export type CamMode = (typeof CAM_MODES)[number];

export const DEFAULT_CAM: CamMode = 'chase';

export const CAM_LABELS: Record<CamMode, string> = {
  chase: 'Chase camera',
  cockpit: 'Cockpit camera',
  hood: 'Hood camera',
  top: 'Top-down camera',
  corner: 'Corner assist camera',
};

export function isCamMode(v: unknown): v is CamMode {
  return typeof v === 'string' && (CAM_MODES as readonly string[]).includes(v);
}

/** A saved or URL value to a view; anything unknown falls back (default: chase). */
export function parseCamMode(v: unknown, fallback: CamMode = DEFAULT_CAM): CamMode {
  return isCamMode(v) ? v : fallback;
}

/** The view after `mode` in the cycle (an unknown value restarts at chase). */
export function nextCamMode(mode: CamMode): CamMode {
  const i = CAM_MODES.indexOf(mode);
  return CAM_MODES[(i + 1) % CAM_MODES.length];
}

/** Seconds a switch between two views takes. */
export const BLEND_TIME = 0.3;

/** Blend progress 0..1 after `dt` more seconds; with reduced motion the switch is instant. */
export function advanceBlend(t: number, dt: number, reduced: boolean): number {
  if (reduced) return 1;
  return Math.min(1, Math.max(0, t) + dt / BLEND_TIME);
}

/** Ease-in-out for a blend progress value, clamped to 0..1. */
export function blendWeight(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Views that fix the camera to the car (no follow lag) and so place it by the car's own pose. */
export function isRigid(mode: CamMode): boolean {
  return mode === 'cockpit' || mode === 'hood';
}

/** Views from above the car, where decks over it are hidden so they never block the picture. */
export function hidesCeilings(mode: CamMode, freeLook = false): boolean {
  return mode === 'top' || mode === 'corner' || freeLook;
}

/** Cockpit view only: the body shell is hidden (the wheels stay) once the blend is mostly done. */
export function bodyHidden(mode: CamMode, blend: number): boolean {
  return mode === 'cockpit' && blend >= 0.5;
}

/** Reversing, with hysteresis so a brief stop does not flicker the rear view. */
export function reverseHold(prev: boolean, v: number): boolean {
  if (v < -0.3) return true;
  if (v > 0.3) return false;
  return prev;
}

/**
 * Parking-assist auto-switch: with the setting on, reversing in chase,
 * cockpit or hood view shows the corner (rear) view, until the car moves forward again.
 * Top-down and corner views are left alone.
 */
export function assistMode(base: CamMode, auto: boolean, reversing: boolean): CamMode {
  if (!auto || !reversing) return base;
  return base === 'chase' || base === 'cockpit' || base === 'hood' ? 'corner' : base;
}

export interface ViewTarget {
  x: number;
  y: number;
  z: number;
  /** Heading the view follows (the smoothed heading for follow views, the real one for rigid views). */
  heading: number;
  pitch: number;
  /** Front wheel angle, positive = right. */
  steer: number;
}

export interface Pose {
  px: number;
  py: number;
  pz: number;
  lx: number;
  ly: number;
  lz: number;
}

/** Driver's eye in car-local metres: x left, y up, z forward. */
export const EYE = { x: 0.36, y: 1.2, z: -0.1 } as const;
/** Hood camera, low on the bonnet. */
export const HOOD = { x: 0, y: 1.25, z: 1.15 } as const;

/** The camera pose a view asks for. `reversing` only matters for the corner view. */
export function viewPose(mode: CamMode, t: ViewTarget, reversing = false): Pose {
  const fx = Math.sin(t.heading);
  const fz = Math.cos(t.heading);
  // Car-local x points left, so the world direction of +x is (fz, -fx).
  const lx = fz;
  const lz = -fx;
  const at = (x: number, y: number, z: number): [number, number, number] => [
    t.x + lx * x + fx * z,
    t.y + y,
    t.z + lz * x + fz * z,
  ];
  switch (mode) {
    case 'chase':
      return pose(t.x - fx * 7.5, t.y + 3.8, t.z - fz * 7.5, t.x + fx * 1.5, t.y + 0.6, t.z + fz * 1.5);
    case 'top':
      return pose(t.x, t.y + 34, t.z - 10, t.x, t.y, t.z);
    case 'cockpit':
    case 'hood': {
      const o = mode === 'cockpit' ? EYE : HOOD;
      const [px, py, pz] = at(o.x, o.y, o.z);
      // Look slightly into the turn (positive steer = right = decreasing heading) and along the slope.
      const a = t.heading - t.steer * 0.35;
      const dist = 12;
      return pose(
        px,
        py,
        pz,
        px + Math.sin(a) * dist,
        py - (mode === 'hood' ? 2.2 : 0.3) + Math.tan(t.pitch) * dist,
        pz + Math.cos(a) * dist,
      );
    }
    case 'corner': {
      if (reversing) {
        // Rear camera: above the back bumper, looking back and down at the rear corners.
        const [px, py, pz] = at(0, 4.2, -2.4);
        const [qx, qy, qz] = at(0, 0, -6.5);
        return pose(px, py, pz, qx, qy, qz);
      }
      // Close top-down-ish view of the front corner on the side the wheel is turned towards.
      const side = t.steer === 0 ? 0 : t.steer > 0 ? -1 : 1; // local x: left is +
      const [qx, qy, qz] = at(side * 0.9, 0, 2.2);
      const [px, py, pz] = at(side * 0.9, 9, -1.2);
      return pose(px, py, pz, qx, qy, qz);
    }
  }
}

function pose(px: number, py: number, pz: number, lx: number, ly: number, lz: number): Pose {
  return { px, py, pz, lx, ly, lz };
}

export interface FreeLook {
  yaw: number;
  pitch: number;
  dist: number;
}

export const FREE_START: FreeLook = { yaw: Math.PI, pitch: 0.5, dist: 14 };

/** Drag (radians per pixel already applied by the caller) and zoom for the orbit, clamped to a sensible range. */
export function dragFreeLook(f: FreeLook, dyaw: number, dpitch: number, ddist = 0): FreeLook {
  return {
    yaw: f.yaw + dyaw,
    pitch: Math.min(1.45, Math.max(0.05, f.pitch + dpitch)),
    dist: Math.min(40, Math.max(4, f.dist + ddist)),
  };
}

export function freePose(f: FreeLook, t: { x: number; y: number; z: number }): Pose {
  const cp = Math.cos(f.pitch);
  return pose(
    t.x + Math.sin(f.yaw) * cp * f.dist,
    t.y + 0.8 + Math.sin(f.pitch) * f.dist,
    t.z + Math.cos(f.yaw) * cp * f.dist,
    t.x,
    t.y + 0.8,
    t.z,
  );
}

/** Extra vertical field of view (degrees) for a view: the hood camera is wide so the front wheels show. */
export function fovBoost(mode: CamMode): number {
  return mode === 'hood' ? 24 : 0;
}
