import * as THREE from 'three';

interface Target {
  y: number;
  x: number;
  z: number;
  heading: number;
}

/**
 * Rear-view mirror: renders the view behind the car into an offscreen target,
 * then draws it flipped left-right (like a real mirror) into the screen area
 * covered by the #mirror frame element.
 */
export class RearMirror {
  readonly el = document.getElementById('mirror')!;
  private readonly camera = new THREE.PerspectiveCamera(24, 3.6, 0.1, 160);
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();

  constructor() {
    const tex = this.target.texture;
    tex.repeat.x = -1; // mirror image
    tex.offset.x = 1;
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: tex, depthTest: false }),
    );
    this.quadScene.add(quad);
  }

  set visible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
    document.body.classList.toggle('has-mirror', v);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Call after the main render; the offscreen target follows the renderer's pixel ratio. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, car: Target): void {
    if (!this.visible) return;
    const rect = this.el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    // Camera above the rear of the roof, looking back and slightly down.
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    this.camera.position.set(car.x - fx * 0.7, car.y + 1.75, car.z - fz * 0.7);
    this.camera.lookAt(car.x - fx * 20, car.y + 0.9, car.z - fz * 20);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();

    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.round(rect.width * pr));
    const h = Math.max(1, Math.round(rect.height * pr));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // Reuse this frame's shadow map instead of rendering it a second time.
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = shadowAuto;

    // Composite into the frame's screen rect (viewport y is measured from the bottom).
    renderer.getSize(this.size);
    const y = this.size.y - rect.bottom;
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.setScissorTest(true);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = autoClear;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
  }
}
