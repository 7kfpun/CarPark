import type { BayDef, LevelDef, ObstacleDef } from './layout';

const PI = Math.PI;
const COLORS = [0x2f6fde, 0xe8e8e8, 0x8a8f98, 0xc8322b, 0x2e8b57, 0x222428, 0x7a4fd0, 0x1fa3b5];

let colorIdx = 0;
function car(x: number, z: number, rot = 0): ObstacleDef {
  const variant = colorIdx++;
  return { kind: 'car', x, z, rot, color: COLORS[variant % COLORS.length], variant };
}

/** A row of bays along x at the given z. rot = closed-end direction. */
function bayRow(xs: number[], z: number, rot: number, w = 3, l = 5.6): BayDef[] {
  return xs.map((x) => ({ x, z, rot, w, l }));
}

/** Parked cars in every x slot except the ones listed in `skip`. */
function carRow(xs: number[], z: number, skip: number[], rots: number[] = [0, PI]): ObstacleDef[] {
  return xs.filter((x) => !skip.includes(x)).map((x, i) => car(x, z, rots[i % rots.length]));
}

/** A line of cones across x from x0 to x1 with a gap. */
function coneLine(x0: number, x1: number, z: number, gapX: number, gapW: number, spacing = 1.2): ObstacleDef[] {
  const out: ObstacleDef[] = [];
  for (let x = x0; x <= x1 + 1e-6; x += spacing) {
    if (Math.abs(x - gapX) < gapW / 2) continue;
    out.push({ kind: 'cone', x, z });
  }
  return out;
}

const row7 = [-9, -6, -3, 0, 3, 6, 9];
const row8 = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5];
const row9 = [-12, -9, -6, -3, 0, 3, 6, 9, 12];

export const LEVELS: LevelDef[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    hint: 'Drive into the glowing bay and stop. Either direction is fine.',
    lot: { w: 30, l: 40 },
    spawn: { x: 0, z: -12, rot: 0 },
    target: { x: 0, z: 12, rot: 0, w: 3, l: 5.6 },
    bothWays: true,
    time: 60,
    stars: { three: 20, two: 32 },
    bays: bayRow(row7, 12, 0),
    obstacles: [car(-3, 12, 0), car(3, 12, PI), car(-9, 12, PI), car(6, 12, 0)],
  },
  {
    id: 'back-it-in',
    name: 'Back It In',
    hint: 'Reverse into the bay so the arrow and your nose point the same way.',
    lot: { w: 32, l: 40 },
    spawn: { x: -12, z: -4, rot: PI / 2 },
    target: { x: 4.5, z: 13, rot: PI, w: 3, l: 5.6 },
    bothWays: false,
    time: 75,
    stars: { three: 35, two: 52 },
    bays: [...bayRow(row8, 13, 0), ...bayRow(row8, -13, PI)],
    obstacles: [...carRow(row8, 13, [4.5, -7.5]), ...carRow(row8, -13, [-4.5, 7.5])],
  },
  {
    id: 'parallel-pro',
    name: 'Parallel Pro',
    hint: 'Slip into the gap by the curb. Reverse in at an angle, then straighten up.',
    lot: { w: 24, l: 50 },
    spawn: { x: 2, z: -18, rot: 0 },
    target: { x: 8.1, z: -0.6, rot: 0, w: 2.4, l: 6.4 },
    bothWays: true,
    time: 90,
    stars: { three: 40, two: 62 },
    obstacles: [
      { kind: 'wall', x: 9.6, z: 0, w: 0.4, l: 46, h: 0.25 },
      car(8.1, -17, 0),
      car(8.1, -11.5, 0),
      car(8.1, -6, 0),
      car(8.1, 4.8, 0),
      car(8.1, 10.3, 0),
      car(8.1, 15.8, 0),
      car(-8.1, -14, PI),
      car(-8.1, -3, PI),
      car(-8.1, 8, PI),
      { kind: 'cone', x: -3, z: 14 },
      { kind: 'cone', x: 0, z: 18 },
    ],
  },
  {
    id: 'cone-gates',
    name: 'Cone Gates',
    hint: 'Thread through the gaps in the cones, then park at the far end.',
    lot: { w: 30, l: 70 },
    spawn: { x: 0, z: -30, rot: 0 },
    target: { x: 3, z: 28, rot: 0, w: 3, l: 5.6 },
    bothWays: true,
    time: 90,
    stars: { three: 45, two: 66 },
    bays: bayRow([-6, -3, 0, 3, 6], 28, 0),
    obstacles: [
      ...coneLine(-14.4, 14.4, -18, -6, 4.5),
      ...coneLine(-14.4, 14.4, -6, 6, 4.5),
      ...coneLine(-14.4, 14.4, 6, -4, 4.5),
      car(0, 28, 0),
      car(6, 28, PI),
      car(-3, 28, 0),
      { kind: 'cone', x: 1.5, z: 24.4 },
      { kind: 'cone', x: 4.5, z: 24.4 },
    ],
  },
  {
    id: 'the-garage',
    name: 'The Garage',
    hint: 'A tight garage with pillars in the way. Go slow.',
    lot: { w: 30, l: 40 },
    spawn: { x: -10, z: -14, rot: 0 },
    target: { x: 0, z: 14.1, rot: 0, w: 2.8, l: 5.4 },
    bothWays: true,
    time: 75,
    stars: { three: 35, two: 52 },
    obstacles: [
      { kind: 'wall', x: -1.65, z: 14, w: 0.3, l: 6, h: 2.4 },
      { kind: 'wall', x: 1.65, z: 14, w: 0.3, l: 6, h: 2.4 },
      { kind: 'wall', x: 0, z: 17.15, w: 3.6, l: 0.3, h: 2.4 },
      { kind: 'pillar', x: -4, z: 6 },
      { kind: 'pillar', x: 4, z: 6 },
      { kind: 'pillar', x: -4, z: -2 },
      { kind: 'pillar', x: 4, z: -2 },
      car(-5, 13, 0),
      car(5, 13, PI),
      car(-11, 13, 0),
      car(11, 13, 0),
    ],
  },
  {
    id: 'rush-hour',
    name: 'Rush Hour',
    hint: 'Find your way through the lot, then reverse into the last free bay.',
    lot: { w: 34, l: 44 },
    spawn: { x: -12, z: -15, rot: PI / 2 },
    target: { x: -3, z: 18, rot: PI, w: 2.8, l: 5.6 },
    bothWays: false,
    time: 120,
    stars: { three: 60, two: 88 },
    bays: bayRow(row9, 18, 0, 2.8),
    obstacles: [
      { kind: 'wall', x: -5, z: -6, w: 24, l: 0.4, h: 1.2 },
      { kind: 'wall', x: 5, z: 6, w: 24, l: 0.4, h: 1.2 },
      { kind: 'pillar', x: 2, z: -1.5 },
      { kind: 'pillar', x: -3, z: 1.5 },
      { kind: 'cone', x: 12, z: -10 },
      { kind: 'cone', x: -12, z: 2 },
      ...carRow(row9, 18, [-3]),
      car(-8, -12, PI / 2),
      car(4, -18, -PI / 2),
    ],
  },
];
