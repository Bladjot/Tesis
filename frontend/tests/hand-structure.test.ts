import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { HandModel } from '../src/hand-model.ts';

const OPEN = [0, 0, 0, 0, 0];
const CLOSED = [90, 90, 90, 90, 90];
const ROOTS = ['thumb-cmc', 'finger-1-mcp', 'finger-2-mcp', 'finger-3-mcp', 'finger-4-mcp'];
const MOUNTS = ['thumb-mount', 'finger-1-mount', 'finger-2-mount', 'finger-3-mount', 'finger-4-mount'];
const CHAINS = [
  ['thumb-cmc', 'thumb-mcp', 'thumb-ip', 'thumb-tip'],
  ...Array.from({ length: 4 }, (_, i) => [`finger-${i + 1}-mcp`, `finger-${i + 1}-pip`, `finger-${i + 1}-dip`, `finger-${i + 1}-tip`]),
];
const SEATING_TOLERANCE = 0.004;

function named(model: HandModel, name: string): THREE.Object3D {
  const object = model.model.getObjectByName(name);
  assert.ok(object, `The rendered mechanical assembly is missing ${name}.`);
  return object;
}

function hasAncestor(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function visibleMeshes(object: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  object.traverseVisible(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
  return meshes;
}

function pose(model: HandModel, angles: readonly number[]): void {
  model.applyPose(angles);
  model.model.updateMatrixWorld(true);
}

function position(object: THREE.Object3D): THREE.Vector3 {
  return object.getWorldPosition(new THREE.Vector3());
}

function relativeRotation(parent: THREE.Object3D, child: THREE.Object3D): THREE.Quaternion {
  return parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(child.getWorldQuaternion(new THREE.Quaternion()));
}

function disposeModel(model: HandModel): void {
  const geometries = new Set<THREE.BufferGeometry>(model.collisionParts.map(part => part.geometry));
  const materials = new Set<THREE.Material>();
  model.model.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function hull(world: RAPIER.World, object: THREE.Object3D, geometry: THREE.BufferGeometry): RAPIER.Collider {
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, rotation, scale);
  const source = geometry.getAttribute('position');
  const points = new Float32Array(source.count * 3);
  for (let i = 0; i < source.count; i++) {
    points[i * 3] = source.getX(i) * scale.x;
    points[i * 3 + 1] = source.getY(i) * scale.y;
    points[i * 3 + 2] = source.getZ(i) * scale.z;
  }
  const descriptor = RAPIER.ColliderDesc.convexHull(points);
  assert.ok(descriptor, `${object.name || object.type} must contain a solid visible support.`);
  return world.createCollider(descriptor.setTranslation(position.x, position.y, position.z).setRotation(rotation));
}

test('the thumb has a visible metacarpal, proximal and distal chain with an articulated real fingertip', () => {
  const model = new HandModel();
  try {
    const chain = CHAINS[0].map(name => named(model, name));
    chain.slice(1).forEach((child, i) => assert.ok(hasAncestor(child, chain[i]),
      `${child.name} must inherit the transform of ${chain[i].name}.`));
    for (let segment = 0; segment < 3; segment++) {
      const material = model.collisionParts.filter(part => part.finger === 0 && part.segment === segment && part.role === 'shell');
      assert.ok(material.some(part => part.object instanceof THREE.Mesh && part.object.visible && hasAncestor(part.object, chain[segment])),
        `Thumb link ${segment} must have a visible physical enclosure attached to its own joint.`);
    }
    pose(model, OPEN);
    const initialRelative = relativeRotation(chain[1], chain[2]);
    const initialTip = position(chain[3]);
    pose(model, CLOSED);
    const bend = initialRelative.angleTo(relativeRotation(chain[1], chain[2]));
    assert.ok(bend > THREE.MathUtils.degToRad(25),
      `The terminal thumb segment must visibly flex relative to the proximal segment; measured ${THREE.MathUtils.radToDeg(bend)} degrees.`);
    assert.ok(initialTip.distanceTo(position(chain[3])) > 0.5, 'The thumb tip must move in world space, not merely report a changed command.');

    // The landmark must be on the actual distal enclosure. Moving an unrelated empty
    // Object3D must not let the articulation tests pass while the visible fingertip stays still.
    const terminal = model.collisionParts.filter(part => part.finger === 0 && part.segment === 2 && part.role === 'shell');
    const inverse = chain[2].matrixWorld.clone().invert();
    const point = new THREE.Vector3();
    let furthest = Number.NEGATIVE_INFINITY;
    for (const part of terminal) {
      const transform = inverse.clone().multiply(part.object.matrixWorld);
      const vertices = part.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(transform);
        furthest = Math.max(furthest, point.y);
      }
    }
    const tipInJoint = position(chain[3]).applyMatrix4(inverse);
    assert.ok(Math.abs(tipInJoint.y - furthest) < 0.025,
      `Thumb tip landmark (${tipInJoint.y}) must follow the end of the actual terminal enclosure (${furthest}).`);
  } finally { disposeModel(model); }
});

test('the thumb stays extended during opposition and curls its real tip progressively for closure', () => {
  const model = new HandModel();
  try {
    const mcp = named(model, 'thumb-mcp'), ip = named(model, 'thumb-ip'), tip = named(model, 'thumb-tip');
    pose(model, OPEN);
    const straight = relativeRotation(mcp, ip);
    let previousBend = 0;
    for (let command = 0; command <= 90; command += 0.5) {
      pose(model, [command, 0, 0, 0, 0]);
      const bend = THREE.MathUtils.radToDeg(straight.angleTo(relativeRotation(mcp, ip)));
      assert.ok(bend >= previousBend - 1e-4 && bend <= 45.0001,
        `Distal flexion must remain progressive and bounded, command=${command}, bend=${bend}.`);
      assert.ok(bend - previousBend < 0.65, 'The fingertip must not snap as opposition changes to flexion.');
      if (command <= 30) assert.ok(bend < 1e-5, 'The thumb tip must stay extended during early opposition.');
      previousBend = bend;
    }
    for (const command of [45, 58, 65]) {
      pose(model, [command, 0, 0, 0, 0]);
      const inverse = model.model.matrixWorld.clone().invert();
      const direction = position(tip).applyMatrix4(inverse).sub(position(ip).applyMatrix4(inverse)).normalize();
      assert.ok(direction.y > 0,
        `The actual fingertip points down during a partial pinch, command=${command}, direction=${direction.toArray()}.`);
      if (command === 58) {
        const bend = THREE.MathUtils.radToDeg(straight.angleTo(relativeRotation(mcp, ip)));
        assert.ok(bend < 25, `The pinch preset must not overcurl the distal thumb: ${bend} degrees.`);
      }
    }
    pose(model, OPEN);
    assert.ok(straight.angleTo(relativeRotation(mcp, ip)) < 1e-7, 'Reopening must fully extend the distal joint.');
  } finally { disposeModel(model); }
});

test('all five mechanical chains retain their link lengths and seated root positions throughout movement', () => {
  const model = new HandModel();
  try {
    const chains = CHAINS.map(names => names.map(name => named(model, name)));
    pose(model, OPEN);
    const initial = chains.map(chain => ({
      root: position(chain[0]),
      lengths: chain.slice(1).map((node, index) => position(node).distanceTo(position(chain[index]))),
      tip: position(chain[3]),
      distalRotation: relativeRotation(chain[1], chain[2]),
    }));
    initial.forEach((data, finger) => data.lengths.forEach((length, link) => {
      assert.ok(length > 0.1, `Finger ${finger}, link ${link} must have a nonzero structural length.`);
    }));
    for (let angle = 0; angle <= 90; angle += 15) {
      pose(model, Array.from({ length: 5 }, () => angle));
      chains.forEach((chain, finger) => {
        assert.ok(position(chain[0]).distanceTo(initial[finger].root) < 1e-8,
          `Finger ${finger} must stay anchored to the palm at command ${angle}.`);
        chain.slice(1).forEach((node, index) => {
          assert.ok(hasAncestor(node, chain[index]), `${node.name} must belong to its mechanical parent.`);
          const length = position(node).distanceTo(position(chain[index]));
          assert.ok(Math.abs(length - initial[finger].lengths[index]) < 1e-8,
            `Finger ${finger}, link ${index} stretches or detaches at command ${angle}.`);
        });
      });
    }
    chains.forEach((chain, finger) => {
      assert.ok(initial[finger].tip.distanceTo(position(chain[3])) > 0.5,
        `Finger ${finger} fingertip must actually move when closing.`);
      assert.ok(initial[finger].distalRotation.angleTo(relativeRotation(chain[1], chain[2])) > THREE.MathUtils.degToRad(25),
        `Finger ${finger} distal link must flex relative to its proximal chain.`);
    });
  } finally { disposeModel(model); }
});

test('visible mounts and rigid shafts continuously connect the palm and every rotating bearing', async () => {
  await RAPIER.init();
  const model = new HandModel();
  try {
    const palm = named(model, 'palm-core');
    assert.ok(palm instanceof THREE.Mesh, 'The palm attachment target must be the actual solid core mesh.');
    const mounts = MOUNTS.map(name => named(model, name));
    const roots = ROOTS.map(name => named(model, name));
    mounts.forEach((mount, finger) => {
      assert.ok(!hasAncestor(mount, roots[finger]), `${mount.name} must remain fixed to the palm instead of rotating with the digit.`);
      assert.ok(visibleMeshes(mount).length > 0, `${mount.name} must contain visible support material, not only a landmark.`);
    });
    for (const angle of [0, 30, 60, 90]) {
      pose(model, [angle, angle, angle, angle, angle]);
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      try {
        const palmCollider = hull(world, palm, palm.geometry);
        mounts.forEach((mount, finger) => {
          const supports = visibleMeshes(mount).map(mesh => hull(world, mesh, mesh.geometry));
          const bearing = model.collisionParts.find(part => part.finger === finger && part.segment === 0 && part.role === 'hinge');
          assert.ok(bearing, `Finger ${finger} must have a physical root bearing.`);
          const bearingCollider = hull(world, bearing.object, bearing.geometry);
          // Contact queries use the transformed visible geometry rather than overlapping
          // bounding boxes or coincident group names. Separate support pieces are queried
          // separately so a convex hull over a whole disconnected group cannot hide a gap.
          const palmDistances = supports.map(support => support.contactCollider(palmCollider, 4)?.distance ?? Infinity);
          const bearingDistances = supports.map(support => support.contactCollider(bearingCollider, 4)?.distance ?? Infinity);
          assert.ok(Math.min(...palmDistances) <= SEATING_TOLERANCE,
            `${mount.name} floats away from the palm at ${angle} degrees: gap ${Math.min(...palmDistances)}.`);
          assert.ok(Math.min(...bearingDistances) <= SEATING_TOLERANCE,
            `${mount.name} does not seat the rotating bearing at ${angle} degrees: gap ${Math.min(...bearingDistances)}.`);
          const assembly = [palmCollider, ...supports, bearingCollider];
          const connected = new Set([0]);
          const pending = [0];
          while (pending.length) {
            const from = pending.pop()!;
            for (let to = 1; to < assembly.length; to++) {
              if (connected.has(to)) continue;
              // Require the connection to pass through the fixed mounting material;
              // direct palm/bearing overlap cannot substitute for an absent bracket.
              if (from === 0 && to === assembly.length - 1) continue;
              const contact = assembly[from].contactCollider(assembly[to], SEATING_TOLERANCE);
              if (contact && contact.distance <= SEATING_TOLERANCE) {
                connected.add(to);
                pending.push(to);
              }
            }
          }
          assert.ok(connected.has(assembly.length - 1),
            `${mount.name} must provide a continuous material path from palm to bearing at ${angle} degrees.`);
        });
        for (let finger = 0; finger < 5; finger++) {
          for (let segment = 0; segment < 3; segment++) {
            const shaft = model.collisionParts.find(part => part.finger === finger && part.segment === segment && part.role === 'shaft');
            assert.ok(shaft, `Finger ${finger}, link ${segment} must include a structural shaft.`);
            const shaftCollider = hull(world, shaft.object, shaft.geometry);
            for (const jointSegment of [segment, segment + 1].filter(index => index < 3)) {
              const bearing = model.collisionParts.find(part => part.finger === finger && part.segment === jointSegment && part.role === 'hinge');
              assert.ok(bearing, `Finger ${finger}, joint ${jointSegment} must include a physical bearing.`);
              const bearingCollider = hull(world, bearing.object, bearing.geometry);
              const gap = shaftCollider.contactCollider(bearingCollider, 4)?.distance ?? Infinity;
              assert.ok(gap <= SEATING_TOLERANCE,
                `Finger ${finger}, shaft ${segment} detaches from bearing ${jointSegment} at ${angle} degrees: gap ${gap}.`);
            }
          }
        }
      } finally { world.free(); }
    }
  } finally { disposeModel(model); }
});
