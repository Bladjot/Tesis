import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CollisionPart } from './hand-contact';
type FingerRig = { joints: THREE.Group[]; spread: number; thumb: boolean };
type Section = [y: number, halfWidth: number, halfDepth: number];

/** Shared visible geometry and rigid collision surfaces, usable without WebGL. */
export class HandModel {
  readonly model = new THREE.Group();
  readonly collisionParts: CollisionPart[] = [];
  private owner: { finger: number | null; segment: number } = { finger: null, segment: -1 };
  private readonly shell = new THREE.MeshPhysicalMaterial({
    color: '#e3e1d9', metalness: 0.035, roughness: 0.29,
    clearcoat: 0.22, clearcoatRoughness: 0.34, envMapIntensity: 0.68,
  });
  private readonly chassis = new THREE.MeshStandardMaterial({
    color: '#14191e', metalness: 0.46, roughness: 0.38, envMapIntensity: 0.72,
  });
  private readonly rubber = new THREE.MeshStandardMaterial({
    color: '#080c0e', metalness: 0.04, roughness: 0.67, envMapIntensity: 0.35,
  });
  private readonly metal = new THREE.MeshStandardMaterial({
    color: '#9ba4a5', metalness: 0.87, roughness: 0.3, envMapIntensity: 0.82,
  });
  private readonly bearingCap = new THREE.MeshStandardMaterial({
    color: '#b8b9ae', metalness: 0.65, roughness: 0.34, envMapIntensity: 0.75,
  });
  private readonly seamMaterial = new THREE.MeshStandardMaterial({
    color: '#555e60', metalness: 0.15, roughness: 0.6,
  });
  private readonly indicator = new THREE.MeshStandardMaterial({
    color: '#7be0f0', emissive: '#2da6ba', emissiveIntensity: 0.55, roughness: 0.35,
  });
  private readonly wireMaterial = new THREE.LineBasicMaterial({
    color: '#76cddd', transparent: true, opacity: 0.2, depthWrite: false,
  });
  private readonly boneMaterial = new THREE.MeshStandardMaterial({
    color: '#c3f3f7', emissive: '#33899b', emissiveIntensity: 0.4, roughness: 0.4,
  });
  private readonly wires: THREE.LineSegments[] = [];
  private readonly mechanisms: THREE.Mesh[] = [];
  private readonly bones: THREE.Object3D[] = [];
  private readonly fingers: FingerRig[] = [];
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 40);
  private readonly thumbBase = new THREE.Vector3(-1.04, -0.98, 0.46);
  private readonly fingerSpecs = [
    { x: -0.93, y: 0.66, spread: 0.12, lengths: [1.015, 0.64, 0.45], radius: 0.232 },
    { x: -0.31, y: 0.74, spread: 0.015, lengths: [1.15, 0.715, 0.49], radius: 0.245 },
    { x: 0.31, y: 0.66, spread: -0.09, lengths: [1.065, 0.675, 0.46], radius: 0.234 },
    { x: 0.93, y: 0.65, spread: -0.20, lengths: [0.835, 0.53, 0.405], radius: 0.204 },
  ];
  private readonly palmProfiles: Section[] = [
    [-1.78, 0.54, 0.26], [-1.70, 0.62, 0.3], [-1.45, 0.78, 0.35],
    [-1.07, 0.92, 0.39], [-0.6, 1.01, 0.385], [-0.17, 1.06, 0.34],
    [0.17, 1.065, 0.29], [0.4, 1.025, 0.24], [0.52, 0.94, 0.2],
  ];

  constructor() {
    this.model.rotation.z = -0.055;
    this.buildPalm();
    this.buildMounts();
    this.buildWrist();
    this.buildFingers();
    this.applyPose([0, 0, 0, 0, 0]);
  }
  setWireframe(visible: boolean): void { this.wires.forEach(wire => { wire.visible = visible; }); }
  setSkeleton(visible: boolean): void {
    this.bones.forEach(bone => { bone.visible = visible; });
    this.mechanisms.forEach(mesh => { mesh.visible = !visible; });
    this.shell.transparent = visible;
    this.shell.opacity = visible ? 0.11 : 1;
    this.shell.depthWrite = !visible;
    this.shell.needsUpdate = true;
  }
  /** Both modes retain the articulated enclosure; this is not a skin/anatomy renderer. */
  setMode(mode: 'human' | 'robotic'): void {
    this.shell.color.set(mode === 'robotic' ? '#e3e1d9' : '#c9d3d9');
    this.shell.metalness = mode === 'robotic' ? 0.035 : 0.08;
    this.shell.roughness = mode === 'robotic' ? 0.29 : 0.4;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, wire = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (material !== this.shell && material !== this.boneMaterial) this.mechanisms.push(mesh);
    if (wire) {
      const overlay = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), this.wireMaterial);
      overlay.scale.setScalar(1.002);
      overlay.visible = false;
      mesh.add(overlay);
      this.wires.push(overlay);
    }
    return mesh;
  }

  private cylinderAt(parent: THREE.Object3D, material: THREE.Material, radius: number, length: number, position: THREE.Vector3, axis: 'x' | 'y' | 'z' = 'x'): THREE.Mesh {
    const mesh = this.mesh(this.cylinder, material, parent, false);
    mesh.scale.set(radius, length, radius);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(position);
    return mesh;
  }

  private ring(parent: THREE.Object3D, radius: number, tube: number, position: THREE.Vector3, material: THREE.Material = this.metal): void {
    const mesh = this.mesh(new THREE.TorusGeometry(radius, tube, 8, 40), material, parent, false);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.copy(position);
  }

  private hinge(parent: THREE.Object3D, radius: number, width: number, position = new THREE.Vector3()): void {
    const before = parent.children.length;
    const bearing = this.cylinderAt(parent, this.chassis, radius, width, position);
    bearing.name = parent.name + '-bearing';
    for (const sign of [-1, 1]) {
      const outer = position.clone().add(new THREE.Vector3(sign * (width / 2 + 0.014), 0, 0));
      this.cylinderAt(parent, this.rubber, radius * 1.025, 0.052, outer);
      const capPosition = outer.clone().add(new THREE.Vector3(sign * 0.035, 0, 0));
      this.cylinderAt(parent, this.bearingCap, radius * 0.73, 0.029, capPosition);
      this.ring(parent, radius * 0.87, radius * 0.04, outer.clone().add(new THREE.Vector3(sign * 0.024, 0, 0)));
      this.ring(parent, radius * 0.65, radius * 0.018, capPosition.clone().add(new THREE.Vector3(sign * 0.016, 0, 0)), this.chassis);
      const slot = this.mesh(new THREE.BoxGeometry(0.005, radius * 0.64, radius * 0.065), this.rubber, parent, false);
      slot.position.copy(capPosition).add(new THREE.Vector3(sign * 0.017, 0, 0));
      slot.rotation.x = -0.6;
      for (const offset of [-1, 1]) {
        this.cylinderAt(parent, this.metal, radius * 0.065, 0.006,
          capPosition.clone().add(new THREE.Vector3(sign * 0.018, offset * radius * 0.43, -offset * radius * 0.16)));
      }
    }
    for (const sign of [-1, 1]) this.ring(parent, radius * 1.005, 0.009,
      position.clone().add(new THREE.Vector3(sign * width * 0.3, 0, 0)), this.rubber);
    this.registerAssembly(parent, parent.children.slice(before), this.owner.finger === null ? 'fixed' : 'hinge');
  }

  private buildPalm(): void {
    const coreProfiles = this.palmProfiles.map(([y, width, depth]) => [y - 0.015, width + 0.025, depth * 0.79] as Section);
    const core = this.mesh(this.sectionGeometry(coreProfiles, 0.55), this.chassis, this.model);
    core.name = 'palm-core';
    core.position.z = 0.045;
    this.register(core, 'fixed');
    const cover = this.mesh(this.palmCoverGeometry(), this.shell, this.model);
    this.register(cover, 'fixed');
    for (const sign of [-1, 1]) {
      const points = [new THREE.Vector2(sign * 0.54, -1.47), new THREE.Vector2(sign * 0.75, -0.98),
        new THREE.Vector2(sign * 0.83, -0.42), new THREE.Vector2(sign * 0.84, -0.05)]
        .map(p => new THREE.Vector3(p.x, p.y, this.palmSurface(p.x, p.y) - 0.003));
      this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 30, 0.0045, 5, false), this.seamMaterial, this.model, false);
    }
    for (const [x, y] of [[-0.69, -1.18], [0.69, -1.18], [-0.8, 0.12], [0.8, 0.12]]) {
      const z = this.palmSurface(x, y);
      this.cylinderAt(this.model, this.rubber, 0.04, 0.017, new THREE.Vector3(x, y, z - 0.006), 'z');
      this.cylinderAt(this.model, this.metal, 0.027, 0.021, new THREE.Vector3(x, y, z - 0.018), 'z');
      const slot = this.mesh(new THREE.BoxGeometry(0.027, 0.004, 0.005), this.chassis, this.model, false);
      slot.position.set(x, y, z - 0.031);
      slot.rotation.z = 0.5;
    }
    const inlay = this.mesh(new RoundedBoxGeometry(0.24, 0.028, 0.014, 2, 0.008), this.indicator, this.model, false);
    inlay.position.set(0, -1.52, this.palmSurface(0, -1.52) - 0.007);
    const ends = this.fingerSpecs.map(spec => new THREE.Vector3(spec.x, spec.y, 0.06));
    ends.forEach((end, i) => this.boneBetween(new THREE.Vector3(-0.2 + i * 0.13, -1.76, 0), end, 0.067, this.model));
    this.boneBetween(new THREE.Vector3(-0.22, -1.76, 0), this.thumbBase, 0.075, this.model);
  }

  /** Fixed structure reaches every root bearing; clearance is never made by floating a digit. */
  private buildMounts(): void {
    const anchor = new THREE.Vector3(-0.69, -1.17, 0.08);
    const direction = this.thumbBase.clone().sub(anchor);
    const length = direction.length();
    const mount = this.mesh(this.sectionGeometry([
      [-0.12, 0.22, 0.20], [0, 0.27, 0.23],
      [length * 0.55, 0.23, 0.20], [length, 0.155, 0.155],
    ], 0.65), this.shell, this.model);
    mount.name = 'thumb-mount';
    mount.position.copy(anchor);
    mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    this.register(mount, 'fixed');
    this.fingerSpecs.forEach((spec, index) => {
      const bottom = 0.32;
      const top = spec.y + 0.025;
      const socket = this.mesh(new RoundedBoxGeometry(spec.radius * 1.60, top - bottom, 0.18, 4, 0.055), this.shell, this.model);
      socket.name = `finger-${index + 1}-mount`;
      socket.position.set(spec.x, (top + bottom) / 2, -0.13);
      this.register(socket, 'fixed');
    });
  }

  private buildWrist(): void {
    const wristHousing = this.mesh(new RoundedBoxGeometry(1.03, 0.55, 0.63, 4, 0.15), this.rubber, this.model);
    wristHousing.position.set(0, -2.0, 0.025);
    this.register(wristHousing, 'fixed');
    this.hinge(this.model, 0.39, 1.02, new THREE.Vector3(0, -2.0, 0.015));
    const forearm = this.mesh(this.sectionGeometry([
      [-3.12, 0.54, 0.34], [-3.09, 0.59, 0.38], [-2.93, 0.6, 0.385],
      [-2.58, 0.58, 0.37], [-2.42, 0.54, 0.34], [-2.39, 0.49, 0.30],
    ], 0.52), this.shell, this.model);
    forearm.position.z = 0.01;
    this.register(forearm, 'fixed');
    const trim = this.mesh(this.sectionGeometry([[-2.43, 0.54, 0.35], [-2.37, 0.52, 0.32]], 0.52), this.chassis, this.model);
    trim.position.z = 0.01;
    this.register(trim, 'fixed');
    for (const sign of [-1, 1]) {
      const rail = this.mesh(new RoundedBoxGeometry(0.025, 0.4, 0.014, 2, 0.005), this.seamMaterial, this.model, false);
      rail.position.set(sign * 0.38, -2.77, -0.355);
    }
    this.boneBetween(new THREE.Vector3(0, -3.04, 0), new THREE.Vector3(0, -1.75, 0), 0.15, this.model);
  }

  private buildFingers(): void {
    const thumbRoot = new THREE.Group();
    thumbRoot.name = 'thumb-cmc';
    thumbRoot.position.copy(this.thumbBase);
    this.model.add(thumbRoot);
    const thumbRig: FingerRig = { joints: [], spread: 0.85, thumb: true };
    let thumbParent: THREE.Object3D = thumbRoot;
    const thumbLengths = [0.55, 0.65, 0.49];
    thumbLengths.forEach((length, index) => {
      const joint = index === 0 ? thumbRoot : new THREE.Group();
      joint.name = ['thumb-cmc', 'thumb-mcp', 'thumb-ip'][index];
      if (index > 0) { joint.position.y = thumbLengths[index - 1]; thumbParent.add(joint); }
      thumbRig.joints.push(joint);
      this.owner = { finger: 0, segment: index };
      this.buildPhalanx(joint, length, [0.22, 0.235, 0.20][index], index === 2);
      thumbParent = joint;
    });
    this.fingers.push(thumbRig);
    this.fingerSpecs.forEach((spec, fingerIndex) => {
      const rig: FingerRig = { joints: [], spread: spec.spread, thumb: false };
      let parent: THREE.Object3D = this.model;
      spec.lengths.forEach((length, index) => {
        const joint = new THREE.Group();
        joint.name = `finger-${fingerIndex + 1}-${['mcp', 'pip', 'dip'][index]}`;
        if (index === 0) joint.position.set(spec.x, spec.y, 0.06);
        else joint.position.y = spec.lengths[index - 1];
        parent.add(joint);
        rig.joints.push(joint);
        this.owner = { finger: fingerIndex + 1, segment: index };
        this.buildPhalanx(joint, length, spec.radius * (1 - index * 0.115), index === 2);
        parent = joint;
      });
      this.fingers.push(rig);
    });
    this.owner = { finger: null, segment: -1 };
    this.applyPose([0, 0, 0, 0, 0]);
  }

  private buildPhalanx(parent: THREE.Group, length: number, radius: number, terminal: boolean): void {
    if (parent.name === 'thumb-cmc') {
      // Spherical rotor captured by the thenar socket supports multi-axis opposition.
      const bearing = this.mesh(new THREE.SphereGeometry(radius * 0.94, 32, 24), this.chassis, parent);
      bearing.name = 'thumb-cmc-bearing';
      this.register(bearing, 'hinge');
    } else this.hinge(parent, radius * 0.84, radius * 1.79);
    const shaftStart = radius * 0.78;
    const shaft = this.mesh(new RoundedBoxGeometry(radius * 1.05, length - shaftStart, radius * 1.12, 3, radius * 0.2), this.chassis, parent);
    shaft.position.y = (length + shaftStart) / 2;
    this.register(shaft, 'shaft');
    // Recess the enclosure around each bearing, leaving room for the adjacent
    // rigid link to rotate instead of colliding with an oversized straight sleeve.
    const start = radius * 0.94;
    const end = terminal ? length + radius * 0.56 : length - radius * (parent.name === 'thumb-cmc' ? 1.12 : 0.96);
    const profiles: Section[] = terminal ? [
      [start, radius * 0.84, radius * 0.64], [start + 0.04, radius, radius * 0.77],
      [length * 0.72, radius * 0.95, radius * 0.78], [end - radius * 0.24, radius * 0.87, radius * 0.72],
      [end + radius * 0.15, radius * 0.64, radius * 0.58], [end + radius * 0.35, radius * 0.32, radius * 0.31],
      [end + radius * 0.4, 0.007, 0.007],
    ] : [
      [start, radius * 0.83, radius * 0.64], [start + 0.04, radius, radius * 0.78],
      [start + (end - start) * 0.45, radius * 0.97, radius * 0.78],
      [end - 0.04, radius * 0.90, radius * 0.72], [end, radius * 0.79, radius * 0.60],
    ];
    const cover = this.mesh(this.sectionGeometry(profiles, 0.47, terminal ? 26 : 20), this.shell, parent);
    cover.name = parent.name + '-shell';
    cover.position.z = -0.015;
    this.register(cover, 'shell');
    const channelLength = Math.max(0.10, end - start - 0.07);
    const channel = this.mesh(new RoundedBoxGeometry(radius * 0.44, channelLength, 0.032, 2, 0.015), this.rubber, parent, false);
    channel.position.set(0, start + channelLength / 2, radius * 0.74);
    this.register(channel, 'shell');
    if (terminal) {
      const tip = new THREE.Object3D();
      tip.name = this.owner.finger === 0 ? 'thumb-tip' : `finger-${this.owner.finger}-tip`;
      tip.position.set(0, end + radius * 0.4, -0.015);
      parent.add(tip);
    }
    this.boneBetween(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, length - 0.03, 0), radius * 0.25, parent);
    const pivot = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.44, 16, 12), this.boneMaterial);
    pivot.visible = false;
    parent.add(pivot);
    this.bones.push(pivot);
  }

  private sectionGeometry(profiles: Section[], power = 0.5, steps = 28): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(profiles.map(p => new THREE.Vector3(...p)));
    const radial = 40, positions: number[] = [], indices: number[] = [];
    for (let j = 0; j <= steps; j++) {
      const p = curve.getPoint(j / steps);
      for (let i = 0; i <= radial; i++) {
        const angle = i / radial * Math.PI * 2;
        const c = Math.cos(angle), s = Math.sin(angle);
        positions.push(Math.sign(c) * Math.pow(Math.abs(c), power) * p.y,
          p.x, Math.sign(s) * Math.pow(Math.abs(s), power) * p.z);
      }
    }
    for (let j = 0; j < steps; j++) for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i, b = a + radial + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const bottom = positions.length / 3;
    positions.push(0, profiles[0][0], 0);
    const top = positions.length / 3;
    positions.push(0, profiles[profiles.length - 1][0], 0);
    for (let i = 0; i < radial; i++) {
      indices.push(bottom, i, i + 1);
      const end = steps * (radial + 1);
      indices.push(top, end + i + 1, end + i);
    }
    return this.geometry(positions, indices);
  }

  private dorsalVolume(x: number, y: number): number {
    return [-0.7, -0.22, 0.3, 0.73].reduce((sum, center) => sum +
      0.024 * Math.exp(-Math.pow((x - center) / 0.17, 2) - Math.pow((y + 0.22) / 0.7, 2)), 0);
  }

  private palmCoverGeometry(): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(this.palmProfiles.map(p => new THREE.Vector3(...p)));
    const rows = 40, radial = 40, stride = (radial + 1) * 2;
    const positions: number[] = [], indices: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const p = curve.getPoint(j / rows);
      for (const inner of [false, true]) for (let i = 0; i <= radial; i++) {
        const t = (inner ? radial - i : i) / radial * Math.PI;
        const x = Math.sign(Math.cos(t)) * Math.sqrt(Math.abs(Math.cos(t))) * (p.y - (inner ? 0.057 : 0));
        const z = -Math.sqrt(Math.max(0, Math.sin(t))) * (p.z - (inner ? 0.066 : 0)) - 0.025;
        positions.push(x, p.x, z - (inner ? 0 : this.dorsalVolume(x, p.x)));
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < stride; i++) {
      const a = j * stride + i, next = j * stride + (i + 1) % stride;
      const b = a + stride, bn = next + stride;
      indices.push(a, next, b, next, bn, b);
    }
    for (const endRow of [0, rows]) for (let i = 0; i < radial; i++) {
      const a = endRow * stride + i, b = a + 1;
      const c = endRow * stride + stride - 1 - i, d = c - 1;
      if (endRow === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
    return this.geometry(positions, indices);
  }

  private palmSurface(x: number, y: number): number {
    const curve = new THREE.CatmullRomCurve3(this.palmProfiles.map(p => new THREE.Vector3(...p)));
    let low = 0, high = 1;
    for (let i = 0; i < 15; i++) {
      const mid = (low + high) / 2;
      if (curve.getPoint(mid).x < y) low = mid; else high = mid;
    }
    const p = curve.getPoint((low + high) / 2);
    const ratio = Math.min(1, Math.abs(x / p.y));
    return -p.z * Math.pow(1 - Math.pow(ratio, 4), 0.25) - 0.025 - this.dorsalVolume(x, y);
  }

  private geometry(positions: number[], indices: number[]): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private boneBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, parent: THREE.Object3D): void {
    const direction = end.clone().sub(start);
    const bone = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, direction.length() - radius * 2), 4, 10), this.boneMaterial);
    bone.position.copy(start).add(end).multiplyScalar(0.5);
    bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    bone.visible = false;
    parent.add(bone);
    this.bones.push(bone);
  }

  applyPose(angles: readonly number[]): void {
    this.fingers.forEach((finger, index) => {
      const angle = THREE.MathUtils.degToRad(angles[index]);
      const closed = angles[index] / 90;
      if (finger.thumb) {
        // Lift onto the palmar (+Z) side before opposing toward the index.
        const lift = THREE.MathUtils.smoothstep(closed, 0, 0.6);
        const oppose = THREE.MathUtils.smoothstep(closed, 0.12, 1);
        finger.joints[0].rotation.set(0.20 + lift * 0.38, -0.10 + closed * 0.17, finger.spread - oppose * 1.30);
        // Opposition first, then distal flexion: bending all three joints at once
        // makes the fingertip droop before it can face the index for a pinch.
        // Keep a straight IP at rest and a smooth, bounded curl near full closure.
        finger.joints[1].rotation.x = angle * 0.52;
        finger.joints[2].rotation.x = THREE.MathUtils.degToRad(35) * THREE.MathUtils.smoothstep(closed, 0.38, 1);
      } else {
        finger.joints[0].rotation.z = finger.spread * (1 - closed * 0.85);
        finger.joints[0].rotation.x = angle * 0.94;
        finger.joints[1].rotation.x = angle * 1.10;
        finger.joints[2].rotation.x = angle * 0.68;
      }
    });
  }


  private register(mesh: THREE.Mesh, role: CollisionPart['role']): void {
    const owner = { ...this.owner };
    this.collisionParts.push({ id: (owner.finger === null ? 'palma-muneca' : ['pulgar', 'indice', 'medio', 'anular', 'menique'][owner.finger]) + '-' + owner.segment + '-' + role + '-' + this.collisionParts.length,
      ...owner, role, object: mesh, geometry: mesh.geometry });
  }

  /** Encloses the real bearing including rims, screw heads and side caps. */
  private registerAssembly(parent: THREE.Object3D, children: THREE.Object3D[], role: CollisionPart['role']): void {
    const vertices: number[] = [];
    for (const child of children) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.updateMatrix();
      const points = child.geometry.getAttribute('position');
      const point = new THREE.Vector3();
      for (let i = 0; i < points.count; i++) {
        point.fromBufferAttribute(points, i).applyMatrix4(child.matrix);
        vertices.push(point.x, point.y, point.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const owner = { ...this.owner };
    this.collisionParts.push({ id: (owner.finger === null ? 'muneca' : ['pulgar', 'indice', 'medio', 'anular', 'menique'][owner.finger]) + '-' + owner.segment + '-' + role + '-' + this.collisionParts.length,
      ...owner, role, object: parent, geometry });
  }
}
