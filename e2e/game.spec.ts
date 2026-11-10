import { expect, test, type Browser, type Page } from '@playwright/test';
import { LEVELS } from '../src/levels';
import { LOCATIONS, worldLevels } from '../src/worlds';
import { collectErrors, driveSolution, openGame, run } from './helpers';

const PROGRESS_KEY = 'car-parking-3d:progress';
const FIRST = LEVELS[0].id;

const savedProgress = (page: Page) => page.evaluate((k) => localStorage.getItem(k), PROGRESS_KEY);
const timer = (page: Page) => page.locator('#hud-timer').innerText();

test('menu loads with every level and no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await expect(page.locator('#menu')).toBeVisible();
  // The menu lists the worlds; only the first is open on a fresh save.
  await expect(page.locator('#level-grid .world-btn')).toHaveCount(LOCATIONS.length);
  await expect(page.locator('#level-grid .world-btn:not([disabled])')).toHaveCount(1);
  await page.locator('#level-grid .world-btn').first().click();
  const first = worldLevels(LEVELS, LOCATIONS[0]);
  await expect(page.locator('#level-grid .level-btn')).toHaveCount(first.length);
  for (const [i, lvl] of first.entries()) {
    await expect(page.locator('#level-grid .level-btn').nth(i)).toContainText(lvl.name);
  }
  // Only the first level is open on a fresh save.
  await expect(page.locator('#level-grid .level-btn:not([disabled])')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('level 1: the recorded solution parks and shows the win modal with stars', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.locator('#level-grid .world-btn').first().click();
  await page.locator('#level-grid .level-btn').first().click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud-level')).toContainText(`1. ${LEVELS[0].name}`);
  await driveSolution(page, FIRST);
  await run(page, 1);
  await expect(page.locator('#modal-title')).toHaveText('Parked!');
  await expect(page.locator('#modal-stars')).toHaveAttribute('aria-label', '3 of 3 stars');
  expect(errors).toEqual([]);
});

test('any collision fails the level', async ({ page }) => {
  await openGame(page, '?level=1');
  await expect(page.locator('#hud')).toBeVisible();
  // Floor it with no steering: the car runs through the bay and into the far wall.
  await page.keyboard.down('ArrowUp');
  for (let t = 0; t < 20 && (await page.locator('#modal-title').innerText()) === ''; t++) await run(page, 1);
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#modal-title')).toHaveText('Level failed');
  await expect(page.locator('#modal-body')).toHaveText('You hit something. Ease off near cars, walls and cones.');
});

test('Escape pauses and resumes; the game does not run under Settings', async ({ page }) => {
  await openGame(page, '?level=1');
  await expect(page.locator('#hud')).toBeVisible();
  await run(page, 1.5);
  const t0 = await timer(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-title')).toHaveText('Paused');
  await run(page, 1.5);
  expect(await timer(page)).toBe(t0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeHidden();
  await run(page, 1.5);
  expect(await timer(page)).not.toBe(t0);

  // Settings opened from play freezes the game until it is closed.
  await page.locator('#btn-settings').click();
  await expect(page.locator('#settings')).toBeVisible();
  const t1 = await timer(page);
  await run(page, 1.5);
  expect(await timer(page)).toBe(t1);

  await page.locator('#settings-done').click();
  await expect(page.locator('#settings')).toBeHidden();
  await run(page, 1.5);
  expect(await timer(page)).not.toBe(t1);
});

test('Settings tabs: arrow keys, Home and End move between tabs', async ({ page }) => {
  await openGame(page);
  await page.locator('#btn-settings-menu').click();
  await expect(page.locator('#settings')).toBeVisible();
  const selected = page.locator('[data-tab][aria-selected="true"]');
  await expect(selected).toHaveAttribute('data-tab', 'sound');
  await page.locator('[data-tab="sound"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveAttribute('data-tab', 'display');
  await expect(page.locator('[data-tab="display"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(selected).toHaveAttribute('data-tab', 'controls');
  await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveAttribute('data-tab', 'sound');
  await page.keyboard.press('ArrowLeft');
  await expect(selected).toHaveAttribute('data-tab', 'controls');
  await page.keyboard.press('Home');
  await expect(selected).toHaveAttribute('data-tab', 'sound');
});

for (const [name, viewport] of [
  ['portrait 390x844', { width: 390, height: 844 }],
  ['landscape 844x390', { width: 844, height: 390 }],
] as const) {
  test(`touch layout, ${name}: wheel and pedals visible, no horizontal scroll`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openGame(page, '?level=1');
    for (const id of ['#t-wheel', '#t-accel', '#t-brake', '#t-gear']) {
      await expect(page.locator(id)).toBeVisible();
      const box = (await page.locator(id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
}

test('admin mode shows the skip buttons, and skipping or winning writes no saved progress', async ({ page }) => {
  await openGame(page, '?admin=1');
  await expect(page.locator('#admin-badge')).toBeVisible();
  // Every level is open in admin mode.
  await expect(page.locator('#level-grid .world-btn:not([disabled])')).toHaveCount(LOCATIONS.length);
  await page.locator('#level-grid .world-btn').first().click();
  await expect(page.locator('#level-grid .level-btn:not([disabled])')).toHaveCount(
    worldLevels(LEVELS, LOCATIONS[0]).length,
  );
  await page.locator('#level-grid .level-btn').first().click();
  await expect(page.locator('#admin-prev')).toBeVisible();
  await expect(page.locator('#admin-next')).toBeVisible();

  await driveSolution(page, FIRST);
  await run(page, 1);
  await expect(page.locator('#modal-title')).toHaveText('Parked!');
  expect(await savedProgress(page)).toBeNull();

  await page.locator('#modal-buttons button', { hasText: 'Retry' }).click();
  await page.locator('#admin-next').click();
  await expect(page.locator('#hud-level')).toContainText(`2. ${LEVELS[1].name}`);
  expect(await savedProgress(page)).toBeNull();
});

test('saved progress survives a reload', async ({ page }) => {
  await openGame(page);
  await page.locator('#level-grid .world-btn').first().click();
  await page.locator('#level-grid .level-btn').first().click();
  await driveSolution(page, FIRST);
  await run(page, 1);
  await expect(page.locator('#modal-title')).toHaveText('Parked!');
  expect(await savedProgress(page)).not.toBeNull();

  await page.reload();
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#level-grid .world-btn').first().click();
  const buttons = page.locator('#level-grid .level-btn');
  await expect(buttons.first()).toHaveAttribute('aria-label', /3 of 3 stars/);
  await expect(buttons.nth(1)).toBeEnabled();
});

test('touch wheel and pedal hold through a pointercancel, then release after the grace period', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openGame(page, '?level=1');
  const rotation = () =>
    page.evaluate(() => document.querySelector<HTMLElement>('#t-wheel .wheel-rot')!.style.transform);
  const fire = (sel: string, type: string, x: number, y: number) =>
    page.evaluate(
      ([s, t, cx, cy]) => {
        const el = document.querySelector(s as string)!;
        el.dispatchEvent(
          new PointerEvent(t as string, {
            pointerId: 7,
            pointerType: 'touch',
            clientX: cx as number,
            clientY: cy as number,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [sel, type, x, y],
    );
  const box = (await page.locator('#t-wheel').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await fire('#t-wheel', 'pointerdown', cx, cy - 60);
  await fire('#t-wheel', 'pointermove', cx + 60, cy);
  const turned = await rotation();
  expect(turned).not.toBe('rotate(0deg)');
  // The finger leaves the screen edge: the browser cancels the touch. The wheel must not snap back.
  await fire('#t-wheel', 'pointercancel', cx + 60, cy);
  await page.clock.runFor(100);
  expect(await rotation()).toBe(turned);
  await expect(page.locator('#t-wheel')).toHaveClass(/active/);
  // No re-claim within the grace period: it lets go.
  await page.clock.runFor(400);
  expect(await rotation()).toBe('rotate(0deg)');

  // Pedals hold the same way.
  const pb = (await page.locator('#t-accel').boundingBox())!;
  await fire('#t-accel', 'pointerdown', pb.x + 10, pb.y + 10);
  await fire('#t-accel', 'pointercancel', pb.x + 10, pb.y + 10);
  await page.clock.runFor(100);
  await expect(page.locator('#t-accel')).toHaveClass(/active/);
  await page.clock.runFor(400);
  await expect(page.locator('#t-accel')).not.toHaveClass(/active/);
  await context.close();
});

test('gear lever: tap a slot or use arrows to change gear, and a cancelled drag does not flip it', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openGame(page, '?level=1');
  const gear = page.locator('#t-gear');
  await expect(gear).toHaveAttribute('aria-valuetext', 'Drive');
  const box = (await gear.boundingBox())!;
  const fire = (type: string, y: number) =>
    page.evaluate(
      ([t, cy, cx]) =>
        document.querySelector('#t-gear')!.dispatchEvent(
          new PointerEvent(t as string, {
            pointerId: 9,
            pointerType: 'touch',
            clientX: cx as number,
            clientY: cy as number,
            bubbles: true,
            cancelable: true,
          }),
        ),
      [type, y, box.x + box.width / 2],
    );
  // Drag to the bottom, then the browser cancels: still Drive.
  await fire('pointerdown', box.y + 20);
  await fire('pointermove', box.y + box.height - 10);
  await fire('pointercancel', box.y + box.height - 10);
  await expect(gear).toHaveAttribute('aria-valuetext', 'Drive');
  // Tap the bottom slot: Reverse.
  await fire('pointerdown', box.y + box.height - 10);
  await fire('pointerup', box.y + box.height - 10);
  await expect(gear).toHaveAttribute('aria-valuetext', 'Reverse');
  await expect(gear).toHaveClass(/reverse/);
  // Keyboard: arrow up selects Drive.
  await gear.focus();
  await page.keyboard.press('ArrowUp');
  await expect(gear).toHaveAttribute('aria-valuetext', 'Drive');
  await context.close();
});

test('camera: a drag orbits, Reset view and V restore it, and a drag that starts on the wheel steers instead', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openGame(page, '?level=1');
  const reset = page.locator('#btn-reset-view');
  await expect(reset).toHaveAttribute('aria-label', 'Reset view');
  await expect(reset).not.toHaveClass(/off-centre/);
  const fire = (sel: string, type: string, id: number, x: number, y: number) =>
    page.evaluate(
      ([s, t, pid, cx, cy]) => {
        const el = document.querySelector(s as string)!;
        el.dispatchEvent(
          new PointerEvent(t as string, {
            pointerId: pid as number,
            pointerType: 'touch',
            clientX: cx as number,
            clientY: cy as number,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [sel, type, id, x, y],
    );
  // A drag that starts on the wheel steers the car and leaves the camera alone.
  const wb = (await page.locator('#t-wheel').boundingBox())!;
  const wx = wb.x + wb.width / 2;
  const wy = wb.y + wb.height / 2;
  await fire('#t-wheel', 'pointerdown', 3, wx, wy - 60);
  await fire('#t-wheel', 'pointermove', 3, wx + 60, wy);
  await page.clock.runFor(100);
  expect(
    await page.evaluate(() => document.querySelector<HTMLElement>('#t-wheel .wheel-rot')!.style.transform),
  ).not.toBe('rotate(0deg)');
  await expect(reset).not.toHaveClass(/off-centre/);
  await fire('#t-wheel', 'pointerup', 3, wx + 60, wy);

  // A drag on the empty game area orbits; the other thumb can keep steering meanwhile.
  await fire('#game', 'pointerdown', 4, 420, 120);
  await fire('#game', 'pointermove', 4, 520, 150);
  await fire('#game', 'pointerup', 4, 520, 150);
  await page.clock.runFor(100);
  await expect(reset).toHaveClass(/off-centre/);

  // A cancelled touch leaves the view where it is.
  await fire('#game', 'pointerdown', 5, 420, 120);
  await fire('#game', 'pointercancel', 5, 420, 120);
  await page.clock.runFor(100);
  await expect(reset).toHaveClass(/off-centre/);

  await page.evaluate(() => document.getElementById('btn-reset-view')!.click());
  await page.clock.runFor(600);
  await expect(reset).not.toHaveClass(/off-centre/);

  // V resets too.
  await fire('#game', 'pointerdown', 6, 420, 120);
  await fire('#game', 'pointermove', 6, 380, 100);
  await fire('#game', 'pointerup', 6, 380, 100);
  await page.clock.runFor(100);
  await expect(reset).toHaveClass(/off-centre/);
  await page.keyboard.press('KeyV');
  await page.clock.runFor(600);
  await expect(reset).not.toHaveClass(/off-centre/);
  await context.close();
});

// FOX-240 quality pass: HUD clarity on the smallest phones, and robustness to resize and missing storage.
const HUD_PARTS = [
  '#hud-level',
  '#hud-timer',
  '#hud-floor',
  '#hud-hint',
  '#btn-reset-view',
  '#btn-cam',
  '#btn-pause',
  '#btn-settings',
  '#hud-gear',
  '#t-wheel',
];

for (const [name, viewport] of [
  ['portrait 360x640', { width: 360, height: 640 }],
  ['landscape 844x390', { width: 844, height: 390 }],
] as const) {
  for (const textSize of ['normal', 'large', 'xlarge'] as const) {
    test(`HUD, ${name}, ${textSize} text: no HUD element overlaps another or leaves the screen`, async ({
      browser,
    }) => {
      await hudOverlapCheck(browser, viewport, textSize);
    });
  }
}

async function hudOverlapCheck(
  browser: Browser,
  viewport: { width: number; height: number },
  textSize: 'normal' | 'large' | 'xlarge',
): Promise<void> {
  {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.addInitScript((size) => {
      localStorage.setItem(
        'car-parking-3d:settings:v1',
        JSON.stringify({ sound: false, quality: 'low', camera: 'chase', mirror: false, wheel: 'left', textSize: size }),
      );
    }, textSize);
    await openGame(page, '?level=1');
    await expect(page.locator('#hud')).toBeVisible();
    await run(page, 0.5);
    const boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const id of HUD_PARTS) {
      const el = page.locator(id);
      if (!(await el.isVisible())) continue;
      const b = (await el.boundingBox())!;
      expect(b.x, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(viewport.width);
      expect(b.y + b.height, `${id} bottom`).toBeLessThanOrEqual(viewport.height);
      boxes.push({ id, x: b.x, y: b.y, w: b.width, h: b.height });
    }
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    expect(errors).toEqual([]);
    await context.close();
  }
}

test('resizing and rotating mid-level keeps the game running with no errors', async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, '?level=1');
  await run(page, 1);
  const t0 = await timer(page);
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await run(page, 0.5);
    const box = (await page.locator('#game').boundingBox())!;
    expect(Math.round(box.width)).toBe(size.width);
    expect(Math.round(box.height)).toBe(size.height);
  }
  await expect(page.locator('#hud')).toBeVisible();
  expect(await timer(page)).not.toBe(t0);
  expect(errors).toEqual([]);
});

test('the game plays with localStorage unavailable and logs no errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { get: fail });
  });
  await page.clock.install({ time: 0 });
  await page.goto('/?level=1');
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('#hud')).toBeVisible();
  expect(errors).toEqual([]);
});

test('hiding the tab pauses the level', async ({ page }) => {
  await openGame(page, '?level=1');
  await run(page, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#modal-title')).toHaveText('Paused');
});
