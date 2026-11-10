// Pure drag-to-orbit state for the driving cameras (FOX-241): a yaw / pitch / zoom
// offset applied on top of whatever pose a view asks for, its clamps per view, and the
// ease back to the centre view. No three.js and no DOM, so scripts/validate.ts can test
// it. The offset only moves the camera: it never feeds back into physics or star times.
import type { CamMode, Pose } from './views';

export interface Orbit {
  /** Radians the camera is turned around the car (looking out of the car in cockpit/hood views). */
  yaw: number;
  /** Radians the camera is tilted up (+) or down (-) from the view's own angle. */
  pitch: number;
  /** Distance multiplier; 1 is the view's own distance. */
  zoom: number;
}

export const ORBIT_CENTRE: Readonly<Orbit> = { yaw: 0, pitch: 0, zoom: 1 };

/** Seconds the ease back to the centre view takes. */
export const RESET_TIME = 0.3;
/** Taps closer together than this (ms) count as a double tap. */
export const DOUBLE_TAP_MS = 320;

/** Cockpit and hood: a head turn, not an orbit. */
export function isHeadTurn(mode: CamMode): boolean {
  return mode === 'cockpit' || mode === 'hood';
}

const HEAD_YAW = (100 * Math.PI) / 180;
const HEAD_PITCH = (35 * Math.PI) / 180;
const ORBIT_PITCH_MIN = -0.7;
const ORBIT_PITCH_MAX = 0.9;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
/** The orbiting camera keeps its elevation above the car's pivot between these (radians). */
const ELEV_MIN = 0.1;
const ELEV_MAX = 1.5;
/** Camera never lower than this above the car's floor (metres). */
const MIN_HEIGHT = 0.4;

export function orbitCentre(): Orbit {
  return { ...ORBIT_CENTRE };
}

/** An offset forced into the allowed range of `mode`. */
export function clampOrbit(o: Orbit, mode: CamMode): Orbit {
  if (isHeadTurn(mode)) {
    return {
      yaw: Math.min(HEAD_YAW, Math.max(-HEAD_YAW, o.yaw)),
      pitch: Math.min(HEAD_PITCH, Math.max(-HEAD_PITCH, o.pitch)),
      zoom: 1,
    };
  }
  // A full turn is the same view: keep yaw within one turn either way.
  const yaw = Math.atan2(Math.sin(o.yaw), Math.cos(o.yaw));
  return {
    yaw,
    pitch: Math.min(ORBIT_PITCH_MAX, Math.max(ORBIT_PITCH_MIN, o.pitch)),
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.zoom)),
  };
}

/** Apply a drag (radians) and a zoom factor (>1 = further away), clamped for the view. */
export function dragOrbit(o: Orbit, mode: CamMode, dyaw: number, dpitch: number, zoomFactor = 1): Orbit {
  return clampOrbit({ yaw: o.yaw + dyaw, pitch: o.pitch + dpitch, zoom: o.zoom * zoomFactor }, mode);
}

/** True when the view is off its centre (drives the Reset view button's highlight). */
export function isOffCentre(o: Orbit): boolean {
  return Math.abs(o.yaw) > 1e-3 || Math.abs(o.pitch) > 1e-3 || Math.abs(o.zoom - 1) > 1e-3;
}

/** A reset in progress: where it started and how far along it is (0..1). */
export interface ResetAnim {
  from: Orbit;
  t: number;
}

export function startReset(from: Orbit): ResetAnim {
  return { from: { ...from }, t: 0 };
}

/**
 * Advance a reset by `dt` seconds. Returns the offset to show; it is exactly the centre
 * once finished (`done`), and at once with reduced motion.
 */
export function stepReset(a: ResetAnim, dt: number, reduced: boolean): { orbit: Orbit; done: boolean } {
  a.t = reduced ? 1 : Math.min(1, a.t + dt / RESET_TIME);
  if (a.t >= 1) return { orbit: orbitCentre(), done: true };
  const w = a.t * a.t * (3 - 2 * a.t);
  const k = 1 - w;
  return {
    orbit: {
      yaw: a.from.yaw * k,
      pitch: a.from.pitch * k,
      zoom: 1 + (a.from.zoom - 1) * k,
    },
    done: false,
  };
}

/** Pinch: the zoom factor for fingers that moved from `before` to `now` pixels apart (spreading zooms in). */
export function pinchFactor(before: number, now: number): number {
  if (before < 1 || now < 1) return 1;
  return before / now;
}

/** Wheel: the zoom factor for a wheel delta (positive = scroll down = further away). */
export function wheelFactor(deltaY: number): number {
  return Math.exp(Math.max(-300, Math.min(300, deltaY)) * 0.0015);
}

/** A second tap counts as a double tap when it is quick and lands close to the first. */
export function isDoubleTap(dtMs: number, distPx: number): boolean {
  return dtMs > 0 && dtMs <= DOUBLE_TAP_MS && distPx <= 30;
}

/** Extra pixels around the on-screen wheel and pedals where a touch still counts as aimed at them (CARP-134). */
export const CONTROL_GUARD_PX = 28;

export interface ZoneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** True when (x, y) is inside any of `rects` grown by `margin` px: a mis-touch near a control, not a camera drag. */
export function inControlZone(x: number, y: number, rects: readonly ZoneRect[], margin = CONTROL_GUARD_PX): boolean {
  return rects.some(
    (r) => x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin,
  );
}

/**
 * The pose with the offset applied. Cockpit and hood turn the head (the eye stays put);
 * the other views swing around the car's pivot at `t`, tilt, and zoom, never dropping
 * under the floor. A centred offset returns `p` itself.
 */
export function applyOrbit(p: Pose, o: Orbit, mode: CamMode, t: { x: number; y: number; z: number }): Pose {
  if (!isOffCentre(o)) return p;
  const c = clampOrbit(o, mode);
  if (isHeadTurn(mode)) {
    const dx = p.lx - p.px;
    const dy = p.ly - p.py;
    const dz = p.lz - p.pz;
    const h = Math.hypot(dx, dz);
    const len = Math.hypot(h, dy);
    const a = Math.atan2(dx, dz) + c.yaw;
    const e = Math.atan2(dy, h) + c.pitch;
    return {
      ...p,
      lx: p.px + Math.sin(a) * Math.cos(e) * len,
      ly: p.py + Math.sin(e) * len,
      lz: p.pz + Math.cos(a) * Math.cos(e) * len,
    };
  }
  const pivotY = t.y + 0.8;
  const vx = p.px - t.x;
  const vy = p.py - pivotY;
  const vz = p.pz - t.z;
  const h = Math.hypot(vx, vz);
  const r = Math.hypot(h, vy) * c.zoom;
  const a = Math.atan2(vx, vz) + c.yaw;
  let e = Math.min(ELEV_MAX, Math.max(ELEV_MIN, Math.atan2(vy, h) + c.pitch));
  // Never below the floor: raise the tilt until the camera clears it.
  const minSin = (t.y + MIN_HEIGHT - pivotY) / r;
  if (Math.sin(e) < minSin) e = Math.asin(Math.min(1, minSin));
  return {
    ...p,
    px: t.x + Math.sin(a) * Math.cos(e) * r,
    py: pivotY + Math.sin(e) * r,
    pz: t.z + Math.cos(a) * Math.cos(e) * r,
  };
}
