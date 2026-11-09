import { expect, type Page } from '@playwright/test';
import { SOLUTIONS } from '../src/levels.solutions';

/** Console errors and uncaught page errors seen so far. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Open the game with a fake clock, so the car can be driven for exact simulated seconds
 * (headless software rendering is far slower than real time). Time stands still until `run()`.
 */
export async function openGame(page: Page, query = ''): Promise<void> {
  // Low graphics and no rear mirror keep software-rendered frames cheap (set once per browser context).
  await page.addInitScript(() => {
    const key = 'car-parking-3d:settings:v1';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(
        key,
        JSON.stringify({ sound: false, quality: 'low', camera: 'chase', mirror: false, wheel: 'left' }),
      );
    }
  });
  await page.clock.install({ time: 0 });
  await page.goto(`/${query}`);
  // Loading is network-bound, not timer-bound: the menu or the HUD appears on its own.
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 30_000 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
}

/** Advance the game by `seconds` of simulated time (one frame per 1/60 s). */
export async function run(page: Page, seconds: number): Promise<void> {
  await page.clock.runFor(Math.round(seconds * 1000));
}

/** Replay a level's recorded solution (src/levels.solutions.ts) through the keyboard. */
export async function driveSolution(page: Page, levelId: string): Promise<void> {
  const keys = { throttle: 'ArrowUp', brake: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', handbrake: 'Space' };
  const down = new Set<string>();
  const set = async (key: string, on: boolean) => {
    if (on === down.has(key)) return;
    if (on) down.add(key);
    else down.delete(key);
    await (on ? page.keyboard.down(key) : page.keyboard.up(key));
  };
  for (const seg of SOLUTIONS[levelId]) {
    await set(keys.throttle, seg.throttle > 0);
    await set(keys.brake, seg.throttle < 0);
    await set(keys.left, seg.steer < 0);
    await set(keys.right, seg.steer > 0);
    await set(keys.handbrake, !!seg.handbrake);
    await run(page, seg.t);
  }
  for (const k of [...down]) await set(k, false);
}
