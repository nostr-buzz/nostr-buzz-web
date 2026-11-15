import * as THREE from 'three';

import { BUZZ_EVENT } from '@/contexts/BuzzContext';

/**
 * The nostr.buzz bee, rebuilt in three.js from the brand logo's proportions
 * (side view: round striped body, head top-right with one white eye, curled
 * antenna, two wings top-left, chat-bubble stinger bottom-left) and rendered
 * like a glossy vinyl toy in a soft photo studio.
 *
 * Animations: fluttering wings, hover + sway, blinking eye, head that glances
 * around / follows the pointer, wobbling antenna and an excited "buzz" mode.
 */

export interface BeeSceneOptions {
  /** Follow the pointer with the head and buzz on click. */
  interactive?: boolean;
  /** Render a single still frame (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Called after the first frame has been drawn. */
  onReady?: () => void;
}

const COLORS = {
  black: '#36363b',
  yellow: '#f6b10a',
  wing: '#eeeef0',
  eye: '#ffffff',
};

/**
 * Logo layout in "body units" (body radius = 1, x right, y up, z towards the viewer),
 * measured from the brand artwork.
 */
const LAYOUT = {
  head: { center: new THREE.Vector3(0.69, 1.17, 0.32), radius: 0.56 },
  eye: { spread: 42, lift: 0.36, size: new THREE.Vector3(0.1, 0.122, 0.04) },
  /** Resting head turn towards the viewer, so the near eye lands where it is in the logo. */
  headYaw: -0.42,
  stingerDirection: new THREE.Vector2(-0.58, -0.82),
  /** Stripes are slices perpendicular to this axis (tilted 32° towards the head, like the logo). */
  stripeAxis: new THREE.Vector3(0.53, 0.85, 0).normalize(),
  /** [yellow band 1 from, to, yellow band 2 from, to] along the stripe axis, measured from the logo. */
  bands: new THREE.Vector4(0.19, 0.6, -0.66, -0.26),
};

interface Wing {
  pivot: THREE.Group;
  twist: THREE.Group;
  baseZ: number;
  phase: number;
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function shadowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2d(256, 256);
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.5, 'rgba(0,0,0,0.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

/** A small HDR photo studio (gradient dome + softboxes), used only for reflections. */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const dome = new THREE.SphereGeometry(20, 64, 32);
  const colors: number[] = [];
  const bottom = new THREE.Color('#151517');
  const horizon = new THREE.Color('#5a5754');
  const top = new THREE.Color('#c9c7c3');
  const position = dome.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const t = position.getY(i) / 20;
    const color = t < 0 ? bottom.clone().lerp(horizon, 1 + t) : horizon.clone().lerp(top, t);
    colors.push(color.r, color.g, color.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const softbox = (w: number, h: number, color: string, intensity: number, pos: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    panel.position.set(...pos);
    panel.lookAt(0, 0, 0);
    env.add(panel);
  };
  softbox(10, 7, '#ffffff', 5, [-7, 8, 9]); // key, top-front-left (like the logo)
  softbox(6, 8, '#ffffff', 1.6, [11, 1, 6]); // fill, right
  softbox(12, 2.5, '#ffffff', 2.4, [0, 13, 0]); // top strip
  softbox(3, 10, '#ffc34d', 2.2, [8, 2, -9]); // warm rim, back-right
  return env;
}

/** Glossy black/yellow stripes computed per pixel, so bands stay straight and evenly wide. */
function stripedBodyMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.42,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStripeAxis = { value: LAYOUT.stripeAxis };
    shader.uniforms.uBands = { value: LAYOUT.bands };
    shader.uniforms.uBlack = { value: new THREE.Color(COLORS.black) };
    shader.uniforms.uYellow = { value: new THREE.Color(COLORS.yellow) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBeeObjectPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeeObjectPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vBeeObjectPosition;',
          'uniform vec3 uStripeAxis;',
          'uniform vec4 uBands;',
          'uniform vec3 uBlack;',
          'uniform vec3 uYellow;',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          'float beeS = dot(normalize(vBeeObjectPosition), uStripeAxis);',
          'float beeAA = max(fwidth(beeS) * 1.5, 0.002);',
          'float beeBand1 = smoothstep(uBands.x - beeAA, uBands.x + beeAA, beeS) * (1.0 - smoothstep(uBands.y - beeAA, uBands.y + beeAA, beeS));',
          'float beeBand2 = smoothstep(uBands.z - beeAA, uBands.z + beeAA, beeS) * (1.0 - smoothstep(uBands.w - beeAA, uBands.w + beeAA, beeS));',
          'diffuseColor.rgb *= mix(uBlack, uYellow, clamp(beeBand1 + beeBand2, 0.0, 1.0));',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'nostr-buzz-bee-stripes';
  return material;
}

export class BeeScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(16, 1, 0.1, 200);
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envTarget: THREE.WebGLRenderTarget;

  private readonly hover = new THREE.Group();
  private readonly bee = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly antenna = new THREE.Group();
  /** Near eye (always visible) and far eye (shows when the head turns towards the viewer). */
  private readonly eyes: THREE.Group[] = [];
  private readonly wings: Wing[] = [];
  private readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly frameCenter = new THREE.Vector3();
  private frameRadius = 2.5;

  private readonly pointer = new THREE.Vector2();
  private readonly look = new THREE.Vector2();
  private readonly glance = new THREE.Vector2();
  private pointerActiveUntil = 0;
  private nextGlance = 0;
  private nextBlink = 0;
  private blinkStart = -1;
  private doubleBlink = false;
  private excitedUntil = 0;

  private frame = 0;
  private running = false;
  private readyFired = false;
  private readonly start = performance.now();
  private readonly options: BeeSceneOptions;

  constructor(canvas: HTMLCanvasElement, options: BeeSceneOptions = {}) {
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = studioEnvironment();
    this.envTarget = this.pmrem.fromScene(env, 0.04);
    env.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 1.15;

    this.addLights();
    this.buildBee();
    this.scene.add(this.hover);
    this.hover.add(this.bee);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.5 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.frameModel();

    this.nextBlink = 1500 + Math.random() * 1500;
    this.nextGlance = 1600;

    window.addEventListener(BUZZ_EVENT, this.buzz);
    if (options.interactive) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      canvas.addEventListener('click', this.buzz);
    }
  }

  /* ------------------------------------------------------------------ */
  /*                               model                                */
  /* ------------------------------------------------------------------ */

  private addLights() {
    // Soft key from the top-left, like the logo, casting gentle self-shadows.
    const key = new THREE.DirectionalLight('#fffaf0', 1.5);
    key.position.set(-3.5, 5.5, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3.2;
    key.shadow.camera.bottom = -3;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.04;
    key.shadow.radius = 6;

    const fill = new THREE.DirectionalLight('#ffffff', 0.7);
    fill.position.set(5, 0, 5);
    const rim = new THREE.DirectionalLight('#ffd27a', 1.4);
    rim.position.set(4, 3, -6);
    const ambient = new THREE.HemisphereLight('#ffffff', '#4a3a1c', 0.6);
    this.scene.add(key, fill, rim, ambient);
  }

  private buildBee() {
    // Soft satin plastic, like the logo render (gentle highlights, no mirror shine).
    const vinyl = (color: string, roughness: number) =>
      new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 0.22, clearcoatRoughness: 0.45 });
    const black = vinyl(COLORS.black, 0.56);
    const solid = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    // Body
    const body = solid(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), stripedBodyMaterial()));
    body.scale.set(1, 1, 0.94);
    this.bee.add(body);

    // Stinger: a pointed chat-bubble tail at the bottom-left that hooks slightly downwards
    // (profile runs bottom → top so normals face outwards).
    const stingerProfile = [
      new THREE.Vector2(0, -0.62),
      new THREE.Vector2(0.02, -0.6),
      new THREE.Vector2(0.07, -0.5),
      new THREE.Vector2(0.15, -0.35),
      new THREE.Vector2(0.25, -0.17),
      new THREE.Vector2(0.34, 0.02),
      new THREE.Vector2(0.4, 0.2),
    ];
    const stingerGeometry = new THREE.LatheGeometry(stingerProfile, 64);
    const stingerPositions = stingerGeometry.getAttribute('position');
    for (let i = 0; i < stingerPositions.count; i++) {
      const depth = Math.max(0, -stingerPositions.getY(i));
      stingerPositions.setX(i, stingerPositions.getX(i) - depth * depth * 0.28);
    }
    stingerGeometry.computeVertexNormals();
    const stinger = solid(new THREE.Mesh(stingerGeometry, black));
    const stingerDirection = new THREE.Vector3(LAYOUT.stingerDirection.x, LAYOUT.stingerDirection.y, 0).normalize();
    stinger.position.copy(stingerDirection.clone().multiplyScalar(0.78));
    stinger.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), stingerDirection);
    this.bee.add(stinger);

    // Head
    this.head.position.copy(LAYOUT.head.center);
    const skull = solid(new THREE.Mesh(new THREE.SphereGeometry(LAYOUT.head.radius, 96, 64), vinyl(COLORS.black, 0.52)));
    this.head.add(skull);
    this.bee.add(this.head);

    // Eyes: the logo's white ovals, one on each side of the face. In the logo pose only the
    // near one shows; when the head turns towards the viewer both become visible.
    const eyeMaterial = new THREE.MeshPhysicalMaterial({
      color: COLORS.eye,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: '#ffffff',
      emissiveIntensity: 0.12,
    });
    const eyeGeometry = new THREE.SphereGeometry(1, 48, 32);
    for (const side of [1, -1]) {
      // Eyes sit ±42° either side of the face's centre line (+x), slightly above it.
      const angle = THREE.MathUtils.degToRad(LAYOUT.eye.spread) * side;
      const direction = new THREE.Vector3(Math.cos(angle), LAYOUT.eye.lift, Math.sin(angle)).normalize();
      const eye = new THREE.Group();
      eye.position.copy(direction.clone().multiplyScalar(LAYOUT.head.radius - 0.01));
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      const white = new THREE.Mesh(eyeGeometry, eyeMaterial);
      white.scale.copy(LAYOUT.eye.size);
      eye.add(white);
      this.head.add(eye);
      this.eyes.push(eye);
    }

    // Antenna: one thick stalk leaning back from the top of the head, with a round tip.
    const base = new THREE.Vector3(-0.18, 0.46, 0.05);
    this.antenna.position.copy(base);
    const curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-0.18, 0.42, 0.05),
        new THREE.Vector3(-0.25, 0.62, 0.05),
        new THREE.Vector3(-0.26, 0.8, 0.05),
        new THREE.Vector3(-0.16, 0.92, 0.05),
        new THREE.Vector3(-0.03, 0.9, 0.05),
      ].map((point) => point.sub(base)),
    );
    const stalk = solid(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.096, 28), black));
    const tip = solid(new THREE.Mesh(new THREE.SphereGeometry(0.108, 32, 24), black));
    tip.position.copy(curve.getPoint(1));
    this.antenna.add(stalk, tip);
    this.head.add(this.antenna);

    // Two wings behind the head: a large one pointing up-left and a smaller one pointing left.
    const wingMaterial = new THREE.MeshPhysicalMaterial({
      color: COLORS.wing,
      roughness: 0.42,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      sheen: 0.5,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color('#ffffff'),
      side: THREE.DoubleSide,
    });
    const wingGeometry = new THREE.SphereGeometry(1, 64, 48);
    const makeWing = (hinge: THREE.Vector3, angle: number, length: number, width: number, phase: number) => {
      const pivot = new THREE.Group();
      pivot.position.copy(hinge);
      pivot.rotation.set(0, 0.12, angle);
      const twist = new THREE.Group();
      const blade = new THREE.Mesh(wingGeometry, wingMaterial);
      blade.castShadow = true;
      blade.receiveShadow = true;
      blade.scale.set(width / 2, length / 2, 0.1);
      blade.position.y = length / 2;
      twist.add(blade);
      pivot.add(twist);
      this.bee.add(pivot);
      this.wings.push({ pivot, twist, baseZ: angle, phase });
    };
    // Lower wing peeks out from behind the body; the big upper wing sits in front of its edge.
    makeWing(new THREE.Vector3(-0.35, 0.9, 0.02), 1.22, 1.02, 0.46, 0.7);
    makeWing(new THREE.Vector3(-0.03, 0.9, 0.46), 0.73, 1.6, 0.76, 0);
  }

  /** Centre the camera on the model and fit it (plus hover room) in view. */
  private frameModel() {
    this.hover.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.bee);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.frameCenter.copy(sphere.center);
    this.frameRadius = sphere.radius * 0.98 + 0.1;
    this.shadow.position.set(sphere.center.x - 0.1, box.min.y - 0.3, 0);
    this.updateCamera();
  }

  private updateCamera() {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitHeight = this.frameRadius / Math.sin(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitWidth = this.frameRadius / Math.sin(hFov / 2);
    const distance = Math.max(fitHeight, fitWidth);
    this.camera.position.set(this.frameCenter.x, this.frameCenter.y, this.frameCenter.z + distance);
    this.camera.lookAt(this.frameCenter);
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------ */
  /*                             lifecycle                              */
  /* ------------------------------------------------------------------ */

  setSize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.updateCamera();
    if (!this.running) this.renderFrame(performance.now());
  }

  play() {
    if (this.running || this.options.reducedMotion) {
      this.renderFrame(performance.now());
      return;
    }
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.renderFrame(now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Get excited: faster wings, wide eye and a little shake. */
  buzz = () => {
    this.excitedUntil = performance.now() - this.start + 1500;
    if (!this.running) this.play();
  };

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = (event.clientX - (rect.left + rect.width / 2)) / Math.max(rect.width, 320);
    const y = (event.clientY - (rect.top + rect.height / 2)) / Math.max(rect.height, 320);
    this.pointer.set(THREE.MathUtils.clamp(x, -1.5, 1.5), THREE.MathUtils.clamp(y, -1.5, 1.5));
    this.pointerActiveUntil = performance.now() - this.start + 2500;
  };

  private renderFrame(now: number) {
    const t = (now - this.start) / 1000;
    const ms = now - this.start;
    const still = !!this.options.reducedMotion;
    const excitement = still ? 0 : THREE.MathUtils.clamp((this.excitedUntil - ms) / 1500, 0, 1);

    if (!still) {
      // Gentle hover, sway and a hint of squash & stretch.
      const bob = Math.sin(t * 1.8) * 0.09;
      this.hover.position.y = bob;
      this.hover.rotation.z = Math.sin(t * 1.2) * 0.04;
      this.hover.rotation.y = Math.sin(t * 0.7) * 0.12;
      this.hover.position.x = excitement > 0 ? Math.sin(t * 68) * 0.07 * excitement : 0;
      const stretch = 1 + Math.cos(t * 1.8) * 0.01;
      this.bee.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
      this.shadow.scale.setScalar(1 - bob);
      this.shadow.material.opacity = 0.45 - bob;

      // Wings: a fast in-plane beat plus a twist that catches the light.
      const speed = 40 + excitement * 40;
      const swing = 0.2 + excitement * 0.12;
      for (const wing of this.wings) {
        const beat = Math.sin(t * speed + wing.phase);
        wing.pivot.rotation.z = wing.baseZ + beat * swing;
        wing.twist.rotation.y = beat * 0.55;
      }

      // Antenna wobble lags behind the hover.
      this.antenna.rotation.z = Math.sin(t * 2.4 - 0.8) * 0.09 + excitement * Math.sin(t * 42) * 0.12;

      // Look at the pointer while it moves, otherwise glance around now and then —
      // including turning to face the viewer, which shows both eyes.
      if (ms < this.pointerActiveUntil) {
        this.glance.copy(this.pointer);
      } else if (ms > this.nextGlance) {
        const roll = Math.random();
        if (roll < 0.35) this.glance.set(0.15, 0);
        else if (roll < 0.6) this.glance.set(-1.1, -0.05);
        else this.glance.set(-1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.9);
        this.nextGlance = ms + 1300 + Math.random() * 2400;
      }
      this.look.lerp(this.glance, 0.06);

      if (ms > this.nextBlink && this.blinkStart < 0) {
        this.blinkStart = ms;
        this.doubleBlink = Math.random() < 0.25;
      }
    }

    // The bee faces right: looking right turns the face slightly away, looking left turns it
    // all the way round towards the viewer (up to ~75°), revealing the second eye.
    const yaw = this.look.x >= 0 ? this.look.x * 0.35 : this.look.x * 0.9;
    this.head.rotation.y = LAYOUT.headYaw + THREE.MathUtils.clamp(yaw, -1.0, 0.45);
    this.head.rotation.x = this.look.y * 0.3;
    this.head.rotation.z = -this.look.y * 0.12;

    let lid = 1;
    if (this.blinkStart >= 0) {
      const duration = this.doubleBlink ? 400 : 170;
      const p = (ms - this.blinkStart) / duration;
      if (p >= 1) {
        this.blinkStart = -1;
        this.nextBlink = ms + 2000 + Math.random() * 3200;
      } else {
        const phase = this.doubleBlink ? (p * 2) % 1 : p;
        lid = 1 - Math.sin(phase * Math.PI) * 0.92;
      }
    }
    const wide = excitement > 0.2 ? 1.25 : 1;
    for (const eye of this.eyes) eye.scale.set(wide, lid * wide, 1);

    this.renderer.render(this.scene, this.camera);

    if (!this.readyFired) {
      this.readyFired = true;
      this.options.onReady?.();
    }
  }

  dispose() {
    this.pause();
    window.removeEventListener(BUZZ_EVENT, this.buzz);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('click', this.buzz);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      }
    });
    this.envTarget.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
