import type { LevelDef, LocationId } from './layout';
import { isUnlocked, starsFor, type Progress } from './progress';

/** Worlds in play order: finish one to open the next. */
export const LOCATIONS: LocationId[] = ['open-air', 'multi-storey', 'industrial', 'proving', 'master-class'];

export interface WorldInfo {
  id: LocationId;
  name: string;
  blurb: string;
  icon: string;
  /** Accent colour of the world's card. */
  color: string;
}

export const WORLDS: Record<LocationId, WorldInfo> = {
  'open-air': {
    id: 'open-air',
    name: 'Open-Air Lots',
    blurb: 'Daylight, wide bays and the basics.',
    icon: '☀️',
    color: '#ffb703',
  },
  'multi-storey': {
    id: 'multi-storey',
    name: 'Multi-Storey',
    blurb: 'Ramps, basements and a spiral.',
    icon: '🏢',
    color: '#8d99ae',
  },
  industrial: {
    id: 'industrial',
    name: 'Industrial Yard',
    blurb: 'Vans, buses and trucks need room.',
    icon: '🏭',
    color: '#e76f51',
  },
  proving: {
    id: 'proving',
    name: 'Proving Ground',
    blurb: 'Turn-arounds, winding lanes and tight bays.',
    icon: '🧪',
    color: '#2ec4b6',
  },
  'master-class': {
    id: 'master-class',
    name: 'Master Class',
    blurb: 'Hairpins, gates and bays with no room to spare.',
    icon: '🏆',
    color: '#e63946',
  },
};

/** The levels of one world, in play order. */
export function worldLevels(levels: LevelDef[], world: LocationId): LevelDef[] {
  return levels.filter((l) => l.location === world);
}

/** Stars earned in a world and the most it offers. */
export function worldStars(p: Progress, levels: LevelDef[], world: LocationId): { got: number; max: number } {
  const own = worldLevels(levels, world);
  return { got: own.reduce((a, l) => a + starsFor(p, l.id), 0), max: own.length * 3 };
}

/** A world is finished when every one of its levels has at least one star. */
export function worldComplete(p: Progress, levels: LevelDef[], world: LocationId): boolean {
  const own = worldLevels(levels, world);
  return own.length > 0 && own.every((l) => starsFor(p, l.id) > 0);
}

/** The first world is always open; each other opens once the one before it is finished (`openAll`: admin mode). */
export function worldUnlocked(p: Progress, levels: LevelDef[], world: LocationId, openAll = false): boolean {
  const i = LOCATIONS.indexOf(world);
  return openAll || i <= 0 || worldComplete(p, levels, LOCATIONS[i - 1]);
}

/** A level can be played when its world is open and the level is unlocked; an open world's first level always is. */
export function levelPlayable(p: Progress, levels: LevelDef[], lvl: LevelDef, openAll = false): boolean {
  if (!worldUnlocked(p, levels, lvl.location, openAll)) return false;
  return isUnlocked(p, lvl.id) || worldLevels(levels, lvl.location)[0] === lvl;
}

/** Index of the furthest playable level in play order (where "Enter" resumes). */
export function resumeLevel(p: Progress, levels: LevelDef[], openAll = false): number {
  let at = 0;
  levels.forEach((l, i) => {
    if (levelPlayable(p, levels, l, openAll)) at = i;
  });
  return at;
}

export interface HomePlay {
  /** Level the home screen's primary button starts. */
  index: number;
  /** Button text: "Play" on a fresh save, otherwise "Continue". */
  label: string;
  /** Level name under the label. */
  detail: string;
}

/** The home screen's primary action: Play on a fresh save, otherwise resume at the furthest open level. */
export function homePlay(p: Progress, levels: LevelDef[], openAll = false): HomePlay {
  const index = resumeLevel(p, levels, openAll);
  const fresh = levels.every((l) => starsFor(p, l.id) === 0);
  return { index, label: fresh ? 'Play' : 'Continue', detail: `Level ${index + 1} · ${levels[index].name}` };
}
