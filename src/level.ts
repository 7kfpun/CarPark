import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SHARED, createCarModel } from './car';
import { parkedModel } from './carModels';
import type { OBB } from './collision';
import { levelObstacleDefs, levelObstacles, Surfaces } from './floors';
import {
  bayOBB,
  obstacleDims,
  type ArrowDef,
  type BayDef,
  type LayeredOBB,
  type LevelDef,
  type ObstacleDef,
} from './layout';
import { APRON_W, detailLayout, WALL_T, type Spot } from './detail';
import { surfaceMaterial, tileBoxUV } from './materials';
import { floorShown, rampSignText, SLAB } from './storey';

export interface BuiltLevel {
  def: LevelDef;
  group: THREE.Group;
  obstacles: LayeredOBB[];
  surfaces: Surfaces;
  bay: OBB;
  bayFill: THREE.MeshBasicMaterial;
  bayEdge: THREE.MeshBasicMaterial;
  marker: THREE.Object3D;
  /** Resting height of the floating target marker. */
  markerY: number;
  /** Surfaces the chase camera must not pass through (decks, ramps, walls, pillars). */
  solids: THREE.Object3D[];
  /** Top-down view: hide floors above the car. No-op on flat levels. */
  setView(carY: number, topDown: boolean): void;
  dispose(): void;
}

/** Metres covered by one ground texture tile. */
const TILE_M = 6;

const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
const concrete = surfaceMaterial('concrete', 0xe6e2d8);
const curbMat = surfaceMaterial('concrete', 0xf6f0e0);
const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
const coneStripe = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.8 });
const hazardMat = new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.7 });
const deckMat = surfaceMaterial('concrete', 0xb4b6bb);
const ceilingMat = new THREE.MeshBasicMaterial({ color: 0x8a8d93 });
const stripMat = new THREE.MeshBasicMaterial({ color: 0xfff3d2 });
const stripGeo = new THREE.BoxGeometry(0.25, 0.06, 2.4);
const signMats = new Map<string, THREE.MeshBasicMaterial>();
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1 });
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 8);
const leafGeo = new THREE.ConeGeometry(1.4, 3.2, 9);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.6, metalness: 0.5 });
const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d2 });
const fenceMat = new THREE.MeshStandardMaterial({ color: 0x7d838c, roughness: 0.5, metalness: 0.6 });
const bollardMat = new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.6 });
const drainMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 });
const wearMat = new THREE.MeshBasicMaterial({ color: 0x3a3c40, transparent: true, opacity: 0.4, depthWrite: false });
const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6, 8).translate(0, 3, 0);
const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(0, 6, 0.65);
const lampGeo = new THREE.BoxGeometry(0.35, 0.08, 0.7).translate(0, 5.94, 1.3);
const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6).translate(0, 0.7, 0);
const railGeo = new THREE.BoxGeometry(0.03, 0.04, 1).translate(0, 1.15, 0);
const bollardGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.9, 10).translate(0, 0.45, 0);
const drainGeo = new THREE.BoxGeometry(0.6, 0.02, 0.35).translate(0, 0.012, 0);
const wearGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.024, 0);
// A cone is its body plus a flat square base (one geometry, coneMat) and a white stripe.
const coneBodyGeo = (() => {
  const body = new THREE.ConeGeometry(0.22, 0.7, 16).translate(0, 0.4, 0);
  const base = new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0);
  const merged = mergeGeometries([body, base])!;
  body.dispose();
  base.dispose();
  return merged;
})();
const coneStripeGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.1, 16).translate(0, 0.45, 0);
const sharedGeo = new Set<THREE.BufferGeometry>([
  trunkGeo,
  leafGeo,
  stripGeo,
  coneBodyGeo,
  coneStripeGeo,
  poleGeo,
  armGeo,
  lampGeo,
  postGeo,
  railGeo,
  bollardGeo,
  drainGeo,
  wearGeo,
]);
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
  deckMat,
  ceilingMat,
  stripMat,
  poleMat,
  lampMat,
  fenceMat,
  bollardMat,
  drainMat,
  wearMat,
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

/** One draw call for many copies of a mesh. Each spot is a position and a heading; `scale` may stretch it. */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  spots: (Spot & { y?: number; sx?: number; sy?: number; sz?: number })[],
): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach((p, i) => {
    _q.setFromAxisAngle(_up, p.rot);
    _m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), _q, new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
    im.setMatrixAt(i, _m);
  });
  im.instanceMatrix.needsUpdate = true;
  return im;
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

/** A painted one-way arrow on the asphalt, pointing along its heading. */
function roadArrow(a: ArrowDef): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(0, 1.6);
  s.lineTo(1, 0.2);
  s.lineTo(0.35, 0.2);
  s.lineTo(0.35, -1.6);
  s.lineTo(-0.35, -1.6);
  s.lineTo(-0.35, 0.2);
  s.lineTo(-1, 0.2);
  s.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), lineMat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.PI + a.rot; // shape +y -> world -z, so flip, then turn to the heading
  m.position.set(a.x, 0.015, a.z);
  m.receiveShadow = true;
  return m;
}

function obstacleMesh(o: ObstacleDef, y: number): THREE.Object3D {
  const d = obstacleDims(o);
  let obj: THREE.Object3D;
  switch (o.kind) {
    case 'car':
      obj = createCarModel(o.color ?? 0x888888, parkedModel(o.variant ?? 0)).root;
      break;
    case 'cone':
      throw new Error('cones are drawn as instances in buildLevel');
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
      const geo = new THREE.BoxGeometry(d.w, d.h, d.l);
      tileBoxUV(geo, TILE_M);
      const m = new THREE.Mesh(geo, d.h < 0.7 ? curbMat : concrete);
      m.position.y = d.h / 2;
      obj = m;
      break;
    }
  }
  obj.position.set(o.x, y, o.z);
  obj.rotation.y = o.rot ?? 0;
  return shadowed(obj);
}

/** Floor-paint sign ("Level 2 ↑"), one shared material per text. */
function signMat(text: string): THREE.MeshBasicMaterial {
  let m = signMats.get(text);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5c400';
  g.fillRect(0, 0, 512, 192);
  g.fillStyle = '#23252b';
  g.fillRect(10, 10, 492, 172);
  g.fillStyle = '#f5c400';
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshBasicMaterial({ map: tex });
  signMats.set(text, m);
  shared.add(m);
  return m;
}

/** Decks, ramps with side walls, ceiling light strips and floor signs of a multi-storey level. */
function buildStoreys(
  def: LevelDef,
  surfaces: Surfaces,
  add: (o: THREE.Object3D, y: number, solid: boolean) => void,
): void {
  const hasBasement = surfaces.floors.some((f) => f.y < 0);
  for (const f of surfaces.floors) {
    if (f.y === 0 && !hasBasement) continue; // the lot plane is the ground floor
    for (const a of f.area) {
      const deckGeo = new THREE.BoxGeometry(a.hw * 2, SLAB, a.hl * 2);
      tileBoxUV(deckGeo, TILE_M);
      const deck = new THREE.Mesh(deckGeo, [
        deckMat,
        deckMat,
        deckMat,
        ceilingMat, // -y face: the ceiling of the floor below, flat and bright (no light reaches it)
        deckMat,
        deckMat,
      ]);
      deck.position.set(a.x, f.y - SLAB / 2, a.z);
      deck.rotation.y = a.rot;
      add(deck, f.y, true);
      // Light strips under the slab: baked emissive, no real lights.
      const cols = Math.max(1, Math.floor((a.hw * 2) / 7));
      const rows = Math.max(1, Math.floor((a.hl * 2) / 8));
      const strips = new THREE.Group();
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const m = new THREE.Mesh(stripGeo, stripMat);
          m.position.set(((i + 0.5) / cols - 0.5) * a.hw * 2, -SLAB / 2 - 0.03, ((j + 0.5) / rows - 0.5) * a.hl * 2);
          strips.add(m);
        }
      }
      strips.position.set(a.x, f.y, a.z);
      strips.rotation.y = a.rot;
      add(strips, f.y, false);
    }
  }
  for (const r of surfaces.ramps) {
    const y0 = surfaces.floorHeight(r.from) ?? 0;
    const y1 = surfaces.floorHeight(r.to) ?? 0;
    const angle = Math.atan2(y1 - y0, r.l);
    const len = Math.hypot(r.l, y1 - y0);
    const pivot = new THREE.Group(); // at the middle of the surface, tilted along the ramp
    pivot.position.set(r.x, (y0 + y1) / 2, r.z);
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = r.rot;
    pivot.rotation.x = -angle;
    const slabGeo = new THREE.BoxGeometry(r.w, SLAB, len);
    tileBoxUV(slabGeo, TILE_M);
    const slab = new THREE.Mesh(slabGeo, deckMat);
    slab.position.y = -SLAB / 2;
    pivot.add(slab);
    for (const sx of [-1, 1]) {
      const sideGeo = new THREE.BoxGeometry(0.3, 0.6, len);
      tileBoxUV(sideGeo, TILE_M);
      const side = new THREE.Mesh(sideGeo, curbMat);
      side.position.set(sx * (r.w / 2 + 0.15), 0.3 - SLAB / 2, 0);
      pivot.add(side);
    }
    add(pivot, Math.min(y0, y1), true);
    // A sign on each floor just before the ramp, facing the way the car drives onto it.
    for (const end of [0, 1]) {
      const toId = end === 0 ? r.to : r.from;
      const floorId = end === 0 ? r.from : r.to;
      const up = (surfaces.floorHeight(toId) ?? 0) > (surfaces.floorHeight(floorId) ?? 0);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), signMat(rampSignText(def, toId, up)));
      sign.rotation.x = -Math.PI / 2;
      sign.rotation.z = Math.PI;
      const holder = new THREE.Group();
      const dist = r.l / 2 + 2.6;
      const dir = end === 0 ? -1 : 1;
      const [sin, cos] = [Math.sin(r.rot), Math.cos(r.rot)];
      const fy = surfaces.floorHeight(floorId) ?? 0;
      holder.position.set(r.x + sin * dist * dir, fy + 0.03, r.z + cos * dist * dir);
      holder.rotation.y = r.rot + (end === 0 ? 0 : Math.PI);
      holder.add(sign);
      add(holder, fy, false);
    }
  }
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
  const multi = def.floors !== undefined;
  const hasBasement = multi && def.floors!.some((f) => f.y < 0);
  if (!hasBasement) group.add(grass);

  const lotMat = surfaceMaterial('asphalt');
  const lotGeo = new THREE.PlaneGeometry(w + 1.2, l + 1.2);
  const uv = lotGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (w + 1.2)) / TILE_M, (uv.getY(i) * (l + 1.2)) / TILE_M);
  const lot = new THREE.Mesh(lotGeo, lotMat);
  lot.rotation.x = -Math.PI / 2;
  lot.receiveShadow = true;
  if (!hasBasement) group.add(lot);

  for (const b of def.bays ?? []) group.add(decorBay(b));
  for (const a of def.arrows ?? []) group.add(roadArrow(a));
  const surfaces = new Surfaces(def);
  // Everything tied to a floor is tracked with its height so the top-down view can hide floors above the car.
  const tracked: THREE.Object3D[] = [];
  const solids: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D, y: number, solid: boolean): void => {
    o.userData.layerY = y;
    group.add(o);
    tracked.push(o);
    if (solid) solids.push(o);
  };
  if (multi) buildStoreys(def, surfaces, add);
  const cones = new Map<number, ObstacleDef[]>(); // by floor height
  for (const o of levelObstacleDefs(def, surfaces)) {
    const layer = o.floor ?? surfaces.startLayer;
    if (multi && surfaces.floorHeight(layer) === null && o.kind === 'wall') continue; // ramp kerbs are part of the ramp mesh
    const y = surfaces.heightAt(layer, o.x, o.z);
    if (o.kind === 'cone') {
      const at = cones.get(y) ?? [];
      at.push(o);
      cones.set(y, at);
      continue;
    }
    const mesh = obstacleMesh(o, y);
    if (multi) add(mesh, y, o.kind === 'pillar' || (o.kind === 'wall' && (o.h ?? 1.2) >= 1.5));
    else group.add(mesh);
  }
  // Cones on a floor share two instanced meshes (body+base, stripe): 2 draw calls instead of 3 per cone.
  for (const [y, list] of cones) {
    const body = new THREE.InstancedMesh(coneBodyGeo, coneMat, list.length);
    const stripe = new THREE.InstancedMesh(coneStripeGeo, coneStripe, list.length);
    const m = new THREE.Matrix4();
    list.forEach((o, i) => {
      m.makeRotationY(o.rot ?? 0).setPosition(o.x, y, o.z);
      body.setMatrixAt(i, m);
      stripe.setMatrixAt(i, m);
    });
    for (const mesh of [shadowed(body), shadowed(stripe)]) {
      if (multi) add(mesh, y, false);
      else group.add(mesh);
    }
  }

  // Target bay: translucent fill, glowing edges, direction arrow, floating marker.
  const t = def.target;
  const bayGroup = new THREE.Group();
  const bayY = surfaces.heightAt(t.floor ?? surfaces.startLayer, t.x, t.z);
  bayGroup.position.set(t.x, bayY, t.z);
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
  if (multi) add(bayGroup, bayY, false);
  else group.add(bayGroup);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffa31a, emissiveIntensity: 0.8 }),
  );
  const markerY = multi ? bayY + 2.2 : 3.2;
  marker.position.set(t.x, markerY, t.z);
  group.add(marker);

  // Scenery: trees, lamp posts, fence, bollards, drains, kerb apron and paint wear, all instanced (one draw call each).
  const detail = detailLayout(def, index, !multi);
  for (const [geo, mat, lift] of [
    [trunkGeo, trunkMat, 0.8],
    [leafGeo, leafMat, 2.9],
  ] as const) {
    const im = instanced(
      geo,
      mat,
      detail.trees.map((t) => ({ ...t, y: lift * t.scale, sx: t.scale, sy: t.scale, sz: t.scale })),
    );
    im.userData.decor = true;
    group.add(shadowed(im));
  }
  group.add(
    instanced(
      wearGeo,
      wearMat,
      detail.wear.map((w) => ({ ...w, sx: w.w, sz: w.l })),
    ),
  );
  if (!multi) {
    const poles = detail.poles;
    for (const [geo, mat] of [
      [poleGeo, poleMat],
      [armGeo, poleMat],
      [lampGeo, lampMat],
    ] as const) {
      const im = instanced(geo, mat, poles);
      im.userData.decor = true;
      group.add(shadowed(im));
    }
    group.add(instanced(postGeo, fenceMat, detail.posts));
    group.add(
      instanced(
        railGeo,
        fenceMat,
        detail.rails.map((r) => ({ ...r, sz: r.l })),
      ),
    );
    group.add(shadowed(instanced(bollardGeo, bollardMat, detail.bollards)));
    group.add(instanced(drainGeo, drainMat, detail.drains));
    // Raised kerb apron round the lot, outside the walls (the walls themselves are the collision shape).
    const apronH = 0.12;
    const out = WALL_T + APRON_W / 2;
    for (const [x, z, aw, al] of [
      [0, l / 2 + out, w + 2 * (WALL_T + APRON_W), APRON_W],
      [0, -l / 2 - out, w + 2 * (WALL_T + APRON_W), APRON_W],
      [w / 2 + out, 0, APRON_W, l],
      [-w / 2 - out, 0, APRON_W, l],
    ] as const) {
      const geo = new THREE.BoxGeometry(aw, apronH, al);
      tileBoxUV(geo, TILE_M);
      const m = new THREE.Mesh(geo, curbMat);
      m.position.set(x, apronH / 2 - 0.02, z);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  return {
    def,
    group,
    obstacles: levelObstacles(def, surfaces),
    surfaces,
    bay: bayOBB(t),
    bayFill,
    bayEdge,
    marker,
    markerY,
    solids: multi ? solids : [],
    setView(carY, topDown) {
      for (const o of tracked) o.visible = floorShown(o.userData.layerY as number, carY, topDown);
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
        if (!CAR_SHARED.has(m.geometry) && !sharedGeo.has(m.geometry)) m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (!shared.has(mat) && !CAR_SHARED.has(mat)) mat.dispose();
      });
    },
  };
}
