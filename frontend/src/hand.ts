import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HandModel } from './hand-model';
import { HandContactSolver, MAX_ANGULAR_SPEED, type ContactState } from './hand-contact';
import type { PlanningRequest, PlanningResponse } from './hand-planner.worker';
export type HandView = 'front' | 'palm' | 'side' | 'top' | 'perspective';

export class HandScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly mechanism = new HandModel();
  private readonly model = this.mechanism.model;
  private readonly targetAngles = [0, 0, 0, 0, 0];
  private readonly axes = new THREE.AxesHelper(2);
  private readonly focus = new THREE.Vector3(-0.16, 0.01, 0);
  private readonly resizeObserver: ResizeObserver;
  private readonly environment: THREE.WebGLRenderTarget;
  private cameraDestination: THREE.Vector3 | null = null;
  private currentView: HandView = 'perspective';
  private speed = 1;
  private zoom = 1;
  private raf = 0;
  private lastFrame = 0;
  private disposed = false;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private solver: HandContactSolver | null = null;
  private planner: Worker | null = null;
  private planningRevision = 0;
  private planning = false;
  private planningFailed = false;
  private coordinated = true;
  private waypoints: number[][] = [];
  private yieldedFingers: number[] = [];
  private stalledFor = 0;
  private replans = 0;
  private transitionLabel = '';
  readonly ready: Promise<void>;
  onMotion: ((state: ContactState) => void) | null = null;
  private lastMotionUpdate = 0;
  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.91;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.renderer.domElement.setAttribute('aria-label', 'Prótesis de mano articulada 3D. Arrastra para girar y usa la rueda para acercar.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);
    const environmentScene = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environment = generator.fromScene(environmentScene, 0.05);
    this.scene.environment = this.environment.texture;
    environmentScene.dispose();
    generator.dispose();
    this.scene.add(new THREE.HemisphereLight('#e2eaf0', '#30353c', 0.75));
    const key = new THREE.DirectionalLight('#fff4e6', 3.0);
    key.position.set(-4, 7, -6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.normalBias = 0.018;
    key.shadow.bias = -0.0001;
    key.shadow.radius = 3;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#bcd6e6', 1.35);
    fill.position.set(5, 2, -3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#c6e8f2', 2.35);
    rim.position.set(-2, 4, 5);
    this.scene.add(rim);
    this.model.rotation.z = -0.055;
    this.scene.add(this.model);
    this.buildFloor();
    this.axes.position.set(0, -3.11, 0);
    this.axes.visible = false;
    this.model.add(this.axes);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.focus);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 5.5;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI - 0.08;
    this.controls.addEventListener('start', () => { this.cameraDestination = null; });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.camera.position.copy(this.viewPosition(this.currentView));
    this.controls.update();
    this.ready = HandContactSolver.create(this.mechanism.collisionParts, angles => this.mechanism.applyPose(angles)).then(solver => {
      if (this.disposed) { solver.dispose(); return; }
      this.solver = solver;
      this.onMotion?.(solver.getState());
    });
    this.animate(0);
  }

  /** Continuous controls, ordered thumb, index, middle, ring, little: 0° open, 90° closed. */
  setAngles(angles: readonly number[]): void {
    this.cancelPlanning();
    for (let i = 0; i < 5; i++) {
      if (typeof angles[i] === 'number' && Number.isFinite(angles[i])) {
        this.targetAngles[i] = THREE.MathUtils.clamp(angles[i], 0, 90);
      }
    }
  }

  setPosture(angles: readonly number[]): void {
    this.setAngles(angles);
  }

  /** Manual testing may yield obstructing fingers. Live model output stays direct. */
  setCoordinatedControl(enabled: boolean): void {
    if (this.coordinated === enabled) return;
    this.coordinated = enabled;
    this.cancelPlanning();
  }

  private cancelPlanning(): void {
    this.planningRevision++;
    this.planner?.postMessage({ revision: this.planningRevision, cancel: true } satisfies PlanningRequest);
    this.planning = false;
    this.planningFailed = false;
    this.waypoints = [];
    this.yieldedFingers = [];
    this.stalledFor = 0;
    this.replans = 0;
    this.transitionLabel = '';
  }

  private requestClearanceRoute(): void {
    if (!this.solver || this.planning || this.planningFailed || !this.coordinated) return;
    if (++this.replans > 3) {
      this.planningFailed = true;
      this.transitionLabel = 'No se encontró un paso libre. Selecciona otra postura.';
      return;
    }
    this.planning = true;
    this.waypoints = [];
    this.transitionLabel = 'Calculando qué dedo debe ceder el paso…';
    try {
      if (!this.planner) {
        this.planner = new Worker(new URL('./hand-planner.worker.ts', import.meta.url), { type: 'module' });
        this.planner.onmessage = (event: MessageEvent<PlanningResponse>) => {
          if (this.disposed || event.data.revision !== this.planningRevision) return;
          this.planning = false;
          this.stalledFor = 0;
          const plan = event.data.plan;
          if (!plan?.reached || event.data.error) {
            this.planningFailed = true;
            this.transitionLabel = event.data.error ? 'No se pudo calcular el despeje. Selecciona otra postura.' :
              'No se encontró un paso libre. Selecciona otra postura.';
            if (event.data.error) console.error('Hand coordination:', event.data.error);
            return;
          }
          this.waypoints = plan.waypoints.map(angles => [...angles]);
          this.yieldedFingers = plan.yieldedFingers;
        };
        this.planner.onerror = event => {
          console.error('Hand coordination worker:', event.message);
          this.planning = false;
          this.planningFailed = true;
          this.transitionLabel = 'No se pudo calcular el despeje. Selecciona otra postura.';
          this.planner?.terminate();
          this.planner = null;
        };
      }
      this.planner.postMessage({ revision: ++this.planningRevision,
        from: this.solver.getState().achieved, target: [...this.targetAngles] } satisfies PlanningRequest);
    } catch (error) {
      console.error(error);
      this.planning = false;
      this.planningFailed = true;
      this.transitionLabel = 'No se pudo calcular el despeje. Selecciona otra postura.';
    }
  }

  getTransitionLabel(): string { return this.transitionLabel; }

  setView(view: HandView): void {
    this.currentView = view;
    this.cameraDestination = null;
    this.camera.position.copy(this.viewPosition(view));
    this.controls.update();
  }

  setWireframe(visible: boolean): void { this.mechanism.setWireframe(visible); }
  setSkeleton(visible: boolean): void { this.mechanism.setSkeleton(visible); }
  setAxes(visible: boolean): void { this.axes.visible = visible; }
  getMotionState(): ContactState | null { return this.solver?.getState() ?? null; }
  setSpeed(speed: number): void {
    if (Number.isFinite(speed)) this.speed = THREE.MathUtils.clamp(speed, 0.1, 4);
  }
  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) return;
    const next = THREE.MathUtils.clamp(zoom, 0.6, 1.8);
    const direction = (this.cameraDestination ?? this.camera.position).clone().sub(this.focus).multiplyScalar(this.zoom / next);
    this.zoom = next;
    this.cameraDestination = this.focus.clone().add(direction);
  }

  setMode(mode: 'human' | 'robotic'): void { this.mechanism.setMode(mode); }

  resize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const previousAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.camera.position.lengthSq() > 1 && Math.abs(previousAspect - this.camera.aspect) > 0.12) {
      this.cameraDestination = this.viewPosition(this.currentView);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.planner?.terminate();
    this.solver?.dispose();
    this.mechanism.collisionParts.forEach(part => part.geometry.dispose());
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private viewPosition(view: HandView): THREE.Vector3 {
    const directions: Record<HandView, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0.03, -1), palm: new THREE.Vector3(-0.18, 0.1, 1), side: new THREE.Vector3(-1, 0.07, -0.08),
      top: new THREE.Vector3(0, 1, -0.08), perspective: new THREE.Vector3(-0.44, 0.24, -1),
    };
    const distance = 14.2 * Math.max(1, 0.68 / this.camera.aspect) / this.zoom;
    return directions[view].normalize().multiplyScalar(distance).add(this.focus);
  }

  private buildFloor(): void {
    const grid = new THREE.GridHelper(22, 32, '#315366', '#21394c');
    grid.position.y = -3.3;
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach(material => { material.transparent = true; material.opacity = 0.16; material.depthWrite = false; });
    this.scene.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(25, 25), new THREE.ShadowMaterial({ opacity: 0.21 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.31;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.43, 1.438, 100), new THREE.MeshBasicMaterial({
      color: '#4b8ea5', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -3.285;
    this.scene.add(halo);
  }

  private animate = (time: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const dt = this.lastFrame === 0 ? 1 / 60 : Math.min((time - this.lastFrame) / 1000, 0.05);
    this.lastFrame = time;
    if (this.solver) {
      const before = this.solver.getState().achieved;
      while (this.waypoints.length && this.waypoints[0].every((angle, i) => Math.abs(angle - before[i]) < 0.0005)) this.waypoints.shift();
      let command = this.targetAngles;
      if (this.planning) command = before;
      else if (this.waypoints.length) {
        const waypoint = this.waypoints[0];
        const largest = Math.max(...waypoint.map((angle, i) => Math.abs(angle - before[i])));
        const fraction = Math.min(1, MAX_ANGULAR_SPEED * Math.min(dt * this.speed, 0.05) / largest);
        command = waypoint.map((angle, i) => before[i] + (angle - before[i]) * fraction);
        const names = ['Pulgar', 'Índice', 'Medio', 'Anular', 'Meñique'];
        this.transitionLabel = this.yieldedFingers.length ? 'Cediendo el paso · ' + this.yieldedFingers.map(i => names[i]).join(', ') : 'Retomando la postura solicitada';
      } else if (!this.planningFailed) this.transitionLabel = '';
      const state = this.solver.step(command, dt * this.speed);
      const progress = Math.max(...state.achieved.map((angle, i) => Math.abs(angle - before[i])));
      const needsMotion = this.targetAngles.some((angle, i) => Math.abs(angle - state.achieved[i]) > 0.05);
      if (this.coordinated && !this.planning && !this.planningFailed && needsMotion) {
        this.stalledFor = progress < 0.002 ? this.stalledFor + dt : 0;
        if (this.stalledFor > 0.18) this.requestClearanceRoute();
      } else this.stalledFor = 0;
      if (time - this.lastMotionUpdate >= 80 || this.lastMotionUpdate === 0) {
        this.onMotion?.(state);
        this.lastMotionUpdate = time;
      }
    }
    if (this.cameraDestination) {
      this.camera.position.lerp(this.cameraDestination, this.reducedMotion ? 1 : 1 - Math.exp(-dt * 8));
      if (this.camera.position.distanceToSquared(this.cameraDestination) < 0.0001) this.cameraDestination = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
