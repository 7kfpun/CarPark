import { reloadUrl } from './update';

/** Without a restored context after this long, the graphics-reset overlay offers Reload. */
export const LOST_STALL_MS = 5000;
/** If a reload has not replaced the page after this long, it failed: try the next, plainer way. */
export const RELOAD_RETRY_MS = 3000;
/** After a navigation was issued without throwing, give it this long to commit before trying again. */
export const RELOAD_SETTLE_MS = 10000;
export const MAX_RELOAD_ATTEMPTS = 3;

/** The bits of `location` and timers that Reload needs, so the retry ladder is testable without a browser. */
export interface ReloadEnv {
  href: string;
  replace(url: string): void;
  reload(): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout?(id: unknown): void;
  /** Register a callback for when the page is being left (pagehide). */
  onPageHide?(fn: () => void): void;
}

/**
 * Reload that always recovers. Attempt 1 navigates to a cache-busted URL; if the page is still alive
 * afterwards (navigation blocked, offline error swallowed, a hung unload) it tries a plain reload,
 * then the cache-busted URL again. Each step is guarded so a throwing `location` call falls through.
 */
export function recover(env: ReloadEnv, attempt = 1, prevThrew = false): void {
  let threw = false;
  try {
    // A plain reload() would cancel a slow-but-live replace(), so it is only the fallback for a throwing replace.
    if (attempt === 2 && prevThrew) env.reload();
    else env.replace(reloadUrl(env.href, env.now() + attempt));
  } catch (err) {
    threw = true;
    console.error('Reload attempt failed', err);
  }
  if (attempt >= MAX_RELOAD_ATTEMPTS) return;
  // If the navigation worked, this page is gone and the timer never fires. A navigation that was issued
  // fine gets a long time to commit; one that threw is retried quickly.
  const id = env.setTimeout(() => recover(env, attempt + 1, threw), threw ? RELOAD_RETRY_MS : RELOAD_SETTLE_MS);
  env.onPageHide?.(() => env.clearTimeout?.(id));
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
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    onPageHide: (fn) => addEventListener('pagehide', fn, { once: true }),
  });
}
