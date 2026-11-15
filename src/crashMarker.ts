import * as THREE from 'three';
import type { Hit } from './crash';

const RED = 0xff3b30;
const HIGHLIGHT_H = 1.3;

/**
 * The crash marker: a pulsing ring and X on the ground at the contact point, and a red box around the obstacle
 * that was hit. Owns its geometries and materials; dispose() removes it and frees them.
 */
export class CrashMarker {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(hit: Hit, y: number) {
    const mat = (m: THREE.Material): THREE.Material => (this.mats.push(m), m);
    const geo = <T extends THREE.BufferGeometry>(g: T): T => (this.geos.push(g), g);
    const ground = (color: number, opacity: number): THREE.Material =>
      mat(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );

    const at = new THREE.Group();
    at.position.set(hit.x, y + 0.08, hit.z);
    this.ring = new THREE.Mesh(geo(new THREE.RingGeometry(0.7, 0.95, 40)), ground(RED, 0.95));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 999;
    at.add(this.ring);
    const bar = geo(new THREE.PlaneGeometry(1.5, 0.22));
    const xMat = ground(0xffffff, 1);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const m = new THREE.Mesh(bar, xMat);
      m.rotation.set(-Math.PI / 2, 0, a);
      m.renderOrder = 1000;
      at.add(m);
    }
    this.group.add(at);

    const o = hit.obstacle;
    const box = geo(new THREE.BoxGeometry(o.hw * 2, HIGHLIGHT_H, o.hl * 2));
    const fill = new THREE.Mesh(
      box,
      mat(new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.3, depthWrite: false })),
    );
    const edges = geo(new THREE.EdgesGeometry(box));
    const lines = new THREE.LineSegments(edges, mat(new THREE.LineBasicMaterial({ color: RED, depthTest: false })));
    lines.renderOrder = 998;
    const hl = new THREE.Group();
    hl.add(fill, lines);
    hl.position.set(o.x, y + HIGHLIGHT_H / 2, o.z);
    hl.rotation.y = o.rot;
    this.group.add(hl);
  }

  /** Pulse the ring (time in ms); a still ring with reduced motion. */
  tick(now: number, reduced: boolean): void {
    this.ring.scale.setScalar(reduced ? 1 : 1 + 0.25 * Math.sin(now / 160));
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
  }
}
