import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// CC0 car models from Kenney's Car Kit (www.kenney.nl), see public/models/cars/License.txt.
export const PLAYER_MODEL = 'sedan-sports';
export const PARKED_MODELS = ['sedan', 'suv', 'hatchback-sports', 'van', 'taxi', 'suv-luxury'] as const;
const ALL = [PLAYER_MODEL, ...PARKED_MODELS];

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

function toTemplate(scene: THREE.Object3D): CarTemplate {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
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
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    MODEL_SHARED.add(mesh.geometry);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      MODEL_SHARED.add(mat);
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) MODEL_SHARED.add(map);
    }
  });
  return { body, wheels, box };
}

/**
 * Load every car model. Resolves even if some fail: missing models fall back to
 * the built-in box car, so the game always starts.
 */
export async function loadCarModels(
  baseUrl = `${import.meta.env.BASE_URL}models/cars/`,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const manager = new THREE.LoadingManager();
  if (onProgress) manager.onProgress = (_url, loaded, total) => onProgress(loaded, total);
  const loader = new GLTFLoader(manager);
  await Promise.all(
    ALL.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${baseUrl}${name}.glb`);
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
