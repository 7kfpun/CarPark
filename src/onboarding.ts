/** The first-run tip: shown once, on the very first level a player ever starts. */
export const FIRST_RUN_TIP = 'Drive in, stop in the glow, then hold still.';
export const FIRST_RUN_TIP_SECONDS = 6;

const KEY = 'car-parking-3d:tip-seen:v1';

/** True until the tip has been shown once. Storage unavailable: show it (it is short and harmless). */
export function shouldShowTip(): boolean {
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return true;
  }
}

export function markTipSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage unavailable: the tip may show again next visit
  }
}
