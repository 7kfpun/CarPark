import { VEHICLES } from './vehicles';
import { MODEL_TIMEOUT_MS, withTimeout } from './loading';
import { upgradeCarMaterial } from './materials';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// CC0 car models from Kenney's Car Kit (www.kenney.nl), see public/models/cars/License.txt.
export const PARKED_MODELS = ['sedan', 'suv', 'hatchback-sports', 'van', 'taxi', 'suv-luxury'] as const;
/** Every model file to load: the parked-car set plus those the vehicle table drives. */
const ALL = [...new Set([...VEHICLES.flatMap((v) => (v.model ? [v.model] : [])), ...PARKED_MODELS])];

export interface WheelTemplate {
  mesh: THREE.Object3D;
  /** Wheel centre in model units. */
  pos: THREE.Vector3;
  front: boolean;
}

export interface CarTemplate {
  /** Everything except the four road wheels, in model units. */
  body: THREE.Object3D;
  wheels: WheelTemplate[];
  /** Bounds of the whole car in model units. */
  box: THREE.Box3;
}

const templates = new Map<string, CarTemplate>();
/** Geometries, materials and textures owned by the loaded templates (never disposed per level). */
export const MODEL_SHARED = new Set<object>();

/** Exported for the validate script. */
export function toTemplate(scene: THREE.Object3D): CarTemplate {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  // Collect shared resources while every mesh is still under `scene`: the loop below reparents
  // them, after which scene.traverse would miss them and level.dispose() would free them.
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    MODEL_SHARED.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      MODEL_SHARED.add(mat); // the original palette material (Low graphics) ...
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) MODEL_SHARED.add(map);
    }
    const up = mats.map(upgradeCarMaterial);
    mesh.material = Array.isArray(mesh.material) ? up : up[0];
    for (const mat of up) {
      MODEL_SHARED.add(mat); // ... and the clear-coated one (High), with its control map
      const m = mat as THREE.MeshPhysicalMaterial;
      for (const t of [m.roughnessMap, m.metalnessMap, m.clearcoatMap]) if (t) MODEL_SHARED.add(t);
    }
  });
  const body = new THREE.Group();
  const wheels: WheelTemplate[] = [];
  for (const child of [...scene.children]) {
    // Only the four road wheels animate (the SUV's spare "wheel-back" stays on the body).
    const m = /^wheel-(front|back)-(left|right)$/.exec(child.name);
    if (m) {
      const pos = child.position.clone();
      child.position.set(0, 0, 0);
      wheels.push({ mesh: child, pos, front: m[1] === 'front' });
    } else body.add(child);
  }
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  for (const w of wheels) w.mesh.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : undefined));
  return { body, wheels, box };
}

/** Model files to fetch before the first frame: just the first vehicle's car (the menu needs no others). */
export const FIRST_MODELS: readonly string[] = ALL.slice(0, 1);
/** Everything else, fetched in the background once the game is up. */
export const LATER_MODELS: readonly string[] = ALL.slice(1);

/** URL of a model file; the build id in the query makes a redeploy bypass a stale cached copy. */
export function modelUrl(name: string, baseUrl = `${import.meta.env.BASE_URL}models/cars/`): string {
  return `${baseUrl}${name}.glb?v=${__APP_BUILD__}`;
}

/**
 * Load the given car models (all of them by default). Resolves even if some fail: missing
 * models fall back to the built-in box car, so the game always starts.
 */
export async function loadCarModels(
  names: readonly string[] = ALL,
  onProgress?: (loaded: number, total: number) => void,
  timeoutMs = MODEL_TIMEOUT_MS,
  baseUrl?: string,
): Promise<void> {
  const manager = new THREE.LoadingManager();
  if (onProgress) manager.onProgress = (_url, loaded, total) => onProgress(loaded, total);
  const loader = new GLTFLoader(manager);
  await Promise.all(
    names
      .filter((name) => !templates.has(name))
      .map(async (name) => {
        try {
          const gltf = await withTimeout(loader.loadAsync(modelUrl(name, baseUrl)), timeoutMs, `Car model "${name}"`);
          templates.set(name, toTemplate(gltf.scene));
        } catch (err) {
          console.warn(`Car model "${name}" failed to load; using the box car.`, err);
        }
      }),
  );
}

export function carTemplate(name: string): CarTemplate | undefined {
  return templates.get(name);
}

/** Parked-car model for an obstacle's variant number (stable, so levels look the same each time). */
export function parkedModel(variant: number): string {
  return PARKED_MODELS[variant % PARKED_MODELS.length];
}
