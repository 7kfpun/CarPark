import type { BayDef, FloorDef, LevelDef, ObstacleDef, RampDef } from './layout';

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

/** A parked car on a given floor of a multi-storey level. */
function carOn(floor: string, x: number, z: number, rot = 0): ObstacleDef {
  return { ...car(x, z, rot), floor };
}

const SPIRAL = {
  /** Ramp segments per turn: each one is straight, so the 2D collision of a layer stays simple. */
  perTurn: 8,
  turns: 3,
  /** Storey height (m). */
  rise: 3,
  /** Ramp width and length (m): the shortest length the car fits on. */
  w: 7,
  len: 7,
  /** Where the spiral ends: the middle of the top deck's entry landing. */
  exit: { x: 9.5, z: 4.2 },
};

/**
 * A left-hand spiral ramp of `perTurn * turns` straight segments, each turning
 * 360 / perTurn degrees to the left of the one before. Segments are joined by
 * square landings (a ramp starts at the middle of its landing and ends at the
 * edge of the next), so the centre line is a regular polygon. The last segment
 * heads straight along +z onto the top deck.
 */
function spiral(): { floors: FloorDef[]; ramps: RampDef[]; start: { x: number; z: number; rot: number } } {
  const { perTurn, turns, rise, w, len } = SPIRAL;
  const n = perTurn * turns;
  const side = len + w / 2; // distance between neighbouring landing centres
  const turn = (2 * PI) / perTurn;
  const rot = (i: number): number => (n - 1 - i) * turn; // heading of segment i; the last one is 0 (+z)
  // Landing centres, worked back from the exit.
  const c: { x: number; z: number }[] = [];
  c[n] = { ...SPIRAL.exit };
  for (let i = n - 1; i >= 0; i--) {
    c[i] = { x: c[i + 1].x - side * Math.sin(rot(i)), z: c[i + 1].z - side * Math.cos(rot(i)) };
  }
  const id = (i: number): string =>
    i === 0 ? 'ground' : i === n ? 'top' : i % perTurn === 0 ? `level-${i / perTurn}` : `p${i}`;
  const y = (i: number): number => (i / perTurn) * rise;
  const floors: FloorDef[] = [];
  const ramps: RampDef[] = [];
  const back = 20; // length of the approach road before the first ramp (m)
  const deck = 20; // length of the top deck (m)
  // The approach road is squared half way between the first ramp and the segment before it, so the car arrives
  // on the line a smooth circle through the landings would take.
  const lead = rot(0) + turn / 2;
  const [sl, cl] = [Math.sin(lead), Math.cos(lead)];
  for (let i = 0; i <= n; i++) {
    if (i === 0) {
      // The ground floor is an approach road ending just past the foot of the first ramp.
      const mid = (2.5 - back) / 2;
      floors.push({
        id: id(i),
        y: 0,
        area: [{ x: c[0].x + sl * mid, z: c[0].z + cl * mid, hw: 4, hl: (back + 2.5) / 2, rot: lead }],
      });
    } else if (i === n) {
      // The top deck starts where the last ramp ends and runs straight ahead (+z).
      floors.push({
        id: id(i),
        y: y(i),
        area: [{ x: c[i].x, z: c[i].z - w / 2 + deck / 2, hw: 8, hl: deck / 2, rot: 0 }],
      });
    } else {
      // A landing is squared to the segment that arrives at it.
      const area = { x: c[i].x, z: c[i].z, hw: w / 2, hl: w / 2, rot: rot(i - 1) };
      floors.push({ id: id(i), y: y(i), area: [area], landing: i % perTurn !== 0 });
    }
  }
  for (let i = 0; i < n; i++) {
    const [s, co] = [Math.sin(rot(i)), Math.cos(rot(i))];
    ramps.push({
      id: `r${i}`,
      from: id(i),
      to: id(i + 1),
      x: c[i].x + (s * len) / 2,
      z: c[i].z + (co * len) / 2,
      rot: rot(i),
      w,
      l: len,
    });
  }
  return {
    floors,
    ramps,
    start: { x: c[0].x - sl * (back - 4), z: c[0].z - cl * (back - 4), rot: Math.atan2(sl, cl) },
  };
}

const row7 = [-9, -6, -3, 0, 3, 6, 9];
const row8 = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5];
const row9 = [-12, -9, -6, -3, 0, 3, 6, 9, 12];

const SPIRAL_PARTS = spiral();
const EX = SPIRAL.exit;

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
  {
    id: 'up-one-floor',
    name: 'Up One Floor',
    hint: 'Drive up the ramp to level 1, then pull forwards into the glowing bay and stop.',
    lot: { w: 20, l: 66 },
    spawn: { x: 0, z: -28, rot: 0 },
    target: { x: 3, z: 26, rot: 0, w: 3, l: 5.6, floor: 'upper' },
    bothWays: false,
    time: 75,
    stars: { three: 36, two: 55 },
    floors: [
      { id: 'ground', y: 0, area: [{ x: 0, z: -18, hw: 10, hl: 15, rot: 0 }] },
      { id: 'upper', y: 3, area: [{ x: 0, z: 23, hw: 10, hl: 10, rot: 0 }] },
    ],
    ramps: [{ id: 'ramp', from: 'ground', to: 'upper', x: 0, z: 5, rot: 0, w: 5, l: 16 }],
    obstacles: [
      carOn('upper', -9, 26, 0),
      carOn('upper', -6, 26, PI),
      carOn('upper', -3, 26, 0),
      carOn('upper', 9, 26, PI),
      carOn('upper', -7.5, 17, PI / 2),
      carOn('upper', 8, 17, PI / 2),
    ],
  },
  {
    id: 'basement',
    name: 'Basement',
    hint: 'Down the ramp into the dark. Reverse into the bay between the two cars.',
    lot: { w: 20, l: 66 },
    spawn: { x: 0, z: -28, rot: 0 },
    target: { x: 1, z: 29, rot: PI, w: 3, l: 5.6, floor: 'basement' },
    bothWays: false,
    time: 105,
    stars: { three: 52, two: 80 },
    floors: [
      // The ground floor is the street, the ramp's sides and the roof of the basement.
      {
        id: 'ground',
        y: 0,
        area: [
          { x: 0, z: -18, hw: 10, hl: 15, rot: 0 },
          { x: -6.4, z: 5.5, hw: 3.6, hl: 8.5, rot: 0 },
          { x: 6.4, z: 5.5, hw: 3.6, hl: 8.5, rot: 0 },
          { x: 0, z: 23.5, hw: 10, hl: 9.5, rot: 0 },
        ],
      },
      { id: 'basement', y: -3, area: [{ x: 0, z: 23.5, hw: 10, hl: 9.5, rot: 0 }] },
    ],
    ramps: [{ id: 'ramp', from: 'ground', to: 'basement', x: 0, z: 5.5, rot: 0, w: 5, l: 17 }],
    obstacles: [
      carOn('basement', -8, 29, PI),
      carOn('basement', -5, 29, 0),
      carOn('basement', -2, 29, PI),
      carOn('basement', 4, 29, 0),
      carOn('basement', 7, 29, PI),
      { kind: 'pillar', x: -8.5, z: 18, h: 2.7, floor: 'basement' },
      { kind: 'pillar', x: 8.5, z: 18, h: 2.7, floor: 'basement' },
      { kind: 'pillar', x: -4, z: 22, h: 2.7, floor: 'basement' },
    ],
  },
  {
    id: 'spiral',
    name: 'Spiral',
    hint: 'Keep a steady curve all the way up the spiral. The free bay is on the top deck.',
    lot: { w: 44, l: 44 },
    spawn: SPIRAL_PARTS.start,
    target: { x: EX.x + 3.5, z: EX.z + 8, rot: 0, w: 3, l: 5.6, floor: 'top' },
    bothWays: false,
    time: 320,
    stars: { three: 160, two: 240 },
    floors: SPIRAL_PARTS.floors,
    ramps: SPIRAL_PARTS.ramps,
    obstacles: [
      carOn('top', EX.x - 7.5, EX.z + 8, 0),
      carOn('top', EX.x - 4.5, EX.z + 8, PI),
      carOn('top', EX.x - 7.5, EX.z + 13.3, PI),
      carOn('top', EX.x - 4.5, EX.z + 13.3, 0),
      carOn('top', EX.x - 1.5, EX.z + 13.3, PI),
      carOn('top', EX.x + 1.5, EX.z + 13.3, 0),
      carOn('top', EX.x + 4.5, EX.z + 13.3, PI),
    ],
  },
];
