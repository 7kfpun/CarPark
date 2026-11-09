// Pure renderer for docs/LEVELS.md and docs/maps/*.svg. Used by `npm run maps` (scripts/maps.ts)
// and by `npm run validate`, which fails when the committed files differ from this output.
import { corners, type OBB } from '../src/collision';
import { CAR_L, CAR_W } from '../src/config';
import { levelObstacleDefs, rampOBB, Surfaces } from '../src/floors';
import { bayOBB, obstacleOBB, type FloorDef, type LevelDef, type ObstacleDef } from '../src/layout';

const SCALE = 20; // px per metre
const MARGIN = 2; // metres around the lot
const CAR_COLORS = ['#2f6fde', '#e8e8e8', '#8a8f98', '#c8322b', '#2e8b57', '#222428', '#7a4fd0', '#1fa3b5'];

/** Number with at most 2 decimals and no trailing zeros ("-0" becomes "0"). */
export function num(v: number): string {
  const s = (Math.round(v * 100) / 100).toString();
  return s === '-0' ? '0' : s;
}

function poly(o: OBB): string {
  return corners(o)
    .map(([x, z]) => `${num(x * SCALE)},${num(z * SCALE)}`)
    .join(' ');
}

/** World point of local (lx, lz) of an OBB-like pose. */
function local(o: { x: number; z: number; rot: number }, lx: number, lz: number): [number, number] {
  const s = Math.sin(o.rot);
  const c = Math.cos(o.rot);
  return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
}

function pt(p: [number, number]): string {
  return `${num(p[0] * SCALE)},${num(p[1] * SCALE)}`;
}

/** An arrow from local (0, -len/2) to (0, +len/2), pointing along the pose's heading. */
function arrow(o: { x: number; z: number; rot: number }, len: number, cls: string): string {
  const tip = local(o, 0, len / 2);
  const tail = local(o, 0, -len / 2);
  const headL = local(o, -len * 0.18, len / 2 - len * 0.28);
  const headR = local(o, len * 0.18, len / 2 - len * 0.28);
  return `<polyline class="${cls}" points="${pt(tail)} ${pt(tip)}"/><polygon class="${cls}f" points="${pt(tip)} ${pt(headL)} ${pt(headR)}"/>`;
}

function obstacleSvg(o: ObstacleDef): string {
  const box = obstacleOBB(o);
  switch (o.kind) {
    case 'car': {
      const color = CAR_COLORS[(o.variant ?? 0) % CAR_COLORS.length];
      const noseA = local({ x: o.x, z: o.z, rot: o.rot ?? 0 }, -CAR_W / 2 + 0.15, CAR_L / 2 - 0.9);
      const noseB = local({ x: o.x, z: o.z, rot: o.rot ?? 0 }, CAR_W / 2 - 0.15, CAR_L / 2 - 0.9);
      return `<polygon class="car" fill="${color}" points="${poly(box)}"/><polyline class="glass" points="${pt(noseA)} ${pt(noseB)}"/>`;
    }
    case 'cone':
      return `<circle class="cone" cx="${num(o.x * SCALE)}" cy="${num(o.z * SCALE)}" r="${num(0.25 * SCALE)}"/>`;
    case 'pillar':
      return `<polygon class="pillar" points="${poly(box)}"/>`;
    case 'wall':
      return `<polygon class="wall" points="${poly(box)}"/>`;
  }
}

/** Bay with lines on three sides, closed at local +z (like the painted bays in the game). */
function bayPath(b: OBB & { rot: number }): string {
  const p = (lx: number, lz: number): string => pt(local(b, lx, lz));
  return `${p(-b.hw, -b.hl)} ${p(-b.hw, b.hl)} ${p(b.hw, b.hl)} ${p(b.hw, -b.hl)}`;
}

export interface FloorMap {
  /** File name without extension, e.g. "the-garage" or "garage-2-upper". */
  file: string;
  label: string | null;
  svg: string;
}

export function floorMaps(def: LevelDef): FloorMap[] {
  const surfaces = new Surfaces(def);
  const floors = surfaces.floors;
  const obstacles = levelObstacleDefs(def, surfaces);
  const first = floors[0].id;
  const out: FloorMap[] = [];
  // Landings between the segments of a curved ramp are drawn on the map of the storey the ramp climbs from.
  const storeys = floors.filter((f) => !f.landing);
  const landingsOf = (storey: FloorDef): FloorDef[] => {
    const above = storeys.filter((f) => f.y > storey.y).map((f) => f.y);
    const top = above.length ? Math.min(...above) : Infinity;
    return floors.filter((f) => f.landing && f.y > storey.y && f.y < top);
  };
  for (const [fi, floor] of storeys.entries()) {
    const group = [floor, ...landingsOf(floor)];
    const ids = new Set(group.map((f) => f.id));
    const ramps = surfaces.ramps.filter((r) => ids.has(r.from) || ids.has(r.to));
    const layers = new Set([...ids, ...ramps.map((r) => r.id)]);
    const parts: string[] = [];
    // Floor outline.
    for (const f of group) for (const a of f.area) parts.push(`<polygon class="floor" points="${poly(a)}"/>`);
    // Painted bays.
    for (const b of def.bays ?? []) {
      if ((b.floor ?? first) !== floor.id) continue;
      parts.push(`<polyline class="bay" points="${bayPath(bayOBB(b))}"/>`);
    }
    // Painted one-way arrows (single-floor levels only).
    if (floor.id === first) for (const a of def.arrows ?? []) parts.push(arrow(a, 3, 'roadarrow'));
    // Ramps, arrow pointing uphill.
    for (const r of ramps) {
      const up = surfaces.floorHeight(r.to)! >= surfaces.floorHeight(r.from)!;
      const climbs = up ? ids.has(r.from) : ids.has(r.to);
      parts.push(`<polygon class="ramp" points="${poly(rampOBB(r))}"/>`);
      const dir = climbs ? r.rot : r.rot + Math.PI;
      parts.push(arrow({ x: r.x, z: r.z, rot: dir }, r.l * 0.7, 'ramparrow'));
      const lab = local(r, 0, 0);
      parts.push(
        `<text class="label" x="${num(lab[0] * SCALE)}" y="${num(lab[1] * SCALE)}" text-anchor="middle">${esc(r.id)} ${climbs ? 'up' : 'down'}</text>`,
      );
    }
    // Target bay.
    const t = def.target;
    if ((t.floor ?? first) === floor.id) {
      parts.push(`<polygon class="target" points="${poly(bayOBB(t))}"/>`);
      parts.push(arrow(t, Math.min(t.l * 0.7, 3.5), 'targetarrow'));
    }
    // Obstacles on this floor or on its ramps (cars last so they sit on top of walls).
    const here = obstacles.filter((o) => layers.has(o.floor ?? first));
    for (const o of here.filter((x) => x.kind !== 'car')) parts.push(obstacleSvg(o));
    for (const o of here.filter((x) => x.kind === 'car')) parts.push(obstacleSvg(o));
    // Start car.
    if (fi === 0) {
      const s = def.spawn;
      parts.push(
        `<polygon class="start" points="${poly({ x: s.x, z: s.z, hw: CAR_W / 2, hl: CAR_L / 2, rot: s.rot })}"/>`,
        arrow(s, CAR_L * 0.8, 'startarrow'),
      );
    }
    // A multi-storey lot's floors can reach outside lot.w x lot.l, so frame the union.
    const box = viewBox(def, [...group.flatMap((f) => f.area), ...ramps.map(rampOBB)]);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" width="${box[2]}" height="${box[3]}" role="img" aria-label="${esc(def.name)}${storeys.length > 1 ? ` ${esc(floor.id)} floor` : ''}">\n` +
      `<style>.bg{fill:#f4f5f7}.floor{fill:#d9dce1}.bay{fill:none;stroke:#fff;stroke-width:2}.target{fill:rgba(46,204,113,.45);stroke:#1e9c57;stroke-width:3}` +
      `.targetarrow{fill:none;stroke:#1e9c57;stroke-width:3}.targetarrowf{fill:#1e9c57}.car{stroke:#111;stroke-width:1.5}.glass{stroke:#111;stroke-width:3;opacity:.55}` +
      `.wall{fill:#555b66}.pillar{fill:#2b2f36}.cone{fill:#ff8a1f;stroke:#b3540a;stroke-width:1.5}.start{fill:#ffd23f;stroke:#111;stroke-width:2}` +
      `.startarrow{fill:none;stroke:#111;stroke-width:3}.startarrowf{fill:#111}.ramp{fill:#b7c4d9;stroke:#5b7aa6;stroke-width:2}` +
      `.roadarrow{fill:none;stroke:#fff;stroke-width:3}.roadarrowf{fill:#fff}.ramparrow{fill:none;stroke:#2d4a73;stroke-width:3}.ramparrowf{fill:#2d4a73}.label{font:12px sans-serif;fill:#1b2a41}</style>\n` +
      `<rect class="bg" x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}"/>\n` +
      parts.join('\n') +
      '\n</svg>\n';
    out.push({
      file: storeys.length > 1 ? `${def.id}-${floor.id}` : def.id,
      label: storeys.length > 1 ? floor.id : null,
      svg,
    });
  }
  return out;
}

function viewBox(def: LevelDef, area: OBB[]): [number, number, number, number] {
  let x0 = -def.lot.w / 2;
  let x1 = def.lot.w / 2;
  let z0 = -def.lot.l / 2;
  let z1 = def.lot.l / 2;
  if (def.floors) {
    x0 = z0 = Infinity;
    x1 = z1 = -Infinity;
    for (const a of area) {
      for (const [x, z] of corners(a)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    }
  }
  return [
    Math.floor((x0 - MARGIN) * SCALE),
    Math.floor((z0 - MARGIN) * SCALE),
    Math.ceil((x1 - x0 + MARGIN * 2) * SCALE),
    Math.ceil((z1 - z0 + MARGIN * 2) * SCALE),
  ];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Markdown table cell: escape pipes. */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function degrees(rot: number): string {
  const d = ((((rot * 180) / Math.PI) % 360) + 360) % 360;
  return `${num(d)}°`;
}

function section(def: LevelDef, index: number, maps: FloorMap[]): string {
  const t = def.target;
  const s = def.spawn;
  const lines = [
    `## ${index + 1}. ${cell(def.name)}`,
    '',
    `> ${def.hint}`,
    '',
    '| | |',
    '| --- | --- |',
    `| Id | \`${def.id}\` |`,
    `| Lot | ${num(def.lot.w)} × ${num(def.lot.l)} m |`,
    `| Time limit | ${def.time} s |`,
    `| Star times | 3 stars ≤ ${def.stars.three} s, 2 stars ≤ ${def.stars.two} s, 1 star within ${def.time} s |`,
    `| Target bay | x ${num(t.x)}, z ${num(t.z)}, ${num(t.w)} × ${num(t.l)} m, facing ${degrees(t.rot)}${t.floor ? `, floor \`${t.floor}\`` : ''}${def.bothWays ? ' (either direction)' : ' (nose must point that way)'} |`,
    `| Start pose | x ${num(s.x)}, z ${num(s.z)}, heading ${degrees(s.rot)} |`,
  ];
  lines.push('');
  for (const m of maps) {
    lines.push(`![${def.name}${m.label ? `, floor ${m.label}` : ''}](maps/${m.file}.svg)`, '');
  }
  return lines.join('\n');
}

/** Every generated file, path (relative to the repo root) to content, in a stable order. */
export function renderMaps(levels: LevelDef[]): Map<string, string> {
  const files = new Map<string, string>();
  const parts = [
    '# Levels',
    '',
    '<!-- Generated by `npm run maps` from src/levels.ts. Do not edit by hand. -->',
    '',
    'Every level in play order. Maps are top-down: x runs right, z runs down the page. The yellow car is the start',
    'pose (arrow = heading), the green bay is the target (arrow = the way the nose must point), grey blocks are',
    'walls and pillars, orange dots are cones and coloured boxes are parked cars. On multi-storey levels there is',
    'one map per floor and ramps are blue with an arrow pointing uphill.',
    '',
  ];
  for (const [i, def] of levels.entries()) {
    const maps = floorMaps(def);
    for (const m of maps) files.set(`docs/maps/${m.file}.svg`, m.svg);
    parts.push(section(def, i, maps));
  }
  files.set('docs/LEVELS.md', parts.join('\n').replace(/\n+$/, '\n'));
  return files;
}
