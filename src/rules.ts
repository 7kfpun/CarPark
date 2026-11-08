import type { StarTimes } from './layout';

/** 3 stars at or under `three` seconds, 2 at or under `two`, otherwise 1 (the level was completed). */
export function starsForTime(elapsed: number, t: StarTimes): number {
  return elapsed <= t.three ? 3 : elapsed <= t.two ? 2 : 1;
}

/** The time to beat for the next star, or null when already at 3 stars. */
export function nextStarTime(stars: number, t: StarTimes): number | null {
  return stars >= 3 ? null : stars === 2 ? t.three : t.two;
}

/** Whether a contact's approach speed (m/s) is a real touch rather than resting numerical noise. */
export function isTouch(impact: number, minSpeed: number): boolean {
  return impact > minSpeed;
}
