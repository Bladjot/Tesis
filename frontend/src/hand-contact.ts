import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export type CollisionPart = {
  id: string;
  finger: number | null;
  segment: number;
  role: 'shell' | 'shaft' | 'hinge' | 'fixed';
  object: THREE.Object3D;
  geometry: THREE.BufferGeometry;
};
export type ContactPair = { a: string; b: string; distance: number; fingers: number[] };
export type ContactState = {
  requested: number[];
  achieved: number[];
  limited: boolean[];
  contacts: ContactPair[];
  moving: boolean;
};
export type MotionProbe = {
  achieved: number[];
  reached: boolean;
  contacts: ContactPair[];
  limited: boolean[];
  /** Safe poses accepted by the same swept solver used to render motion, including `from`. */
  path: number[][];
  frames: number;
};
export type ContactOptions = {
  /** Upper bound on every collider point's world travel per degree of its finger command. */
  maxPointTravelPerDegree?: number;
};

/** Model units; stop before the smaller conservative-sweep guard, leaving room to release contact. */
export const CONTACT_CLEARANCE = 0.004;
export const SWEEP_CLEARANCE = 0.002;
export const MAX_ANGULAR_SPEED = 120;
export const MAX_SUBSTEP_DEGREES = 0.25;
const ANGLE_EPSILON = 1e-6;
const CONTACT_REPORT_MARGIN = 0.0001;
// Near contact, conservative advancement may need many tiny moves. Carry remaining movement into
// the next animation frame instead of blocking live EMG updates with unbounded collision queries.
const MAX_ADVANCES_PER_FINGER = 24;
let rapierReady: Promise<void> | undefined;

type CachedPart = {
  part: CollisionPart;
  collider: RAPIER.Collider;
  localBounds: THREE.Box3;
  bounds: THREE.Box3;
};
type Pair = { a: CachedPart; b: CachedPart; fingers: number[] };

function exempt(a: CollisionPart, b: CollisionPart): boolean {
  if (a.finger === null && b.finger === null) return true;
  if (a.finger === b.finger) {
    if (a.segment === b.segment) return true;
    if (Math.abs(a.segment - b.segment) === 1) {
      // Only the child's bearing seats on the parent's shaft endpoint. Outer shells,
      // other bearings, and the parent's bearing are distinct material and stay active.
      const parent = a.segment < b.segment ? a : b;
      const child = a.segment < b.segment ? b : a;
      if (parent.role === 'shaft' && (child.role === 'shaft' || child.role === 'hinge')) return true;
    }
  }
  const moving = a.finger === null ? b : a;
  const fixed = a.finger === null ? a : b;
  return fixed.finger === null && moving.segment === 0 && moving.role === 'hinge';
}

function boundsNear(a: THREE.Box3, b: THREE.Box3, distance: number): boolean {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return dx * dx + dy * dy + dz * dz <= distance * distance;
}

/**
 * Contact-constrained kinematics for rigid prosthetic enclosures, not a force/deformation simulation.
 * Cached convex hulls enclose ALL supplied vertices. No mesh decimation can shrink the collision shape.
 * Every accepted advance uses a conservative point-travel bound, followed by a narrow-phase check.
 * The supplied bound must cover the rig's actual kinematics; it is not generic engine CCD for arbitrary
 * user callbacks, changing geometry/scales, external animation, or deforming materials.
 */
export class HandContactSolver {
  private readonly world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  private readonly cached: CachedPart[] = [];
  private readonly pairs: Pair[] = [];
  private readonly byFinger: Pair[][] = Array.from({ length: 5 }, () => []);
  private readonly partsByFinger: CachedPart[][] = Array.from({ length: 5 }, () => []);
  private readonly transformsByFinger: THREE.Object3D[][] = Array.from({ length: 5 }, () => []);
  private readonly blockedPose: ({ direction: number; angles: number[] } | null)[] = [null, null, null, null, null];
  private readonly position = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly achieved = [0, 0, 0, 0, 0];
  private requested = [0, 0, 0, 0, 0];
  private state: ContactState = {
    requested: [0, 0, 0, 0, 0], achieved: [0, 0, 0, 0, 0],
    limited: [false, false, false, false, false], contacts: [], moving: false,
  };
  private disposed = false;

  private constructor(private readonly applyPose: (angles: readonly number[]) => void,
    private readonly pointTravelBound: number) {}

  static async create(parts: CollisionPart[], applyPose: (angles: readonly number[]) => void,
    options: ContactOptions = {}): Promise<HandContactSolver> {
    const bound = options.maxPointTravelPerDegree ?? 0.25;
    if (!Number.isFinite(bound) || bound <= 0) throw new Error('The collision motion bound must be positive and finite.');
    await (rapierReady ??= RAPIER.init());
    const solver = new HandContactSolver(applyPose, bound);
    try {
      solver.initialize(parts);
      return solver;
    } catch (error) {
      solver.dispose();
      throw error;
    }
  }

  private initialize(parts: CollisionPart[]): void {
    if (parts.length === 0) throw new Error('At least one collision part is required.');
    const ids = new Set<string>();
    this.applyPose(this.achieved);
    for (const part of parts) {
      if (!part.id || ids.has(part.id)) throw new Error(`Collision part ID is missing or duplicated: ${part.id}`);
      if (part.finger !== null && (!Number.isInteger(part.finger) || part.finger < 0 || part.finger > 4)) {
        throw new Error(`Invalid finger index for ${part.id}`);
      }
      ids.add(part.id);
      part.object.updateWorldMatrix(true, false);
      part.object.matrixWorld.decompose(this.position, this.orientation, this.scale);
      const attribute = part.geometry.getAttribute('position');
      if (!attribute || attribute.count < 4) throw new Error(`Missing collision vertices: ${part.id}`);
      const vertices = new Float32Array(attribute.count * 3);
      for (let i = 0; i < attribute.count; i++) {
        vertices[i * 3] = attribute.getX(i) * this.scale.x;
        vertices[i * 3 + 1] = attribute.getY(i) * this.scale.y;
        vertices[i * 3 + 2] = attribute.getZ(i) * this.scale.z;
      }
      if (!vertices.every(Number.isFinite)) throw new Error(`Non-finite collision geometry: ${part.id}`);
      const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
      if (!descriptor) throw new Error(`Could not construct a solid convex hull: ${part.id}`);
      descriptor.setTranslation(this.position.x, this.position.y, this.position.z).setRotation(this.orientation);
      const collider = this.world.createCollider(descriptor);
      part.geometry.computeBoundingBox();
      const localBounds = part.geometry.boundingBox!.clone();
      const cached = { part, collider, localBounds, bounds: localBounds.clone().applyMatrix4(part.object.matrixWorld) };
      this.cached.push(cached);
      if (part.finger !== null) this.partsByFinger[part.finger].push(cached);
    }
    // Update each ancestor only once per candidate, and never traverse decorative descendants.
    for (let finger = 0; finger < 5; finger++) {
      const objects = new Set<THREE.Object3D>();
      const addAncestors = (object: THREE.Object3D): void => {
        if (objects.has(object)) return;
        if (object.parent) addAncestors(object.parent);
        objects.add(object);
      };
      this.partsByFinger[finger].forEach(cached => addAncestors(cached.part.object));
      this.transformsByFinger[finger] = [...objects];
    }
    for (let i = 0; i < this.cached.length; i++) for (let j = i + 1; j < this.cached.length; j++) {
      const a = this.cached[i], b = this.cached[j];
      if (exempt(a.part, b.part)) continue;
      const fingers = [...new Set([a.part.finger, b.part.finger].filter((finger): finger is number => finger !== null))];
      const pair = { a, b, fingers };
      this.pairs.push(pair);
      fingers.forEach(finger => this.byFinger[finger].push(pair));
    }
    const invalid = this.contacts(this.pairs, CONTACT_CLEARANCE).filter(pair => pair.distance < CONTACT_CLEARANCE);
    if (invalid.length) {
      throw new Error(`The initial hand pose intersects collision clearance: ${invalid.map(pair =>
        `${pair.a} / ${pair.b} (${pair.distance.toFixed(6)})`).join('; ')}`);
    }
    this.state.contacts = this.inspect();
  }

  /** dt is seconds. Long frames are bounded so resuming a hidden tab cannot jump through the hand. */
  step(requested: readonly number[], dt: number): ContactState {
    this.assertAlive();
    this.requested = this.requested.map((previous, i) => Number.isFinite(requested[i])
      ? THREE.MathUtils.clamp(requested[i], 0, 90) : previous);
    const budget = Number.isFinite(dt) && dt > 0 ? MAX_ANGULAR_SPEED * Math.min(dt, 0.05) : 0;
    const before = [...this.achieved];
    const targets = before.map((angle, finger) => angle +
      THREE.MathUtils.clamp(this.requested[finger] - angle, -budget, budget));
    const blocked = [false, false, false, false, false];
    if (budget > 0) this.advanceTogether(targets);
    for (let finger = 0; finger < 5 && budget > 0; finger++) {
      const target = targets[finger];
      const previousBlock = this.blockedPose[finger];
      if (previousBlock && Math.sign(target - this.achieved[finger]) === previousBlock.direction &&
          previousBlock.angles.every((angle, i) => angle === this.achieved[i])) {
        blocked[finger] = true;
        continue;
      }
      this.blockedPose[finger] = null;
      for (let iteration = 0; iteration < MAX_ADVANCES_PER_FINGER; iteration++) {
        const remaining = target - this.achieved[finger];
        if (Math.abs(remaining) < ANGLE_EPSILON) break;
        let advance = Math.min(Math.abs(remaining), MAX_SUBSTEP_DEGREES);
        // Only this finger moves during an advance. Other moving fingers become obstacles at their
        // latest accepted pose, so one blocked finger never freezes unrelated fingers.
        advance = this.conservativeAdvance(finger, advance);
        if (advance < ANGLE_EPSILON) { blocked[finger] = true; break; }
        const start = this.achieved[finger];
        const signedAdvance = Math.sign(remaining) * advance;
        this.setFinger(finger, start + signedAdvance);
        if (this.collides(finger)) {
          // Retain the last safe pose; bisection finds the contact boundary without committing
          // penetrating geometry to the rendered frame. The whole candidate interval was guarded.
          let safe = 0, unsafe = 1;
          for (let i = 0; i < 12; i++) {
            const mid = (safe + unsafe) / 2;
            this.setFinger(finger, start + signedAdvance * mid);
            if (this.collides(finger)) unsafe = mid; else safe = mid;
          }
          this.setFinger(finger, start + signedAdvance * safe);
          blocked[finger] = true;
          break;
        }
      }
      if (blocked[finger]) this.blockedPose[finger] = {
        direction: Math.sign(target - this.achieved[finger]), angles: [...this.achieved],
      };
    }
    const contacts = this.inspect();
    this.state = {
      requested: [...this.requested], achieved: [...this.achieved],
      limited: blocked.map((value, finger) => value && Math.abs(this.requested[finger] - this.achieved[finger]) > ANGLE_EPSILON),
      contacts,
      moving: before.some((value, finger) => Math.abs(value - this.achieved[finger]) > ANGLE_EPSILON),
    };
    return this.getState();
  }

  getState(): ContactState {
    return { requested: [...this.state.requested], achieved: [...this.state.achieved], limited: [...this.state.limited],
      contacts: this.state.contacts.map(contact => ({ ...contact, fingers: [...contact.fingers] })), moving: this.state.moving };
  }

  /**
   * Explore a bounded route from a previously accepted safe pose. This synchronous query always
   * restores the live solver and scene before returning, including when the pose callback throws.
   * A successful result proves this directed route only; the reverse route must be checked too.
   */
  probeMotion(from: readonly number[], target: readonly number[], maxFrames = 30): MotionProbe {
    this.assertAlive();
    for (const [name, angles] of [['from', from], ['target', target]] as const) {
      if (angles.length !== 5 || !angles.every(angle => Number.isFinite(angle) && angle >= 0 && angle <= 90)) {
        throw new Error(`Motion probe ${name} must contain five finite angles within 0–90 degrees.`);
      }
    }
    if (!Number.isFinite(maxFrames) || maxFrames < 1) throw new Error('Motion probe frame budget must be positive and finite.');
    const frameBudget = Math.min(120, Math.floor(maxFrames));
    const savedAchieved = [...this.achieved];
    const savedRequested = this.requested;
    const savedState = this.state;
    const savedBlocked = this.blockedPose.map(block => block && { direction: block.direction, angles: [...block.angles] });
    const savedPosition = this.position.clone(), savedOrientation = this.orientation.clone(), savedScale = this.scale.clone();
    // Snapshot the actual rig transforms, not just angles: restoration must also work after a
    // throwing applyPose callback, without calling that callback a second time in the finally block.
    const objects = new Set<THREE.Object3D>();
    for (const cached of this.cached) {
      for (let object: THREE.Object3D | null = cached.part.object; object; object = object.parent) objects.add(object);
    }
    const transforms = [...objects].map(object => ({
      object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
      rotationOrder: object.rotation.order, matrix: object.matrix.clone(), matrixWorld: object.matrixWorld.clone(),
      matrixWorldNeedsUpdate: object.matrixWorldNeedsUpdate,
    }));
    const colliders = this.cached.map(cached => ({ cached, position: cached.collider.translation(),
      rotation: cached.collider.rotation(), bounds: cached.bounds.clone() }));
    try {
      from.forEach((angle, finger) => { this.achieved[finger] = angle; this.blockedPose[finger] = null; });
      this.requested = [...from];
      this.syncFingers([0, 1, 2, 3, 4]);
      // Match the accepted-pose predicate used by step(). A wider contact-reporting prediction
      // can produce a slightly different GJK distance at the boundary of the safety margin.
      const invalid = this.contacts(this.pairs, CONTACT_CLEARANCE).filter(contact => contact.distance < CONTACT_CLEARANCE);
      if (invalid.length) throw new Error(`Motion probe starts in collision: ${invalid.map(contact =>
        `${contact.a} / ${contact.b} (${contact.distance.toPrecision(12)})`).join('; ')}; pose=${JSON.stringify(from)}`);
      const path = [[...from]];
      let state: ContactState = { requested: [...from], achieved: [...from], limited: [false, false, false, false, false],
        contacts: this.inspect(), moving: false };
      let frames = 0;
      const reached = (): boolean => state.achieved.every((angle, finger) => Math.abs(angle - target[finger]) < 1e-4);
      while (frames < frameBudget && !reached()) {
        state = this.step(target, 0.05);
        frames++;
        if (state.moving) path.push([...state.achieved]);
        else break;
      }
      return { achieved: [...state.achieved], reached: reached(), contacts: state.contacts,
        limited: [...state.limited], path, frames };
    } finally {
      savedAchieved.forEach((angle, finger) => { this.achieved[finger] = angle; this.blockedPose[finger] = savedBlocked[finger]; });
      this.requested = savedRequested;
      this.state = savedState;
      for (const saved of transforms) {
        saved.object.position.copy(saved.position);
        saved.object.rotation.order = saved.rotationOrder;
        saved.object.quaternion.copy(saved.quaternion);
        saved.object.scale.copy(saved.scale);
        saved.object.matrix.copy(saved.matrix);
        saved.object.matrixWorld.copy(saved.matrixWorld);
        saved.object.matrixWorldNeedsUpdate = saved.matrixWorldNeedsUpdate;
      }
      for (const saved of colliders) {
        saved.cached.collider.setTranslation(saved.position);
        saved.cached.collider.setRotation(saved.rotation);
        saved.cached.bounds.copy(saved.bounds);
      }
      this.position.copy(savedPosition);
      this.orientation.copy(savedOrientation);
      this.scale.copy(savedScale);
    }
  }

  /** Current safe-pose distances near contact, never distances from a rejected trial pose. */
  inspect(): ContactPair[] {
    this.assertAlive();
    return this.contacts(this.pairs, CONTACT_CLEARANCE + CONTACT_REPORT_MARGIN);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('The hand contact solver has been disposed.');
  }

  private setFinger(finger: number, angle: number): void {
    this.achieved[finger] = angle;
    this.syncFingers([finger]);
  }

  private syncFingers(fingers: number[]): void {
    this.applyPose(this.achieved);
    const transforms = new Set(fingers.flatMap(finger => this.transformsByFinger[finger]));
    for (const object of transforms) object.updateWorldMatrix(false, false);
    for (const cached of fingers.flatMap(finger => this.partsByFinger[finger])) {
      const object = cached.part.object;
      object.matrixWorld.decompose(this.position, this.orientation, this.scale);
      cached.collider.setTranslation(this.position);
      cached.collider.setRotation(this.orientation);
      cached.bounds.copy(cached.localBounds).applyMatrix4(object.matrixWorld);
    }
  }

  /** Move contacting digits together before attempting independent motion. Treating each digit as
   * a stationary obstacle to every other digit can otherwise lock a valid coordinated release. */
  private advanceTogether(targets: number[]): void {
    const fingers = targets.flatMap((target, finger) => Math.abs(target - this.achieved[finger]) > ANGLE_EPSILON ? [finger] : []);
    if (fingers.length < 2) return;
    const pairs = [...new Set(fingers.flatMap(finger => this.byFinger[finger]))];
    const apply = (start: number[], delta: number[], fraction: number): void => {
      fingers.forEach(finger => { this.achieved[finger] = start[finger] + delta[finger] * fraction; });
      this.syncFingers(fingers);
    };
    for (let iteration = 0; iteration < MAX_ADVANCES_PER_FINGER; iteration++) {
      const start = [...this.achieved];
      const delta = targets.map((target, finger) => target - start[finger]);
      const largest = Math.max(...delta.map(Math.abs));
      if (largest < ANGLE_EPSILON) return;
      let fraction = Math.min(1, MAX_SUBSTEP_DEGREES / largest);
      for (const pair of pairs) {
        // A simultaneous sweep must include travel of BOTH independently moving bodies.
        const relativeBound = this.pointTravelBound *
          ((pair.a.part.finger === null ? 0 : Math.abs(delta[pair.a.part.finger])) +
           (pair.b.part.finger === null ? 0 : Math.abs(delta[pair.b.part.finger])));
        if (relativeBound === 0) continue;
        const prediction = relativeBound * fraction + SWEEP_CLEARANCE;
        if (!boundsNear(pair.a.bounds, pair.b.bounds, prediction)) continue;
        const contact = pair.a.collider.contactCollider(pair.b.collider, prediction);
        if (contact) fraction = Math.min(fraction, Math.max(0, 0.8 * (contact.distance - SWEEP_CLEARANCE) / relativeBound));
      }
      if (fraction * largest < ANGLE_EPSILON) return;
      apply(start, delta, fraction);
      const invalid = (): boolean => this.contacts(pairs, CONTACT_CLEARANCE).some(contact => contact.distance < CONTACT_CLEARANCE);
      if (!invalid()) continue;
      let safe = 0, unsafe = fraction;
      for (let i = 0; i < 12; i++) {
        const mid = (safe + unsafe) / 2;
        apply(start, delta, mid);
        if (invalid()) unsafe = mid; else safe = mid;
      }
      apply(start, delta, safe);
      return;
    }
  }

  private collides(finger: number): boolean {
    for (const pair of this.byFinger[finger]) {
      if (!boundsNear(pair.a.bounds, pair.b.bounds, CONTACT_CLEARANCE)) continue;
      const contact = pair.a.collider.contactCollider(pair.b.collider, CONTACT_CLEARANCE);
      if (contact && contact.distance < CONTACT_CLEARANCE) return true;
    }
    return false;
  }

  private conservativeAdvance(finger: number, proposed: number): number {
    let advance = proposed;
    for (const pair of this.byFinger[finger]) {
      // Both nonadjacent links can move within one finger: use the sum of their point bounds.
      const relativeBound = this.pointTravelBound *
        (Number(pair.a.part.finger === finger) + Number(pair.b.part.finger === finger));
      const prediction = relativeBound * advance + SWEEP_CLEARANCE;
      if (!boundsNear(pair.a.bounds, pair.b.bounds, prediction)) continue;
      const contact = pair.a.collider.contactCollider(pair.b.collider, prediction);
      if (contact) advance = Math.min(advance, Math.max(0, 0.8 * (contact.distance - SWEEP_CLEARANCE) / relativeBound));
    }
    return advance;
  }

  private contacts(pairs: Pair[], prediction: number): ContactPair[] {
    const results: ContactPair[] = [];
    for (const pair of pairs) {
      if (!boundsNear(pair.a.bounds, pair.b.bounds, prediction)) continue;
      const contact = pair.a.collider.contactCollider(pair.b.collider, prediction);
      if (contact && contact.distance <= prediction) {
        results.push({ a: pair.a.part.id, b: pair.b.part.id, distance: contact.distance, fingers: [...pair.fingers] });
      }
    }
    return results;
  }
}
