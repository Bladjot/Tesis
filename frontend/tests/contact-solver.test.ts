import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CONTACT_CLEARANCE, HandContactSolver, type CollisionPart } from '../src/hand-contact.ts';
import { HandModel } from '../src/hand-model.ts';
import { planHandPosture } from '../src/hand-posture.ts';

function fixture() {
  const root = new THREE.Group();
  const parts: CollisionPart[] = [];
  const add = (id: string, finger: number | null, width: number, height: number, depth: number,
    x = 0, y = 0, segment = 0, role: CollisionPart['role'] = finger === null ? 'fixed' : 'shell') => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const object = new THREE.Mesh(geometry);
    object.position.set(x, y, 0);
    root.add(object);
    parts.push({ id, finger, segment, role, geometry, object });
    return object;
  };
  return { root, parts, add };
}

function safe(solver: HandContactSolver) {
  for (const contact of solver.inspect()) {
    assert.ok(contact.distance >= CONTACT_CLEARANCE - 1e-6,
      `${contact.a}/${contact.b} penetrated its safety clearance: ${contact.distance}`);
  }
}

test('a swept thin obstruction blocks a command even when its endpoint lies beyond the wall', async () => {
  const f = fixture();
  const finger = f.add('fingertip', 0, 0.02, 0.2, 0.2, -0.477);
  f.add('thin wall', null, 0.001, 1, 1);
  // At 0.25 degrees per naive sample the tip can jump completely across this wall.
  const solver = await HandContactSolver.create(f.parts, angles => {
    finger.position.x = -0.477 + angles[0] * 0.25;
  }, { maxPointTravelPerDegree: 0.25 });
  try {
    const state = solver.step([90, 0, 0, 0, 0], 10);
    assert.equal(state.requested[0], 90);
    assert.ok(state.achieved[0] > 1.7 && state.achieved[0] < 1.9, `Unexpected stop: ${state.achieved[0]}`);
    assert.equal(state.limited[0], true);
    assert.ok(state.contacts.some(contact => contact.a === 'fingertip' && contact.b === 'thin wall'));
    assert.ok(finger.position.x < 0);
    safe(solver);
    for (let i = 0; i < 5; i++) { solver.step([0, 0, 0, 0, 0], 1 / 60); safe(solver); }
    assert.ok(solver.getState().achieved[0] < 1e-5, 'Opening must release contact without a deadlock');
    assert.equal(solver.getState().limited[0], false);
  } finally { solver.dispose(); }
});

test('a blocked thumb does not freeze another finger or corrupt its requested command', async () => {
  const f = fixture();
  const thumb = f.add('thumb', 0, 0.2, 0.2, 0.2, -1);
  const index = f.add('index', 1, 0.2, 0.2, 0.2, -1, 2);
  f.add('palm', null, 0.15, 1, 1);
  const solver = await HandContactSolver.create(f.parts, angles => {
    thumb.position.x = -1 + angles[0] * 0.02;
    index.position.x = -1 + angles[1] * 0.02;
  }, { maxPointTravelPerDegree: 0.02 });
  try {
    for (let i = 0; i < 80; i++) { solver.step([90, 90, 0, 0, 0], 1 / 60); safe(solver); }
    const state = solver.getState();
    assert.deepEqual(state.requested, [90, 90, 0, 0, 0]);
    assert.ok(state.achieved[0] > 40 && state.achieved[0] < 42);
    assert.equal(state.achieved[1], 90);
    assert.equal(state.limited[0], true);
    for (let i = 0; i < 80; i++) { solver.step([0, 0, 0, 0, 0], 1 / 60); safe(solver); }
    assert.deepEqual(solver.getState().achieved, [0, 0, 0, 0, 0]);
  } finally { solver.dispose(); }
});

test('fingers collide with each other and can separate again', async () => {
  const f = fixture();
  const a = f.add('thumb', 0, 0.2, 0.2, 0.2, -0.8);
  const b = f.add('index', 1, 0.2, 0.2, 0.2, 0.8);
  const solver = await HandContactSolver.create(f.parts, angles => {
    a.position.x = -0.8 + angles[0] * 0.01;
    b.position.x = 0.8 - angles[1] * 0.01;
  }, { maxPointTravelPerDegree: 0.01 });
  try {
    for (let i = 0; i < 60; i++) { solver.step([90, 90, 0, 0, 0], 1 / 60); safe(solver); }
    assert.ok(b.position.x - a.position.x >= 0.2 + CONTACT_CLEARANCE - 1e-6);
    assert.ok(solver.getState().limited.some(Boolean));
    for (let i = 0; i < 60; i++) { solver.step([0, 0, 0, 0, 0], 1 / 60); safe(solver); }
    assert.deepEqual(solver.getState().achieved, [0, 0, 0, 0, 0]);
  } finally { solver.dispose(); }
});

test('coordinated rigid motion releases mutually blocked digits without spending their speed budget twice', async () => {
  const f = fixture();
  const centers = [[-0.103, -0.103], [0.103, -0.103], [0.103, 0.103], [-0.103, 0.103]];
  const digits = centers.map(([x, y], finger) => f.add(`digit ${finger}`, finger, 0.2, 0.2, 0.1, x, y));
  const solver = await HandContactSolver.create(f.parts, angles => {
    digits.forEach((digit, finger) => {
      const rotation = angles[finger] * 0.01;
      const [x, y] = centers[finger];
      digit.position.set(x * Math.cos(rotation) - y * Math.sin(rotation),
        x * Math.sin(rotation) + y * Math.cos(rotation), 0);
      digit.rotation.z = rotation;
    });
  }, { maxPointTravelPerDegree: 0.01 });
  try {
    // Every separate rotation catches a neighbouring corner. Rotating the whole arrangement
    // preserves the 0.006 gap, so a sequential-only solver incorrectly locks all four bodies.
    for (const target of [[80, 80, 80, 80, 0], [0, 0, 0, 0, 0]]) {
      for (let frame = 0; frame < 100; frame++) {
        const before = solver.getState().achieved;
        const state = solver.step(target, 1 / 60);
        state.achieved.forEach((angle, finger) => assert.ok(Math.abs(angle - before[finger]) <= 2 + 1e-6));
        safe(solver);
      }
      assert.deepEqual(solver.getState().achieved, target);
    }
  } finally { solver.dispose(); }
});

test('the real thumb and index can disengage a fist before reaching the pinch posture', async () => {
  const model = new HandModel();
  const solver = await HandContactSolver.create(model.collisionParts, angles => model.applyPose(angles));
  const advance = (target: number[]): void => {
    for (let frame = 0; frame < 150; frame++) {
      const before = solver.getState().achieved;
      const state = solver.step(target, 1 / 60);
      state.achieved.forEach((angle, finger) => assert.ok(Math.abs(angle - before[finger]) <= 2 + 1e-6));
      safe(solver);
      if (!state.moving || state.achieved.every((angle, finger) => Math.abs(angle - target[finger]) < 0.05)) return;
    }
  };
  try {
    advance([75, 90, 90, 90, 90]);
    // A direct decrease can bring the terminal index cap against the proximal thumb casing.
    // The solver must preserve this material boundary, not teleport across it to the target.
    advance([58, 65, 10, 14, 20]);
    const target = [58, 65, 10, 14, 20];
    const transition = await planHandPosture(solver, solver.getState().achieved, target);
    assert.equal(transition.reached, true, 'the actual named-posture transition must have a collision-free route');
    for (const waypoint of transition.waypoints) advance(waypoint);
    solver.getState().achieved.forEach((angle, finger) => assert.ok(Math.abs(angle - target[finger]) < 0.05,
      `Retraction left finger ${finger} blocked at ${angle}`));
  } finally {
    solver.dispose();
    const geometries = new Set(model.collisionParts.map(part => part.geometry));
    const materials = new Set<THREE.Material>();
    model.model.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }
});

test('two nonadjacent links on one finger use both point-motion bounds', async () => {
  const f = fixture();
  const a = f.add('proximal shell', 0, 0.02, 0.1, 0.1, -0.1, 0, 0);
  const b = f.add('terminal shell', 0, 0.02, 0.1, 0.1, 0.1, 0, 2);
  const solver = await HandContactSolver.create(f.parts, angles => {
    a.position.x = -0.1 + angles[0] * 0.25;
    b.position.x = 0.1 - angles[0] * 0.25;
  }, { maxPointTravelPerDegree: 0.25 });
  try {
    solver.step([90, 0, 0, 0, 0], 0.05);
    safe(solver);
    assert.ok(b.position.x - a.position.x >= 0.02 + CONTACT_CLEARANCE - 1e-6);
    assert.equal(solver.getState().limited[0], true);
    for (let i = 0; i < 8; i++) solver.step([0, 0, 0, 0, 0], 1 / 60);
    assert.equal(solver.getState().achieved[0], 0);
  } finally { solver.dispose(); }
});

test('scaled rotated collision geometry encloses the visible mesh', async () => {
  const f = fixture();
  const finger = f.add('scaled finger', 0, 1, 1, 1, -2);
  finger.scale.set(0.4, 0.1, 0.2);
  finger.rotation.z = Math.PI / 4;
  f.add('palm', null, 0.3, 1, 1);
  const solver = await HandContactSolver.create(f.parts, angles => { finger.position.x = -2 + angles[0] * 0.025; },
    { maxPointTravelPerDegree: 0.025 });
  try {
    for (let i = 0; i < 60; i++) solver.step([90, 0, 0, 0, 0], 1 / 60);
    const expectedHalfWidth = (0.4 + 0.1) / 2 / Math.sqrt(2);
    assert.ok(Math.abs(finger.position.x - (-0.15 - expectedHalfWidth - CONTACT_CLEARANCE)) < 0.0001);
    safe(solver);
  } finally { solver.dispose(); }
});

test('joint limits, malformed values, delta time, and state snapshots are bounded', async () => {
  const f = fixture();
  const finger = f.add('finger', 0, 0.1, 0.1, 0.1);
  const solver = await HandContactSolver.create(f.parts, angles => { finger.position.x = angles[0] * 0.01; });
  try {
    assert.equal(solver.step([1000, -1000, NaN, Infinity], 0.01).achieved[0], 1.2);
    assert.deepEqual(solver.getState().requested, [90, 0, 0, 0, 0]);
    const unchanged = solver.getState().achieved;
    assert.deepEqual(solver.step([NaN], -1).achieved, unchanged);
    assert.deepEqual(solver.step([NaN], Infinity).achieved, unchanged);
    assert.deepEqual(solver.step([], 0).achieved, unchanged);
    const capped = solver.step([90], 10000);
    assert.ok(Math.abs(capped.achieved[0] - 7.2) < 1e-9);
    capped.achieved[0] = -999;
    assert.ok(solver.getState().achieved[0] >= 0);
    for (let i = 0; i < 20; i++) solver.step([1000], 0.05);
    assert.equal(solver.getState().achieved[0], 90);
  } finally { solver.dispose(); }
  assert.throws(() => solver.step([0], 0.01), /disposed/);
  solver.dispose();
});

test('invalid starting geometry fails before simulation begins', async () => {
  const f = fixture();
  f.add('palm', null, 1, 1, 1);
  f.add('embedded thumb shell', 0, 0.2, 0.2, 0.2);
  await assert.rejects(HandContactSolver.create(f.parts, () => {}), /palm \/ embedded thumb shell/);
});

test('joint exclusions permit mounting bearings but do not hide adjacent shell collisions', async () => {
  const mounting = fixture();
  mounting.add('palm', null, 1, 1, 1);
  mounting.add('bearing', 0, 0.2, 0.2, 0.2, 0, 0, 0, 'hinge');
  const solver = await HandContactSolver.create(mounting.parts, () => {});
  solver.dispose();

  const adjacent = fixture();
  adjacent.add('proximal shell', 0, 1, 1, 1, 0, 0, 0);
  adjacent.add('distal shell', 0, 1, 1, 1, 0.8, 0, 1);
  await assert.rejects(HandContactSolver.create(adjacent.parts, () => {}), /proximal shell \/ distal shell/);

  const socket = fixture();
  socket.add('parent shaft', 0, 1, 1, 1, 0, 0, 0, 'shaft');
  socket.add('child bearing', 0, 0.2, 0.2, 0.2, 0, 0, 1, 'hinge');
  const connected = await HandContactSolver.create(socket.parts, () => {});
  connected.dispose();

  for (const [parentRole, childRole] of [['shell', 'hinge'], ['hinge', 'shell'], ['hinge', 'shaft'], ['hinge', 'hinge']] as const) {
    const invalid = fixture();
    invalid.add(`parent ${parentRole}`, 0, 1, 1, 1, 0, 0, 0, parentRole);
    invalid.add(`child ${childRole}`, 0, 0.2, 0.2, 0.2, 0, 0, 1, childRole);
    await assert.rejects(HandContactSolver.create(invalid.parts, () => {}), /initial hand pose intersects/);
  }
});
