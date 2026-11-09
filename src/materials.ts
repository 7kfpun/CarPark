import * as THREE from 'three';

// Procedural surface materials. Nothing here is downloaded: the ground textures are
// drawn once into small canvases (256 px, 3 maps each, about 0.8 MB of GPU memory in
// total), and the Kenney cars only get new material parameters.

/** Deterministic RNG (same constants as the level decoration), so textures look the same every load. */
export function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Smooth value noise in [0, 1] that wraps at the edges, so the texture tiles. */
export function tileableNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  const at = (cx: number, cy: number) =>
    lattice[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

export type SurfaceKind = 'asphalt' | 'concrete';

/** Height field in [0, 1] for a tileable surface: broad undulation, fine grain, and for asphalt scattered aggregate. */
export function heightField(kind: SurfaceKind, size: number, seed: number): Float32Array {
  const rand = seededRandom(seed);
  const broad = tileableNoise(size, 4, rand);
  const mid = tileableNoise(size, 16, rand);
  const fine = tileableNoise(size, 64, rand);
  const h = new Float32Array(size * size);
  const grain = kind === 'asphalt' ? 0.5 : 0.25;
  for (let i = 0; i < h.length; i++) h[i] = broad[i] * 0.3 + mid[i] * (0.9 - grain) + fine[i] * grain;
  if (kind === 'asphalt') {
    // Aggregate stones: small bumps, wrapped around the edges.
    for (let n = 0; n < size * size * 0.03; n++) {
      const cx = Math.floor(rand() * size);
      const cy = Math.floor(rand() * size);
      const r = rand() < 0.2 ? 2 : 1;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          const x = (cx + dx + size) % size;
          const y = (cy + dy + size) % size;
          h[y * size + x] = Math.min(1, h[y * size + x] + 0.35);
        }
    }
  }
  // Normalise to [0, 1].
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo || 1);
  return h;
}

/** Tangent-space normal map (RGBA bytes) from a height field, wrapping at the edges. */
export function normalFromHeight(h: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      out[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[o + 1] = ((dy / len) * 0.5 + 0.5) * 255; // flipY canvas textures: +v is up in the image
      out[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  return out;
}

/** Colour of the surface at height `v` (0..1), with a per-pixel tint `t` (0..1). */
export function surfaceColor(kind: SurfaceKind, v: number, t: number): [number, number, number] {
  if (kind === 'asphalt') {
    const g = 46 + v * 40 + (t - 0.5) * 8;
    return [g, g, g + 5];
  }
  const g = 168 + v * 34 + (t - 0.5) * 10;
  return [g + 3, g, g - 7];
}

/** Roughness in [0, 1]: a base value plus a subtle variation that follows the height (polished high spots) and a slow patchiness. */
export function surfaceRoughness(base: number, variation: number, v: number, patch: number): number {
  const r = base + variation * ((patch - 0.5) * 1.2 - (v - 0.5) * 0.8);
  return Math.min(1, Math.max(0.05, r));
}

export interface SurfacePixels {
  color: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  /** Roughness in the G channel (what three.js reads); R and B are 0. */
  rough: Uint8ClampedArray;
}

const SURFACE_SPEC: Record<SurfaceKind, { seed: number; strength: number; base: number; variation: number }> = {
  asphalt: { seed: 7, strength: 2.4, base: 0.88, variation: 0.14 },
  concrete: { seed: 21, strength: 1.6, base: 0.82, variation: 0.1 },
};

export function surfacePixels(kind: SurfaceKind, size: number): SurfacePixels {
  const spec = SURFACE_SPEC[kind];
  const h = heightField(kind, size, spec.seed);
  const patch = tileableNoise(size, 3, seededRandom(spec.seed + 100));
  const tint = tileableNoise(size, 32, seededRandom(spec.seed + 200));
  const color = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < h.length; i++) {
    const [r, g, b] = surfaceColor(kind, h[i], tint[i]);
    color.set([r, g, b, 255], i * 4);
    rough.set([0, surfaceRoughness(spec.base, spec.variation, h[i], patch[i]) * 255, 0, 255], i * 4);
  }
  return { color, normal: normalFromHeight(h, size, spec.strength), rough };
}

const TEX_SIZE = 256;

function canvasTexture(data: Uint8ClampedArray, size: number, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

export interface SurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const surfaceCache = new Map<SurfaceKind, SurfaceTextures>();

/** Textures for a surface, built once and shared by every level (never disposed per level). */
export function surfaceTextures(kind: SurfaceKind): SurfaceTextures {
  let s = surfaceCache.get(kind);
  if (!s) {
    const px = surfacePixels(kind, TEX_SIZE);
    s = {
      map: canvasTexture(px.color, TEX_SIZE, true),
      normalMap: canvasTexture(px.normal, TEX_SIZE, false),
      roughnessMap: canvasTexture(px.rough, TEX_SIZE, false),
    };
    surfaceCache.set(kind, s);
  }
  return s;
}

/** A standard material for a tiled surface. `normalScale` tames the bump on flat floors. */
export function surfaceMaterial(kind: SurfaceKind, tint = 0xffffff): THREE.MeshStandardMaterial {
  const t = surfaceTextures(kind);
  const mat = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: t.roughnessMap,
    roughness: 1,
    color: tint,
  });
  mat.userData.kind = kind;
  return mat;
}

/** Roughness used in place of the roughness map when detail is off (Low graphics). */
const FLAT_ROUGHNESS = 0.9;

/**
 * Low graphics keeps the old flat look and cost: ground without normal and roughness maps,
 * cars without the clear-coat layer. High (and Auto on a fast device) has the full materials.
 * Safe to call on any subtree, any number of times.
 */
export function setMaterialDetail(root: THREE.Object3D, detailed: boolean): void {
  const pick = (m: THREE.Material): THREE.Material => {
    // Cars: the physical (clear-coat) material on High, the original standard one on Low, which costs no more than before.
    const base = m.userData.base as THREE.Material | undefined;
    if (base) return detailed ? m : base;
    const phys = m.userData.phys as THREE.Material | undefined;
    if (phys) return detailed ? phys : m;
    if (m.userData.kind !== undefined) {
      const mat = m as THREE.MeshStandardMaterial;
      if ((mat.normalMap !== null) !== detailed) {
        const t = surfaceTextures(mat.userData.kind as SurfaceKind);
        mat.normalMap = detailed ? t.normalMap : null;
        mat.roughnessMap = detailed ? t.roughnessMap : null;
        mat.roughness = detailed ? 1 : FLAT_ROUGHNESS;
        mat.needsUpdate = true;
        for (const tex of [t.map, t.normalMap, t.roughnessMap]) {
          tex.anisotropy = detailed ? 4 : 1; // anisotropic filtering is costly on weak GPUs
          tex.needsUpdate = true;
        }
      }
    }
    return m;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(pick) : pick(mesh.material);
  });
}

/**
 * Rescale a box's UVs so a tile covers `tile` metres on every face. The default box
 * UVs stretch one whole texture over each face, which smears the grain on big slabs.
 */
export function tileBoxUV(geo: THREE.BoxGeometry, tile: number): void {
  const { width, height, depth } = geo.parameters;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const faces: [number, number][] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  faces.forEach(([a, b], f) => {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * a) / tile, (uv.getY(k) * b) / tile);
    }
  });
  uv.needsUpdate = true;
}

// --- Cars -------------------------------------------------------------------

export interface PaintParams {
  /** 0 none .. 1 full clear-coat layer. */
  clearcoat: number;
  roughness: number;
  metalness: number;
}

/**
 * What a texel of the Kenney colour palette is made of. The models use one palette
 * texture for everything, so the material class comes from the colour itself:
 * near-black is rubber/trim, pale blue-white is glass, the rest is painted metal.
 */
export function classifyTexel(r: number, g: number, b: number): PaintParams & { kind: 'rubber' | 'glass' | 'paint' } {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.3) return { kind: 'rubber', clearcoat: 0, roughness: 0.88, metalness: 0 };
  if (lum > 0.72 && b > r + 12 && b >= g) return { kind: 'glass', clearcoat: 1, roughness: 0.04, metalness: 0.1 };
  return { kind: 'paint', clearcoat: 1, roughness: 0.42, metalness: 0.3 };
}

/** RGBA bytes of a control map for the palette: R clear-coat, G roughness, B metalness (what three.js reads per map). */
export function paintControlPixels(rgba: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const p = classifyTexel(rgba[i], rgba[i + 1], rgba[i + 2]);
    out[i] = p.clearcoat * 255;
    out[i + 1] = p.roughness * 255;
    out[i + 2] = p.metalness * 255;
    out[i + 3] = 255;
  }
  return out;
}

const upgraded = new WeakMap<THREE.Material, THREE.MeshPhysicalMaterial>();

/**
 * Swap a Kenney model's palette material for a clear-coated physical one: glossy paint,
 * mirror-like glass and matte rubber, all driven by a control map built from the palette.
 * Falls back to the original material when the palette image is not readable.
 */
export function upgradeCarMaterial(mat: THREE.Material): THREE.Material {
  const done = upgraded.get(mat);
  if (done) return done;
  const src = mat as THREE.MeshStandardMaterial;
  const image = src.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!src.isMeshStandardMaterial || !image || !image.width) return mat;
  let control: THREE.CanvasTexture;
  try {
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(image, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    g.putImageData(
      new ImageData(paintControlPixels(px.data) as Uint8ClampedArray<ArrayBuffer>, c.width, c.height),
      0,
      0,
    );
    control = new THREE.CanvasTexture(c);
  } catch {
    return mat;
  }
  control.colorSpace = THREE.NoColorSpace;
  control.flipY = src.map!.flipY;
  control.channel = src.map!.channel;
  control.wrapS = src.map!.wrapS;
  control.wrapT = src.map!.wrapT;
  control.offset.copy(src.map!.offset);
  control.repeat.copy(src.map!.repeat);
  control.rotation = src.map!.rotation;
  control.center.copy(src.map!.center);
  const phys = new THREE.MeshPhysicalMaterial({
    map: src.map,
    side: src.side,
    roughness: 1,
    metalness: 1,
    roughnessMap: control,
    metalnessMap: control,
    clearcoat: 1,
    clearcoatMap: control,
    clearcoatRoughness: 0.06,
  });
  phys.userData.base = mat;
  mat.userData.phys = phys;
  upgraded.set(mat, phys);
  return phys;
}
