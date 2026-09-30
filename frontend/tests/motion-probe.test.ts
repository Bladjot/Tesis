import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CONTACT_CLEARANCE, HandContactSolver, type CollisionPart } from '../src/hand-contact.ts';
import { HandModel } from '../src/hand-model.ts';
import { planHandPosture } from '../src/hand-posture.ts';

async function fixture() {
  const root = new THREE.Group();
  const finger = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 1));
  root.add(finger, wall);
  let throwOnMotion = false;
  const parts: CollisionPart[] = [
    { id: 'finger', finger: 0, segment: 0, role: 'shell', object: finger, geometry: finger.geometry },
    { id: 'wall', finger: null, segment: -1, role: 'fixed', object: wall, geometry: wall.geometry },
  ];
  const solver = await HandContactSolver.create(parts, angles => {
    finger.position.x = -1 + angles[0] * 0.02;
    if (throwOnMotion && angles[0] > 2) throw new Error('Injected pose failure');
  }, { maxPointTravelPerDegree: 0.02 });
  return { root, finger, wall, solver, setThrow: (value: boolean) => { throwOnMotion = value; } };
}

test('speculative motion is swept, bounded and leaves live motion and collision state unchanged', async () => {
  const f = await fixture(), control = await fixture();
  try {
    for (let frame = 0; frame < 20; frame++) {
      f.solver.step([90, 0, 0, 0, 0], 0.05);
      control.solver.step([90, 0, 0, 0, 0], 0.05);
    }
    const state = f.solver.getState(), contacts = f.solver.inspect();
    const position = f.finger.position.toArray(), matrix = f.finger.matrixWorld.toArray();
    assert.equal(state.limited[0], true);
    const probe = f.solver.probeMotion([0, 0, 0, 0, 0], [90, 0, 0, 0, 0]);
    assert.equal(probe.reached, false);
    assert.equal(probe.limited[0], true);
    assert.ok(probe.achieved[0] > 42 && probe.achieved[0] < 43);
    assert.deepEqual(probe.path[0], [0, 0, 0, 0, 0]);
    assert.ok(probe.contacts.every(contact => contact.distance >= CONTACT_CLEARANCE - 1e-6));
    for (let step = 1; step < probe.path.length; step++) {
      assert.ok(Math.abs(probe.path[step][0] - probe.path[step - 1][0]) <= 6 + 1e-6);
    }
    assert.deepEqual(f.solver.getState(), state);
    assert.deepEqual(f.solver.inspect(), contacts);
    assert.deepEqual(f.finger.position.toArray(), position);
    assert.deepEqual(f.finger.matrixWorld.toArray(), matrix);
    const release = f.solver.probeMotion(state.achieved, [0, 0, 0, 0, 0]);
    assert.equal(release.reached, true);
    assert.deepEqual(f.solver.getState(), state);
    // The contact-direction cache must remain intact; a probe cannot change the next live step.
    assert.deepEqual(f.solver.step([90, 0, 0, 0, 0], 0.05), control.solver.step([90, 0, 0, 0, 0], 0.05));
    assert.deepEqual(f.solver.step([0, 0, 0, 0, 0], 0.05), control.solver.step([0, 0, 0, 0, 0], 0.05));
  } finally { f.solver.dispose(); control.solver.dispose(); }
});

test('invalid speculative start and throwing pose callback both restore live state and scene', async () => {
  const f = await fixture();
  try {
    const state = f.solver.getState(), contacts = f.solver.inspect();
    const position = f.finger.position.toArray(), matrix = f.finger.matrixWorld.toArray();
    assert.throws(() => f.solver.probeMotion([50, 0, 0, 0, 0], [0, 0, 0, 0, 0]), /starts in collision/);
    assert.deepEqual(f.solver.getState(), state);
    assert.deepEqual(f.solver.inspect(), contacts);
    assert.deepEqual(f.finger.position.toArray(), position);
    assert.deepEqual(f.finger.matrixWorld.toArray(), matrix);
    f.setThrow(true);
    assert.throws(() => f.solver.probeMotion([0, 0, 0, 0, 0], [20, 0, 0, 0, 0]), /Injected pose failure/);
    assert.deepEqual(f.solver.getState(), state);
    assert.deepEqual(f.solver.inspect(), contacts);
    assert.deepEqual(f.finger.position.toArray(), position);
    assert.deepEqual(f.finger.matrixWorld.toArray(), matrix);
    f.setThrow(false);
    assert.equal(f.solver.step([6, 0, 0, 0, 0], 0.05).achieved[0], 6);
  } finally { f.solver.dispose(); }
});

test('speculative frame budget and input constraints are explicit', async () => {
  const f = await fixture();
  try {
    const probe = f.solver.probeMotion([0, 0, 0, 0, 0], [30, 0, 0, 0, 0], 1);
    assert.equal(probe.frames, 1);
    assert.equal(probe.reached, false);
    assert.deepEqual(probe.achieved, [6, 0, 0, 0, 0]);
    assert.deepEqual(f.solver.getState().achieved, [0, 0, 0, 0, 0]);
    assert.throws(() => f.solver.probeMotion([0, NaN, 0, 0, 0], [0, 0, 0, 0, 0]), /finite angles/);
    assert.throws(() => f.solver.probeMotion([0, 0, 0, 0, 0], [91, 0, 0, 0, 0]), /finite angles/);
    assert.throws(() => f.solver.probeMotion([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], Infinity), /budget/);
    f.solver.dispose();
    assert.throws(() => f.solver.probeMotion([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), /disposed/);
  } finally { f.solver.dispose(); }
});

test('legacy-v3 numeric regression: worker accepts the exact live contact and reaches open without crossing material', async () => {
  const model = new HandModel('legacy-v3');
  const solver = await HandContactSolver.create(model.collisionParts, angles => {
    model.applyPose(angles);
    // The old thumb curve preserves the precise captured Rapier rounding edge case,
    // independently of subsequent application rig changes. This curve exists only in this fixture.
    const angle = THREE.MathUtils.degToRad(angles[0]);
    model.model.getObjectByName('thumb-mcp')!.rotation.x = angle * 0.52;
    model.model.getObjectByName('thumb-ip')!.rotation.x = angle * 0.86;
  });
  // Captured from the live browser after requesting open from a fist. Rapier's reporting query
  // (.0041 prediction) gives .003999998327344656 here, while its .004 collision query accepts it.
  const browserPose = [66.19232696481566, 81.32123890418873, 0, 0, 0];
  try {
    const initial = solver.getState();
    const accepted = solver.probeMotion(browserPose, [0, 0, 0, 0, 0], 1);
    assert.ok(accepted.contacts.some(contact => contact.fingers.includes(0) && contact.fingers.includes(1)));
    const plan = await planHandPosture(solver, browserPose, [0, 0, 0, 0, 0]);
    assert.equal(plan.reached, true, plan.reason);
    assert.ok(plan.yieldedFingers.some(finger => finger === 0 || finger === 1));
    let achieved = browserPose;
    for (const waypoint of plan.waypoints) {
      const replay = solver.probeMotion(achieved, waypoint, 40);
      assert.equal(replay.reached, true, `Verified waypoint became blocked: ${JSON.stringify(waypoint)}`);
      for (let frame = 1; frame < replay.path.length; frame++) {
        replay.path[frame].forEach((angle, finger) => {
          assert.ok(angle >= 0 && angle <= 90);
          assert.ok(Math.abs(angle - replay.path[frame - 1][finger]) <= 6 + 1e-6);
        });
      }
      assert.ok(replay.contacts.every(contact => contact.distance >= CONTACT_CLEARANCE - 1e-7));
      achieved = replay.achieved;
    }
    assert.deepEqual(achieved, [0, 0, 0, 0, 0]);
    assert.deepEqual(solver.getState(), initial, 'Worker reconstruction cannot change the live state');
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
