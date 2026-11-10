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
/** A saved Low expires after this long: a 30 fps cap (iOS Low Power Mode) looks like a slow device, and must not stick forever. */
export const LOW_TTL_MS = 24 * 60 * 60 * 1000;

/** Parse a stored value: `high`, or `low:<savedAtMs>`. A Low without a timestamp (older builds) or past its TTL is dropped so Auto probes again. */
export function parseDetected(raw: string | null, now: number): Quality | null {
  if (raw === 'high') return 'high';
  if (!raw?.startsWith('low:')) return null;
  const at = Number(raw.slice(4));
  return Number.isFinite(at) && now - at >= 0 && now - at < LOW_TTL_MS ? 'low' : null;
}

/** The remembered result of an earlier probe (or slow-frame downgrade), or null on first run or when a saved Low has expired. */
export function loadDetected(now = Date.now()): Quality | null {
  try {
    return parseDetected(localStorage.getItem(KEY), now);
  } catch {
    return null;
  }
}

export function saveDetected(q: Quality, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, q === 'low' ? `low:${now}` : q);
  } catch {
    // storage unavailable: the probe just runs again next visit
  }
}
