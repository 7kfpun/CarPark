/** Index to focus next when cycling through `count` focusable items; `dir` is +1 or -1, `current` is -1 if none is focused. */
export function nextFocusIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return dir > 0 ? 0 : count - 1;
  return (current + dir + count) % count;
}
