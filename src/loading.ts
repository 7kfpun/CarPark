/** Text for the loading screen: a percentage once the total is known, else a plain message. */
export function loadingLabel(loaded: number, total: number): string {
  if (total <= 0) return 'Loading…';
  const pct = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
  return `Loading… ${pct}%`;
}

/** How long one car model may take before the box car is used instead. */
export const MODEL_TIMEOUT_MS = 8000;

/** Resolve with `p`, or reject after `ms` so a stalled load can't hang startup forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, what = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Run `fn` over `items` with at most `limit` in flight, so a slow link isn't split across every download at once. */
export async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/** Delay before retry number `attempt` (0-based): doubles each time, capped. */
export function backoffMs(attempt: number, baseMs = MODEL_RETRY_BASE_MS, maxMs = MODEL_RETRY_MAX_MS): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

/** Call `fn` until it succeeds, waiting `backoffMs` between tries; rejects with the last error after `attempts` tries. */
export async function retry<T>(fn: () => Promise<T>, attempts: number, baseMs = MODEL_RETRY_BASE_MS): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i + 1 >= attempts) throw err;
      await new Promise((r) => setTimeout(r, backoffMs(i, baseMs)));
    }
  }
}

/** Models downloaded at once. */
export const MODEL_CONCURRENCY = 2;
/** Tries per model in the first pass, and the retry delay (doubling, capped). */
export const MODEL_ATTEMPTS = 3;
export const MODEL_RETRY_BASE_MS = 1000;
export const MODEL_RETRY_MAX_MS = 30000;
/** Extra background rounds for models still missing after the first pass. */
export const MODEL_BACKGROUND_ROUNDS = 6;
