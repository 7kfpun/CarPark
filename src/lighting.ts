import type { LightTarget } from './storey';

/** Share of the ambient level the hemisphere light keeps once an environment map supplies the rest. */
const HEMI_WITH_ENV = 0.3;
/** Environment map intensity per unit of the scene's ambient level. */
const ENV_PER_AMBIENT = 0.7;

/**
 * Ambient light for the current spot. Without an environment map (Low, or while it loads) the
 * hemisphere light does it all; with one, the map lights and reflects and the hemisphere only fills in.
 */
export function ambientLevels(target: Pick<LightTarget, 'hemi'>, envActive: boolean): { hemi: number; env: number } {
  if (!envActive) return { hemi: target.hemi, env: 0 };
  return { hemi: target.hemi * HEMI_WITH_ENV, env: target.hemi * ENV_PER_AMBIENT };
}
