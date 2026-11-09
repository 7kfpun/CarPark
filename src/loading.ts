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
