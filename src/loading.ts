/** Text for the loading screen: a percentage once the total is known, else a plain message. */
export function loadingLabel(loaded: number, total: number): string {
  if (total <= 0) return 'Loading…';
  const pct = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
  return `Loading… ${pct}%`;
}
