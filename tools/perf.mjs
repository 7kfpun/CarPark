// Measures time to an interactive menu and frames dropped while a level starts, with the CPU throttled 4x.
// Usage: npm run build && npx vite preview --port 4173 & node tools/perf.mjs [url] [runs]
// Numbers come from software-rendered headless Chromium: compare before/after on the same machine, not absolutely.
/* global process */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4173/';
const runs = Number(process.argv[3] ?? 3);
const THROTTLE = 4;
const WINDOW_MS = 3000;
const FRAME_MS = 1000 / 60;

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function once(browser) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(url, { waitUntil: 'commit' });
  await page.locator('#menu:not(.hidden)').waitFor({ timeout: 120_000 });
  const menuMs = await page.evaluate(() => performance.now());

  await page.locator('#level-grid .world-btn').first().click();
  await page.evaluate((windowMs) => {
    const w = window;
    w.__frames = [];
    let prev = performance.now();
    const tick = (t) => {
      w.__frames.push(t - prev);
      prev = t;
      if (t - w.__t0 < windowMs) requestAnimationFrame(tick);
    };
    w.__t0 = performance.now();
    requestAnimationFrame(tick);
  }, WINDOW_MS);
  await page.locator('#level-grid .level-btn').first().click();
  await page.locator('#hud').waitFor();
  await page.waitForTimeout(WINDOW_MS + 500);
  const frames = await page.evaluate(() => window.__frames);
  await ctx.close();
  const dropped = frames.reduce((n, d) => n + Math.max(0, Math.round(d / FRAME_MS) - 1), 0);
  return { menuMs, dropped, frames: frames.length, worstMs: Math.max(...frames) };
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
for (let i = 0; i < runs; i++) results.push(await once(browser));
await browser.close();
console.log(`CPU throttle ${THROTTLE}x, ${runs} runs, ${WINDOW_MS} ms window after clicking the first level`);
console.table(
  results.map((r) => ({
    'menu ms': Math.round(r.menuMs),
    dropped: r.dropped,
    frames: r.frames,
    'worst frame ms': Math.round(r.worstMs),
  })),
);
console.log(
  `median menu ${Math.round(median(results.map((r) => r.menuMs)))} ms, median dropped ${median(results.map((r) => r.dropped))}`,
);
