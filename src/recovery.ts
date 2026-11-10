import { reloadUrl } from './update';

/** Without a restored context after this long, the graphics-reset overlay offers Reload. */
export const LOST_STALL_MS = 5000;
/** If a reload has not replaced the page after this long, it failed: try the next, plainer way. */
export const RELOAD_RETRY_MS = 3000;
export const MAX_RELOAD_ATTEMPTS = 3;

/** The bits of `location` and timers that Reload needs, so the retry ladder is testable without a browser. */
export interface ReloadEnv {
  href: string;
  replace(url: string): void;
  reload(): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

/**
 * Reload that always recovers. Attempt 1 navigates to a cache-busted URL; if the page is still alive
 * afterwards (navigation blocked, offline error swallowed, a hung unload) it tries a plain reload,
 * then the cache-busted URL again. Each step is guarded so a throwing `location` call falls through.
 */
export function recover(env: ReloadEnv, attempt = 1): void {
  try {
    if (attempt === 2) env.reload();
    else env.replace(reloadUrl(env.href, env.now() + attempt));
  } catch (err) {
    console.error('Reload attempt failed', err);
  }
  // If the navigation worked, this page is gone and the timer never fires.
  if (attempt < MAX_RELOAD_ATTEMPTS) env.setTimeout(() => recover(env, attempt + 1), RELOAD_RETRY_MS);
}

/** Reload using the real page. */
export function recoverNow(): void {
  recover({
    get href() {
      return location.href;
    },
    replace: (u) => location.replace(u),
    reload: () => location.reload(),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  });
}
