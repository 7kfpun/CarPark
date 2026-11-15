// Pure helpers for the crash view (CARP-141): which contact to report, where the camera goes and how far it
// zooms in, and the screen shift that keeps the contact clear of the bottom dialog. No three.js, no DOM.
import type { OBB } from './collision';

export interface Hit {
  x: number;
  z: number;
  /** Approach speed of the contact (m/s). */
  speed: number;
  /** The obstacle that was hit. */
  obstacle: OBB;
  /** The car's pose when it overlapped the obstacle (before any push-out). */
  car?: { x: number; z: number; heading: number };
}

/** Seconds the camera takes to zoom in to the crash. */
export const CRASH_ZOOM_TIME = 0.7;
/** Distance multiplier bounds of the crash zoom (1 = the view's own distance). */
export const CRASH_ZOOM_MIN = 0.3;
export const CRASH_ZOOM_MAX = 0.7;
/** Half the span (car plus obstacle) that fills the view at the view's own distance (metres). */
const REF_SPAN = 14;
/** Long walls and fences must not push the camera back out: cap the obstacle's contribution. */
const MAX_OBSTACLE_HALF = 1.5;

/** The harder of two contacts in one step: the later one wins only when strictly faster. */
export function pickHit(best: Hit | null, cand: Hit): Hit {
  return best === null || cand.speed > best.speed ? cand : best;
}

/** Where the camera looks: halfway between the car's centre and the contact, so both stay in frame. */
export function crashFocus(car: { x: number; z: number }, hit: Pick<Hit, 'x' | 'z'>): [number, number] {
  return [(car.x + hit.x) / 2, (car.z + hit.z) / 2];
}

/** Distance multiplier that makes the car and the obstacle it hit fill the view. */
export function crashZoom(carHalfLength: number, obstacle: OBB): number {
  const half = Math.min(MAX_OBSTACLE_HALF, Math.max(obstacle.hw, obstacle.hl));
  const z = (carHalfLength + half) / REF_SPAN;
  return Math.min(CRASH_ZOOM_MAX, Math.max(CRASH_ZOOM_MIN, z));
}

/** Eased 0..1 progress of the zoom-in. */
export function stepCrashZoom(k: number, dt: number): number {
  return Math.min(1, Math.max(0, k + dt / CRASH_ZOOM_TIME));
}

/** Smoothstep of the linear progress, so the zoom starts and ends gently. */
export function easeCrash(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
}

/** Pixels to slide the picture up so the middle of the free area above a bottom dialog is the view centre. */
export function viewShiftPx(panelHeight: number, viewHeight: number): number {
  return Math.round(Math.min(Math.max(0, panelHeight), viewHeight * 0.6) / 2);
}
