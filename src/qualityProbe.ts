import type { Quality } from './graphics';

/** The probe starts this long after a level starts (the first frames pay for shader compiles), then samples for PROBE_S. */
export const PROBE_WARMUP_S = 0.5;
export const PROBE_S = 1;
/** Average frame time at or under this is comfortably High; over SLOW_MS it is Low; in between the heuristic stands. */
export const FAST_MS = 20;
export const SLOW_MS = 25;
/** A frame longer than this is a hitch (tab switch, GC), not load. */
export const HITCH_MS = 250;
/** Fewer frames than this in the window is too little to judge. */
export const MIN_PROBE_FRAMES = 10;

/** Quality from the average frame time of a probe window, or `fallback` when it is inconclusive or empty. */
export function probeQuality(avgMs: number, frames: number, fallback: Quality): Quality {
  if (frames < MIN_PROBE_FRAMES || !(avgMs > 0)) return fallback;
  if (avgMs <= FAST_MS) return 'high';
  if (avgMs > SLOW_MS) return 'low';
  return fallback;
}

const KEY = 'car-parking-3d:auto-quality:v1';

/** The remembered result of an earlier probe (or slow-frame downgrade), or null on first run. */
export function loadDetected(): Quality | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'low' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

export function saveDetected(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // storage unavailable: the probe just runs again next visit
  }
}
