import { LOCATIONS } from './worlds';
import type { ArrowDef, BayDef, FloorDef, LevelDef, LocationId, ObstacleDef, RampDef, StreetBody } from './layout';
import { streetDims } from './streetCars';

/** A level as written below: its location is filled in from `LOCATION_OF`. */
type RawLevel = Omit<LevelDef, 'location'>;

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
  turns: 2,
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

const ANG = (50 * PI) / 180;

/** Bays slanted at `rot` (the heading a car must face), spaced along x at the given centres. */
function angledRow(xs: number[], z: number, rot: number): BayDef[] {
  return xs.map((x) => ({ x, z, rot, w: 3, l: 5.6 }));
}

const row7 = [-9, -6, -3, 0, 3, 6, 9];
const row8 = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5];
const row9 = [-12, -9, -6, -3, 0, 3, 6, 9, 12];

const SPIRAL_PARTS = spiral();
const EX = SPIRAL.exit;

const LEVELS_1_12: RawLevel[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    hint: 'Drive into the glowing bay and stop. Either direction is fine.',
    lot: { w: 30, l: 40 },
    spawn: { x: 0, z: -12, rot: 0 },
    target: { x: 0, z: 12, rot: 0, w: 3, l: 5.6 },
    bothWays: true,
    time: 60,
    stars: { three: 18, two: 28 },
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
    stars: { three: 23, two: 32 },
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
    stars: { three: 22, two: 30 },
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
    stars: { three: 36, two: 49 },
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
    stars: { three: 18, two: 25 },
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
    stars: { three: 46, two: 63 },
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
    stars: { three: 29, two: 40 },
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
      carOn('upper', 7.5, 17, PI / 2),
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
    stars: { three: 41, two: 57 },
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
    time: 200,
    stars: { three: 95, two: 128 },
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
  {
    id: 'angle-of-attack',
    name: 'Angle of Attack',
    hint: 'The bays are slanted. Swing wide, then turn in and line up with the arrow.',
    lot: { w: 30, l: 40 },
    spawn: { x: -9, z: -14, rot: 0 },
    target: { x: 0, z: 12, rot: ANG, w: 3, l: 5.6 },
    bothWays: false,
    time: 60,
    stars: { three: 21, two: 32 },
    bays: angledRow([-9.6, -4.8, 0, 4.8, 9.6], 12, ANG),
    obstacles: [-9.6, -4.8, 4.8, 9.6].map((x) => car(x, 12, ANG)),
  },
  {
    id: 'curb-side',
    name: 'Curb Side',
    hint: 'A long space between two cars. Reverse in at an angle, then straighten up.',
    lot: { w: 40, l: 26 },
    spawn: { x: -16, z: 2, rot: PI / 2 },
    target: { x: 0, z: -7.2, rot: PI / 2, w: 2.5, l: 6.8 },
    bothWays: true,
    time: 60,
    stars: { three: 16, two: 25 },
    obstacles: [
      { kind: 'wall', x: 0, z: -9.6, w: 38, l: 0.4, h: 0.25 },
      car(-5.7, -7.2, PI / 2),
      car(5.7, -7.2, PI / 2),
      car(-13, -7.2, PI / 2),
      car(13, -7.2, PI / 2),
      car(-12, 8, -PI / 2),
      car(-2, 8, -PI / 2),
      car(8, 8, -PI / 2),
    ],
  },
];

/** Mirrored level id -> id of the level it flips (filled by `mirrored`; the validator checks the pair agrees). */
export const MIRROR_OF: Record<string, string> = {};

/** The level with its layout flipped left to right (x to -x, headings mirrored), under a new identity. */
function mirrored(base: string, extra: Pick<LevelDef, 'id' | 'name' | 'hint'> & Partial<RawLevel>): RawLevel {
  const b = LEVELS_1_12.find((l) => l.id === base)!;
  MIRROR_OF[extra.id] = base;
  const flip = <T extends { x: number; rot?: number }>(o: T): T => ({
    ...o,
    x: o.x === 0 ? 0 : -o.x,
    ...(o.rot === undefined ? {} : { rot: -o.rot }),
  });
  return {
    ...b,
    spawn: flip(b.spawn),
    target: flip(b.target),
    obstacles: b.obstacles.map(flip),
    ...(b.bays && { bays: b.bays.map(flip) }),
    ...extra,
  };
}

/** One-way arrows along a line of travel, from (x0, z0) to (x1, z1) every `step` metres, pointing along `rot`. */
function arrowLine(x0: number, z0: number, x1: number, z1: number, rot: number, step = 6): ArrowDef[] {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / n,
    z: z0 + ((z1 - z0) * i) / n,
    rot,
  }));
}

/** Levels for the larger vehicles (src/vehicles.ts): each one is laid out for the size and turning circle of its own vehicle. */
const VEHICLE_LEVELS: RawLevel[] = [
  {
    id: 'van-garage',
    name: 'Van Garage',
    vehicle: 'van',
    hint: 'A van is longer and wider than a car. Reverse into the garage bay with barely half a metre to spare each side.',
    lot: { w: 28, l: 40 },
    spawn: { x: -9, z: -12, rot: PI / 2 },
    target: { x: 0, z: 13, rot: PI, w: 3.4, l: 6.4 },
    bothWays: false,
    time: 120,
    stars: { three: 40, two: 52 },
    bays: bayRow([-10.2, -6.8, -3.4, 0, 3.4, 6.8, 10.2], 13, 0, 3.4, 6.4),
    obstacles: [
      car(-3.4, 13, 0),
      car(3.4, 13, PI),
      car(-6.8, 13, PI),
      car(6.8, 13, 0),
      car(-10.2, 13, 0),
      car(10.2, 13, PI),
      car(-4, -2, PI),
      car(4, -2, 0),
      car(0, -2, PI),
    ],
  },
  {
    id: 'bus-bay',
    name: 'Bus Bay',
    vehicle: 'bus',
    hint: 'A city bus swings wide and turns slowly. Pull in alongside the platform between the two parked buses.',
    lot: { w: 30, l: 60 },
    spawn: { x: 2, z: -24, rot: 0 },
    target: { x: 8, z: 0, rot: 0, w: 4.2, l: 12.4 },
    bothWays: false,
    time: 130,
    stars: { three: 42, two: 54 },
    obstacles: [
      { kind: 'wall', x: 10.3, z: 0, w: 0.5, l: 58, h: 0.3 },
      { kind: 'wall', x: 8, z: -14.25, w: 2.55, l: 10.5, h: 3 },
      { kind: 'wall', x: 8, z: 13.25, w: 2.55, l: 10.5, h: 3 },
    ],
  },
  {
    id: 'loading-dock',
    name: 'Loading Dock',
    vehicle: 'box-truck',
    hint: 'Back the box truck square into the dock. Line up early: the cargo box swings wide.',
    lot: { w: 30, l: 40 },
    spawn: { x: -9, z: -14, rot: PI / 2 },
    target: { x: 0, z: 15.8, rot: PI, w: 3.4, l: 8.4 },
    bothWays: false,
    time: 160,
    stars: { three: 56, two: 72 },
    obstacles: [
      { kind: 'wall', x: -1.95, z: 15.8, w: 0.3, l: 8.4, h: 2.6 },
      { kind: 'wall', x: 1.95, z: 15.8, w: 0.3, l: 8.4, h: 2.6 },
      { kind: 'wall', x: -9, z: 15.8, w: 8, l: 8.4, h: 2.6 },
      { kind: 'wall', x: 9, z: 15.8, w: 8, l: 8.4, h: 2.6 },
      { kind: 'cone', x: -4.5, z: 6 },
      { kind: 'cone', x: 4.5, z: 6 },
    ],
  },
  {
    id: 'minibus-parallel',
    name: 'Minibus Parallel',
    vehicle: 'minibus',
    hint: 'Parallel park the minibus at the curb. The gap is only a metre longer than the bus.',
    lot: { w: 24, l: 50 },
    spawn: { x: 2, z: -18, rot: 0 },
    target: { x: 8.1, z: 0, rot: 0, w: 3, l: 8.2 },
    bothWays: true,
    time: 120,
    stars: { three: 36, two: 48 },
    obstacles: [
      { kind: 'wall', x: 9.8, z: 0, w: 0.4, l: 46, h: 0.25 },
      car(8.1, -6.6, 0),
      car(8.1, -12, 0),
      car(8.1, -17.5, 0),
      car(8.1, 6.6, 0),
      car(8.1, 12, 0),
      car(8.1, 17.5, 0),
      car(-8.1, -14, PI),
      car(-8.1, -3, PI),
      car(-8.1, 8, PI),
    ],
  },
];

/** A thin wall along the segment from (x0, z0) to (x1, z1). */
function wallSeg(x0: number, z0: number, x1: number, z1: number, h = 1.2, w = 0.4): ObstacleDef {
  const dx = x1 - x0;
  const dz = z1 - z0;
  return { kind: 'wall', x: (x0 + x1) / 2, z: (z0 + z1) / 2, rot: Math.atan2(dx, dz), w, l: Math.hypot(dx, dz), h };
}

/** Both kerbs of a lane along a polyline, `half` metres either side of its centre line. Corners overlap so they stay closed. */
function laneWalls(path: [number, number][], half: number, h = 1.2): ObstacleDef[] {
  const out: ObstacleDef[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [x0, z0] = path[i];
    const [x1, z1] = path[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const [dx, dz] = [(x1 - x0) / len, (z1 - z0) / len];
    const e0 = i > 0 ? 1 : 0;
    const e1 = i + 2 < path.length ? 1 : 0;
    for (const side of [-1, 1]) {
      const [ox, oz] = [dz * half * side, -dx * half * side];
      out.push(wallSeg(x0 + ox - dx * e0, z0 + oz - dz * e0, x1 + ox + dx * e1, z1 + oz + dz * e1, h));
    }
  }
  return out;
}

const CHEVRON = PI - (50 * PI) / 180;
const CHEVRON_XS = [-10.8, -7.2, -3.6, 0, 3.6, 7.2, 10.8];

const PROVING_LEVELS: RawLevel[] = [
  {
    id: 'drive-through',
    name: 'Drive-Through',
    hint: 'Follow the kerbed lane and stop in the bay before the barrier. Keep clear of both kerbs.',
    lot: { w: 24, l: 50 },
    spawn: { x: 0, z: -20, rot: 0 },
    target: { x: 0, z: 14, rot: 0, w: 3, l: 5.6 },
    bothWays: false,
    time: 55,
    stars: { three: 19, two: 26 },
    obstacles: [
      wallSeg(-2.4, -12, -2.4, 19, 0.6),
      wallSeg(2.4, -12, 2.4, 19, 0.6),
      { kind: 'wall', x: 0, z: 18.8, w: 4.8, l: 0.4, h: 0.9 },
    ],
  },
  {
    id: 'chevron-bays',
    name: 'Chevron Bays',
    hint: 'The bays are slanted. Drive past the free one, then reverse in at the same angle.',
    lot: { w: 38, l: 30 },
    spawn: { x: -16, z: 3, rot: PI / 2 },
    target: { x: 0, z: 10.4, rot: CHEVRON, w: 3, l: 5.6 },
    bothWays: false,
    time: 70,
    stars: { three: 25, two: 34 },
    bays: angledRow(CHEVRON_XS, 10.4, CHEVRON),
    obstacles: [
      ...CHEVRON_XS.filter((x) => x !== 0).map((x) => car(x, 10.4, CHEVRON)),
      car(-6, -2, PI / 2),
      car(0, -2, PI / 2),
      car(6, -2, PI / 2),
      car(12, -2, PI / 2),
    ],
  },
  {
    id: 'dead-end-turn',
    name: 'Dead-End Turn',
    vehicle: 'suv',
    hint: 'The alley is too narrow for a U-turn. Back out of the dead end, then swing nose-first into the side bay.',
    lot: { w: 30, l: 44 },
    spawn: { x: 0, z: 10, rot: 0 },
    target: { x: 7.6, z: -11, rot: PI / 2, w: 3.4, l: 5.6 },
    bothWays: false,
    time: 90,
    stars: { three: 32, two: 44 },
    obstacles: [
      { kind: 'wall', x: -4.8, z: -3.5, w: 0.4, l: 37, h: 1.2 },
      { kind: 'wall', x: 4.8, z: -18.6, w: 0.4, l: 6.8, h: 1.2 },
      { kind: 'wall', x: 4.8, z: 4.1, w: 0.4, l: 21.8, h: 1.2 },
      { kind: 'wall', x: 0, z: 15.2, w: 10, l: 0.4, h: 1.2 },
      { kind: 'wall', x: 10.8, z: -11, w: 0.4, l: 8.4, h: 1.2 },
      car(7.6, -13.9, PI / 2),
      car(7.6, -8.1, PI / 2),
    ],
  },
  {
    id: 's-bend-reverse',
    name: 'S-Bend Reverse',
    vehicle: 'sedan',
    hint: 'Back the sedan all the way down the winding lane into the bay at the far end. Small steering, patience.',
    lot: { w: 30, l: 46 },
    spawn: { x: 6, z: 18, rot: 0 },
    target: { x: -6, z: -17, rot: 0, w: 3.2, l: 5.6 },
    bothWays: false,
    time: 100,
    stars: { three: 35, two: 48 },
    obstacles: [
      ...laneWalls(
        [
          [-6, -20.4],
          [-6, -8],
          [6, 6],
          [6, 20.4],
        ],
        2.6,
      ),
      { kind: 'wall', x: -6, z: -20.8, w: 5.6, l: 0.4, h: 1.2 },
      { kind: 'wall', x: 6, z: 20.8, w: 5.6, l: 0.4, h: 1.2 },
    ],
  },
  {
    id: 'double-parallel',
    name: 'Double Parallel',
    vehicle: 'suv',
    hint: 'Two lorries, a kerb and a row of cars across the road. Parallel park the SUV in the gap between the lorries.',
    lot: { w: 24, l: 50 },
    spawn: { x: 3, z: -20, rot: 0 },
    target: { x: 8.2, z: 0, rot: 0, w: 2.6, l: 6 },
    bothWays: true,
    time: 80,
    stars: { three: 27, two: 38 },
    obstacles: [
      { kind: 'wall', x: 9.8, z: 0, w: 0.4, l: 46, h: 0.25 },
      { kind: 'wall', x: 8.2, z: -9.1, w: 2.55, l: 10.5, h: 3 },
      { kind: 'wall', x: 8.2, z: 9.1, w: 2.55, l: 10.5, h: 3 },
      car(-2.4, -12, PI),
      car(-2.4, -2, PI),
      car(-2.4, 8, PI),
      car(-2.4, 18, PI),
    ],
  },
  {
    id: 'pillar-hall',
    name: 'Pillar Hall',
    hint: 'Weave through the pillars, then reverse into the bay between a pillar and a parked car.',
    lot: { w: 36, l: 36 },
    spawn: { x: -14, z: -14, rot: PI / 2 },
    target: { x: 0, z: 13, rot: PI, w: 2.6, l: 5.6 },
    bothWays: false,
    time: 110,
    stars: { three: 39, two: 53 },
    bays: bayRow([-9.6, -6.4, -3.2, 0, 3.2, 6.4, 9.6], 13, PI, 2.6),
    obstacles: [
      { kind: 'pillar', x: -9, z: -9 },
      { kind: 'pillar', x: -3, z: -9 },
      { kind: 'pillar', x: 3, z: -9 },
      { kind: 'pillar', x: 9, z: -9 },
      { kind: 'pillar', x: -6, z: 0 },
      { kind: 'pillar', x: 0, z: 0 },
      { kind: 'pillar', x: 6, z: 0 },
      { kind: 'pillar', x: 2, z: 13 },
      car(-3.2, 13, PI),
      car(-6.4, 13, 0),
      car(-9.6, 13, PI),
      car(4, 13, 0),
      car(7.2, 13, PI),
      car(10.4, 13, 0),
    ],
  },
  {
    id: 'delivery-alley',
    name: 'Delivery Alley',
    vehicle: 'van',
    hint: 'Take the van round the tight corner, past the loading bay, then back into it.',
    lot: { w: 48, l: 44 },
    spawn: { x: -14, z: -18, rot: 0 },
    target: { x: 8, z: -6.2, rot: 0, w: 3.8, l: 6 },
    bothWays: false,
    time: 110,
    stars: { three: 39, two: 53 },
    obstacles: [
      wallSeg(-17.2, -21, -17.2, 3.2),
      wallSeg(-10.8, -21, -10.8, -3.4),
      wallSeg(-17.2, 3.2, 17.2, 3.2),
      wallSeg(-10.8, -3.4, 5.9, -3.4),
      wallSeg(10.1, -3.4, 17.2, -3.4),
      wallSeg(5.9, -3.4, 5.9, -9.4),
      wallSeg(10.1, -3.4, 10.1, -9.4),
      wallSeg(5.9, -9.4, 10.1, -9.4),
      wallSeg(17.2, 3.2, 17.2, -3.4),
    ],
  },
  {
    id: 'needle-alley',
    name: 'Needle Alley',
    vehicle: 'sedan',
    hint: 'A dead end and a bay barely wider than the sedan. Back out, line up and drive nose-first into the bay on the right.',
    lot: { w: 30, l: 44 },
    spawn: { x: 0, z: 10, rot: 0 },
    target: { x: 7.3, z: -11, rot: PI / 2, w: 2.6, l: 5.6 },
    bothWays: false,
    time: 95,
    stars: { three: 34, two: 47 },
    obstacles: [
      { kind: 'wall', x: -4.6, z: -3.5, w: 0.4, l: 37, h: 1.2 },
      { kind: 'wall', x: 4.6, z: -18.3, w: 0.4, l: 7.4, h: 1.2 },
      { kind: 'wall', x: 4.6, z: 3.8, w: 0.4, l: 22.4, h: 1.2 },
      { kind: 'wall', x: 0, z: 15.2, w: 9.6, l: 0.4, h: 1.2 },
      { kind: 'wall', x: 10.6, z: -11, w: 0.4, l: 7.2, h: 1.2 },
      car(7.3, -13.2, PI / 2),
      car(7.3, -8.8, PI / 2),
    ],
  },
];

/** A wall across the lot at `z` from x0 to x1 with a gap of `gapW` centred on `gapX`. */
function gateRow(z: number, gapX: number, gapW: number, x0: number, x1: number, h = 1.2): ObstacleDef[] {
  const a = gapX - gapW / 2;
  const b = gapX + gapW / 2;
  return [wallSeg(x0, z, a, z, h), wallSeg(b, z, x1, z, h)];
}

const MASTER_LEVELS: RawLevel[] = [
  {
    id: 'hairpin-deck',
    name: 'Hairpin Deck',
    hint: 'Up the narrow ramp, round the barrier on the deck, then reverse into the bay squeezed between two cars.',
    lot: { w: 24, l: 62 },
    spawn: { x: 0, z: -26, rot: 0 },
    target: { x: -7, z: 27.8, rot: PI, w: 2.6, l: 5.6, floor: 'upper' },
    bothWays: false,
    time: 79,
    stars: { three: 39, two: 53 },
    floors: [
      { id: 'ground', y: 0, area: [{ x: 0, z: -18, hw: 12, hl: 13, rot: 0 }] },
      { id: 'upper', y: 3, area: [{ x: 0, z: 21, hw: 12, hl: 10, rot: 0 }] },
    ],
    ramps: [{ id: 'ramp', from: 'ground', to: 'upper', x: 0, z: 3, rot: 0, w: 3.6, l: 16 }],
    obstacles: [
      { kind: 'wall', x: -5, z: 17, w: 14, l: 0.4, h: 1.2, floor: 'upper' },
      carOn('upper', -9.25, 27.8, 0),
      carOn('upper', -4.75, 27.8, PI),
      carOn('upper', 0, 27.8, 0),
      carOn('upper', 3.2, 27.8, PI),
      carOn('upper', 6.4, 27.8, 0),
      carOn('upper', 9.6, 27.8, PI),
    ],
  },
  {
    id: 'squeeze-play',
    name: 'Squeeze Play',
    hint: 'A narrow aisle and a bay with barely a hand to spare either side. Pull up past it and reverse straight in.',
    lot: { w: 32, l: 30 },
    spawn: { x: -13, z: 5.6, rot: PI / 2 },
    target: { x: 0, z: 11, rot: PI, w: 2.5, l: 5.6 },
    bothWays: false,
    time: 51,
    stars: { three: 29, two: 40 },
    bays: [
      ...bayRow([-12.4, -9.7, -7, -4.4], 11, PI, 2.5),
      // Painted no wider than the 2.2 m centre spacing, so neighbouring stalls do not overlap.
      ...bayRow([-2.2, 0, 2.2], 11, PI, 2.2),
      ...bayRow([4.4, 7, 9.7, 12.4], 11, PI, 2.5),
    ],
    obstacles: [
      ...[-12.4, -9.7, -7, -4.4, -2.2, 2.2, 4.4, 7, 9.7, 12.4].map((x, i) => car(x, 11, i % 2 ? PI : 0)),
      ...[-13.6, -10.4, -7.2, -4, -0.8, 2.4, 5.6, 8.8, 12].map((x, i) => car(x, 1.3, i % 2 ? PI : 0)),
    ],
  },
  {
    id: 'switchback-lane',
    name: 'Switchback Lane',
    vehicle: 'suv',
    hint: 'A one-way lane with two corners the SUV cannot take in one sweep. Shuffle round each and finish in the bay.',
    lot: { w: 30, l: 44 },
    spawn: { x: -8, z: -18, rot: 0 },
    target: { x: 7, z: 15.2, rot: 0, w: 3, l: 5.6 },
    bothWays: false,
    time: 90,
    stars: { three: 54, two: 73 },
    arrows: [
      ...arrowLine(-8, -12, -8, -8, 0, 4),
      ...arrowLine(-2, -5, 3, -5, PI / 2, 5),
      ...arrowLine(7, 2, 7, 8, 0, 3),
    ],
    obstacles: [
      wallSeg(-10.4, -21, -10.4, -2.6),
      wallSeg(-5.4, -21, -5.4, -7.4),
      wallSeg(-5.4, -7.4, 9.4, -7.4),
      wallSeg(-10.4, -2.6, 4.6, -2.6),
      wallSeg(4.6, -2.6, 4.6, 19.4),
      wallSeg(9.4, -7.4, 9.4, 19.4),
      wallSeg(4.6, 19.4, 9.4, 19.4),
    ],
  },
  {
    id: 'gate-runner',
    name: 'Gate Runner',
    vehicle: 'sedan',
    theme: 'dusk',
    hint: 'Three walls, three narrow gates on alternate sides. Weave through them, then reverse into the walled bay.',
    lot: { w: 36, l: 44 },
    spawn: { x: -12, z: -19, rot: 0 },
    target: { x: 10, z: 16.8, rot: PI, w: 2.8, l: 5.6 },
    bothWays: false,
    time: 111,
    stars: { three: 58, two: 78 },
    arrows: arrowLine(-9, -15, -9, -11, 0, 4),
    obstacles: [
      ...gateRow(-10, -9, 3.4, -18, 18),
      ...gateRow(-1, 9, 3.4, -18, 18),
      ...gateRow(8, -9, 3.4, -18, 18),
      wallSeg(7.9, 14, 7.9, 22),
      wallSeg(12.1, 14, 12.1, 22),
    ],
  },
  {
    id: 'dock-master',
    name: 'Dock Master',
    vehicle: 'box-truck',
    hint: 'The box truck needs every metre of the yard. Swing wide, then reverse into the narrow loading dock.',
    lot: { w: 40, l: 40 },
    spawn: { x: -14, z: -16, rot: 0 },
    target: { x: 8, z: 15.4, rot: PI, w: 3.4, l: 8.4 },
    bothWays: false,
    time: 175,
    stars: { three: 103, two: 140 },
    obstacles: [
      { kind: 'wall', x: 4.9, z: 15.4, w: 1.4, l: 8.4, h: 3 },
      { kind: 'wall', x: 11.1, z: 15.4, w: 1.4, l: 8.4, h: 3 },
      { kind: 'wall', x: -1, z: -3, w: 12, l: 8, h: 3 },
      { kind: 'cone', x: 14, z: 2 },
      { kind: 'cone', x: 14, z: 5 },
      car(16, 11, PI / 2),
    ],
  },
];

/** A parked street car (src/streetCars.ts): body type and colour chosen by hand, collision box of the body's own size. */
function streetCar(
  body: StreetBody,
  x: number,
  z: number,
  yawDeg: number,
  color: number,
  heading = PI / 2,
): ObstacleDef {
  const { w, l } = streetDims(body);
  return { kind: 'car', x, z, rot: heading + (yawDeg * PI) / 180, color, body, w, l };
}

/** Main Street: a plain road with a kerb along one side. Pull up and stop in the marked space by the kerb. */
const STREET_LEVEL: RawLevel = {
  id: 'main-street',
  name: 'Main Street',
  hint: 'Drive down the street and stop in the marked space by the kerb.',
  lot: { w: 48, l: 14 },
  spawn: { x: -20, z: -3.2, rot: PI / 2 },
  target: { x: 4, z: -3.2, rot: PI / 2, w: 2.6, l: 5.6 },
  bothWays: true,
  time: 60,
  stars: { three: 18, two: 28 },
  obstacles: [
    { kind: 'wall', x: 0, z: -5.4, w: 46, l: 0.4, h: 0.25 },
    // Kerb side, past the space: a sedan and a van, a little off true and unevenly spaced.
    streetCar('sedan', 9.6, -3.3, 1.5, 0x2f6fde),
    streetCar('van', 16.2, -3.2, -1, 0xe8e8e8),
    // Far side of the street, facing the other way.
    streetCar('bus', -8, 4.5, 0.5, 0xe9b000, -PI / 2),
    streetCar('hatchback', -17, 4.6, -1.5, 0xc8322b, -PI / 2),
    streetCar('suv', 1.5, 4.6, 1, 0x2e8b57, -PI / 2),
    streetCar('pickup', 8.2, 4.5, -1, 0x8a8f98, -PI / 2),
    streetCar('wagon', 14.5, 4.6, 2, 0x7a4fd0, -PI / 2),
    streetCar('sedan', 20.4, 4.6, -1.5, 0x222428, -PI / 2),
  ],
};

const RAW_LEVELS: RawLevel[] = [
  ...LEVELS_1_12,
  mirrored('angle-of-attack', {
    id: 'backhand-angle',
    name: 'Backhand Angle',
    hint: 'The bays slant the other way now. Follow the arrows, swing wide and turn in.',
    arrows: arrowLine(9, -10, 9, 0, 0),
  }),
  mirrored('curb-side', {
    id: 'one-way-curb',
    name: 'One-Way Curb',
    hint: 'Traffic only flows one way here. Reverse in at an angle, then straighten up.',
    arrows: arrowLine(11, 2, 1, 2, -PI / 2, 5),
  }),
  ...VEHICLE_LEVELS,
  ...PROVING_LEVELS,
  ...MASTER_LEVELS,
  STREET_LEVEL,
];

/** Location of every level. Ids are permanent; this is the only place a level is assigned to a world. */
const LOCATION_OF: Record<string, LocationId> = {
  'first-steps': 'open-air',
  'back-it-in': 'open-air',
  'parallel-pro': 'open-air',
  'cone-gates': 'open-air',
  'the-garage': 'open-air',
  'rush-hour': 'open-air',
  'angle-of-attack': 'open-air',
  'backhand-angle': 'open-air',
  'curb-side': 'open-air',
  'one-way-curb': 'open-air',
  'main-street': 'open-air',
  'up-one-floor': 'multi-storey',
  basement: 'multi-storey',
  spiral: 'multi-storey',
  'van-garage': 'industrial',
  'bus-bay': 'industrial',
  'loading-dock': 'industrial',
  'minibus-parallel': 'industrial',
  'drive-through': 'proving',
  'chevron-bays': 'proving',
  'dead-end-turn': 'proving',
  's-bend-reverse': 'proving',
  'double-parallel': 'proving',
  'pillar-hall': 'proving',
  'delivery-alley': 'proving',
  'needle-alley': 'proving',
  'hairpin-deck': 'master-class',
  'squeeze-play': 'master-class',
  'switchback-lane': 'master-class',
  'gate-runner': 'master-class',
  'dock-master': 'master-class',
};

/** Every level with its location, grouped by world in world order (play order) and otherwise in the order written above. */
export const LEVELS: LevelDef[] = LOCATIONS.flatMap((loc) =>
  RAW_LEVELS.filter((l) => LOCATION_OF[l.id] === loc).map((l) => ({ ...l, location: loc })),
);
