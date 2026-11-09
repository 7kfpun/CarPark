/** Replay and ghost: the car's pose sampled during a run, kept small enough for localStorage. */

/** Samples per second. Playback interpolates between them. */
export const REPLAY_HZ = 20;
/** Never record more than this many samples (3 minutes). */
export const MAX_FRAMES = REPLAY_HZ * 180;
/** A ghost whose encoded form is longer than this is not stored. */
export const MAX_GHOST_CHARS = 30_000;
const FIELDS = 5;

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

/** Collects one pose every `every` physics steps. */
export class Recorder {
  readonly frames: Pose[] = [];
  private n = 0;
  constructor(private readonly every: number) {}

  /** Call once per physics step; the first call always records (t = 0). */
  step(pose: Pose): void {
    if (this.n++ % this.every === 0 && this.frames.length < MAX_FRAMES) this.frames.push({ ...pose });
  }
}

/** Length in seconds of a recording. */
export function duration(frames: Pose[]): number {
  return Math.max(0, frames.length - 1) / REPLAY_HZ;
}

function lerpAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/** Pose at time `t` seconds, interpolated; clamps to the first and last sample. */
export function poseAt(frames: Pose[], t: number): Pose | null {
  if (!frames.length) return null;
  const f = Math.min(Math.max(t, 0) * REPLAY_HZ, frames.length - 1);
  const i = Math.floor(f);
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const k = f - i;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    heading: lerpAngle(a.heading, b.heading, k),
    pitch: a.pitch + (b.pitch - a.pitch) * k,
  };
}

/** Delta-encoded integers (cm for position, mrad for angles): x, z, y, heading, pitch per sample. */
export function encodeFrames(frames: Pose[]): number[] {
  const out: number[] = [];
  let prev = [0, 0, 0, 0, 0];
  for (const f of frames) {
    const cur = [f.x * 100, f.z * 100, f.y * 100, f.heading * 1000, f.pitch * 1000].map(Math.round);
    for (let i = 0; i < FIELDS; i++) out.push(cur[i] - prev[i]);
    prev = cur;
  }
  return out;
}

/** Inverse of encodeFrames; null for anything malformed. */
export function decodeFrames(data: unknown): Pose[] | null {
  if (!Array.isArray(data) || data.length === 0 || data.length % FIELDS !== 0 || data.length > MAX_FRAMES * FIELDS)
    return null;
  const frames: Pose[] = [];
  const cur = [0, 0, 0, 0, 0];
  for (let i = 0; i < data.length; i += FIELDS) {
    for (let j = 0; j < FIELDS; j++) {
      const d = data[i + j];
      if (typeof d !== 'number' || !Number.isInteger(d)) return null;
      cur[j] += d;
    }
    frames.push({ x: cur[0] / 100, z: cur[1] / 100, y: cur[2] / 100, heading: cur[3] / 1000, pitch: cur[4] / 1000 });
  }
  return frames;
}

/** A stored best run for one level. */
export interface Ghost {
  time: number;
  data: number[];
}
export type Ghosts = Record<string, Ghost>;

/** True when a run of `time` seconds should replace `old` (none, or slower). */
export function beatsGhost(old: Ghost | undefined, time: number): boolean {
  return Number.isFinite(time) && time > 0 && (!old || time < old.time);
}

/** Whether a recording fits the storage cap once encoded. */
export function fitsCap(data: number[]): boolean {
  return data.length > 0 && JSON.stringify(data).length <= MAX_GHOST_CHARS;
}

/** Keep only well-formed ghosts for known levels. */
export function parseGhosts(raw: unknown, ids: string[]): Ghosts {
  const out: Ghosts = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const known = new Set(ids);
  for (const [id, g] of Object.entries(raw)) {
    if (!known.has(id) || !g || typeof g !== 'object') continue;
    const { time, data } = g as { time?: unknown; data?: unknown };
    if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) continue;
    if (!decodeFrames(data) || !fitsCap(data as number[])) continue;
    out[id] = { time, data: data as number[] };
  }
  return out;
}

const KEY = 'car-parking-3d:ghosts';

export function loadGhosts(ids: string[]): Ghosts {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseGhosts(JSON.parse(raw), ids) : {};
  } catch {
    return {};
  }
}

export function saveGhosts(g: Ghosts): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // storage unavailable or full: ghosts just won't persist
  }
}

/** Forget every stored ghost; call wherever saved progress is reset. */
export function clearGhosts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
