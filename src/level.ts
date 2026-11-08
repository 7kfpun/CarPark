import * as THREE from 'three';
import { CAR_SHARED, createCarModel } from './car';
import { parkedModel } from './carModels';
import type { OBB } from './collision';
import {
  allObstacles,
  bayOBB,
  obstacleDims,
  obstacleOBB,
  type BayDef,
  type LevelDef,
  type ObstacleDef,
} from './layout';

export interface BuiltLevel {
  def: LevelDef;
  group: THREE.Group;
  obstacles: OBB[];
  bay: OBB;
  bayFill: THREE.MeshBasicMaterial;
  bayEdge: THREE.MeshBasicMaterial;
  marker: THREE.Object3D;
  dispose(): void;
}

let asphaltTex: THREE.CanvasTexture | null = null;
function asphalt(): THREE.CanvasTexture {
  if (asphaltTex) return asphaltTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#44474d';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.35})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  asphaltTex = new THREE.CanvasTexture(c);
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  asphaltTex.colorSpace = THREE.SRGBColorSpace;
  return asphaltTex;
}

/** Deterministic RNG so decoration is stable per level. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b5ac, roughness: 0.9 });
const curbMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 });
const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
const coneStripe = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.8 });
const hazardMat = new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.7 });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1 });
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 8);
const leafGeo = new THREE.ConeGeometry(1.4, 3.2, 9);
const sharedGeo = new Set<THREE.BufferGeometry>([trunkGeo, leafGeo]);
const shared = new Set<THREE.Material>([
  lineMat,
  concrete,
  curbMat,
  coneMat,
  coneStripe,
  pillarMat,
  hazardMat,
  trunkMat,
  leafMat,
]);

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function line(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  l: number,
  mat: THREE.Material = lineMat,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, l), mat);
  m.position.set(x, 0.01, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function decorBay(b: BayDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(b.x, 0, b.z);
  g.rotation.y = b.rot;
  const t = 0.12;
  line(g, -b.w / 2, 0, t, b.l);
  line(g, b.w / 2, 0, t, b.l);
  line(g, 0, b.l / 2, b.w + t, t);
  return g;
}

function obstacleMesh(o: ObstacleDef): THREE.Object3D {
  const d = obstacleDims(o);
  let obj: THREE.Object3D;
  switch (o.kind) {
    case 'car':
      obj = createCarModel(o.color ?? 0x888888, parkedModel(o.variant ?? 0)).root;
      break;
    case 'cone': {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 16), coneMat);
      cone.position.y = 0.4;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.1, 16), coneStripe);
      stripe.position.y = 0.45;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), coneMat);
      base.position.y = 0.025;
      g.add(cone, stripe, base);
      obj = g;
      break;
    }
    case 'pillar': {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.l), pillarMat);
      p.position.y = d.h / 2;
      const band = new THREE.Mesh(new THREE.BoxGeometry(d.w + 0.02, 0.5, d.l + 0.02), hazardMat);
      band.position.y = 0.6;
      g.add(p, band);
      obj = g;
      break;
    }
    case 'wall': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.l), d.h < 0.7 ? curbMat : concrete);
      m.position.y = d.h / 2;
      obj = m;
      break;
    }
  }
  obj.position.set(o.x, 0, o.z);
  obj.rotation.y = o.rot ?? 0;
  return shadowed(obj);
}

export function buildLevel(def: LevelDef, index: number): BuiltLevel {
  const group = new THREE.Group();
  const { w, l } = def.lot;

  // Grass + asphalt lot.
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x5b8a45, roughness: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  group.add(grass);

  const tex = asphalt();
  const lotMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const lotGeo = new THREE.PlaneGeometry(w + 1.2, l + 1.2);
  const uv = lotGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (w + 1.2)) / 8, (uv.getY(i) * (l + 1.2)) / 8);
  const lot = new THREE.Mesh(lotGeo, lotMat);
  lot.rotation.x = -Math.PI / 2;
  lot.receiveShadow = true;
  group.add(lot);

  for (const b of def.bays ?? []) group.add(decorBay(b));
  const obstacleDefs = allObstacles(def);
  for (const o of obstacleDefs) group.add(obstacleMesh(o));

  // Target bay: translucent fill, glowing edges, direction arrow, floating marker.
  const t = def.target;
  const bayGroup = new THREE.Group();
  bayGroup.position.set(t.x, 0, t.z);
  bayGroup.rotation.y = t.rot;
  const bayFill = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.28, depthWrite: false });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(t.w, t.l), bayFill);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.025;
  bayGroup.add(fill);
  const bayEdge = new THREE.MeshBasicMaterial({ color: 0xffa31a });
  const e = 0.16;
  line(bayGroup, -t.w / 2, 0, e, t.l + e, bayEdge).position.y = 0.03;
  line(bayGroup, t.w / 2, 0, e, t.l + e, bayEdge).position.y = 0.03;
  line(bayGroup, 0, t.l / 2, t.w + e, e, bayEdge).position.y = 0.03;
  line(bayGroup, 0, -t.l / 2, t.w + e, e, bayEdge).position.y = 0.03;
  if (!def.bothWays) {
    const s = new THREE.Shape();
    s.moveTo(0, 1.1);
    s.lineTo(0.8, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, -1.1);
    s.lineTo(-0.3, -1.1);
    s.lineTo(-0.3, 0);
    s.lineTo(-0.8, 0);
    s.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(s), bayEdge);
    arrow.rotation.x = -Math.PI / 2; // shape +y -> world -z, so flip
    arrow.rotation.z = Math.PI;
    arrow.position.y = 0.035;
    bayGroup.add(arrow);
  }
  group.add(bayGroup);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffa31a, emissiveIntensity: 0.8 }),
  );
  marker.position.set(t.x, 3.2, t.z);
  group.add(marker);

  // Trees around the lot.
  const rand = rng(1234 + index * 97);
  for (let i = 0; i < 60; i++) {
    const side = Math.floor(rand() * 4);
    const along = (rand() - 0.5) * (side < 2 ? w + 30 : l + 30);
    const out = 4 + rand() * 14;
    const x = side < 2 ? along : (side === 2 ? 1 : -1) * (w / 2 + out);
    const z = side < 2 ? (side === 0 ? 1 : -1) * (l / 2 + out) : along;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.8;
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.y = 2.9;
    const s = 0.7 + rand() * 0.7;
    tree.scale.setScalar(s);
    tree.add(trunk, leaves);
    tree.position.set(x, 0, z);
    tree.userData.decor = true;
    group.add(shadowed(tree));
  }

  return {
    def,
    group,
    obstacles: obstacleDefs.map(obstacleOBB),
    bay: bayOBB(t),
    bayFill,
    bayEdge,
    marker,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!CAR_SHARED.has(m.geometry) && !sharedGeo.has(m.geometry)) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (!shared.has(mat) && !CAR_SHARED.has(mat)) mat.dispose();
      });
    },
  };
}
