import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { HandModel } from '../src/hand-model.ts';
import {
  CONTACT_CLEARANCE, HandContactSolver, MAX_ANGULAR_SPEED, type ContactState,
} from '../src/hand-contact.ts';
import { planHandPosture } from '../src/hand-posture.ts';

const DT = 1 / 60;
const TOLERANCE = 0.05;
const OPEN = Object.freeze([0, 0, 0, 0, 0]);
const POSTURES = {
  open: OPEN,
  fist: Object.freeze([75, 90, 90, 90, 90]),
  pinch: Object.freeze([58, 65, 10, 14, 20]),
  peace: Object.freeze([65, 0, 0, 90, 90]),
};

async function withHand(action: (solver: HandContactSolver) => Promise<void>, articulation: 'current' | 'legacy-v3' = 'current'): Promise<void> {
  const model = new HandModel();
  let solver: HandContactSolver | undefined;
  try {
    solver = await HandContactSolver.create(model.collisionParts, angles => {
      model.applyPose(angles);
      if (articulation === 'legacy-v3') {
        // Retain the actual historical contact traps after the application rig evolves.
        // This archived curve is test-only; all current-geometry posture pairs use applyPose unchanged.
        const angle = THREE.MathUtils.degToRad(angles[0]);
        model.model.getObjectByName('thumb-mcp')!.rotation.x = angle * 0.52;
        model.model.getObjectByName('thumb-ip')!.rotation.x = angle * 0.86;
      }
    });
    await action(solver);
  } finally {
    solver?.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    model.model.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    model.collisionParts.forEach(part => geometries.add(part.geometry));
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }
}

function isAt(achieved: readonly number[], target: readonly number[]): boolean {
  return target.every((value, finger) => Math.abs(value - achieved[finger]) < TOLERANCE);
}

function frame(solver: HandContactSolver, target: readonly number[], context: string): ContactState {
  const previous = solver.getState().achieved;
  const result = solver.step(target, DT);
  result.achieved.forEach((value, finger) => {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 90, `${context}: invalid finger ${finger}: ${value}`);
    assert.ok(Math.abs(value - previous[finger]) <= MAX_ANGULAR_SPEED * DT + 1e-5,
      `${context}: finger ${finger} exceeded angular speed, ${previous[finger]} -> ${value}`);
  });
  const penetrations = solver.inspect().filter(pair => pair.distance < CONTACT_CLEARANCE - 0.00008);
  assert.deepEqual(penetrations, [], `${context}: material clearance violated: ${JSON.stringify(penetrations)}`);
  return result;
}

function direct(solver: HandContactSolver, target: readonly number[], context: string): ContactState {
  let result = solver.getState();
  for (let index = 0; index < 240; index++) {
    result = frame(solver, target, `${context}, frame ${index}`);
    if (isAt(result.achieved, target) || !result.moving) return result;
  }
  return result;
}

async function planned(solver: HandContactSolver, target: readonly number[], context: string) {
  const before = solver.getState();
  const immutableTarget = Object.freeze([...target]);
  const plan = await planHandPosture(solver, before.achieved, immutableTarget);
  assert.deepEqual(solver.getState(), before, `${context}: planning must not mutate the rendered/current contact state`);
  assert.deepEqual(immutableTarget, target, `${context}: assistance must retain the user's final targets`);
  assert.equal(plan.reached, true, `${context}: no route was found: ${plan.reason ?? 'no reason'}`);
  for (const [index, waypoint] of plan.waypoints.entries()) {
    assert.equal(waypoint.length, 5, `${context}: waypoint ${index} must include all five targets`);
    waypoint.forEach(value => assert.ok(Number.isFinite(value) && value >= 0 && value <= 90));
    const result = direct(solver, waypoint, `${context}, waypoint ${index}`);
    assert.ok(isAt(result.achieved, waypoint),
      `${context}: waypoint ${index} stuck at ${JSON.stringify(result.achieved)} instead of ${JSON.stringify(waypoint)}`);
  }
  assert.ok(isAt(solver.getState().achieved, target),
    `${context}: did not restore every final target, actual=${JSON.stringify(solver.getState().achieved)}`);
  return plan;
}

test('all ordered named posture pairs complete without violating material clearance or angular speed', async t => {
  await withHand(async solver => {
    for (const [fromName, source] of Object.entries(POSTURES)) {
      for (const [toName, target] of Object.entries(POSTURES)) {
        await planned(solver, source, `prepare ${fromName} -> ${toName}`);
        const route = await planned(solver, target, `${fromName} -> ${toName}`);
        t.diagnostic(`${fromName} -> ${toName}: ${route.waypoints.length} waypoints, yielded fingers ${route.yieldedFingers.join(',')}`);
      }
    }
  });
});

test('legacy-v3 contact regression: a thumb/index deadlock yields and restores the original all-open command', async t => {
  await withHand(async solver => {
    assert.ok(isAt(direct(solver, POSTURES.fist, 'direct fist').achieved, POSTURES.fist));
    const blocked = direct(solver, OPEN, 'direct fist release');
    assert.ok(!isAt(blocked.achieved, OPEN), 'the regression must reproduce a blocked direct release');
    assert.ok(blocked.contacts.some(pair => pair.fingers.includes(0) && pair.fingers.includes(1)));
    assert.ok(blocked.achieved.slice(2).every(value => value < TOLERANCE), 'unrelated digits should remain independently movable');
    t.diagnostic(`Reproduced fist-release deadlock: ${JSON.stringify(blocked.achieved)}`);
    const route = await planned(solver, OPEN, 'assisted fist release');
    assert.ok(route.yieldedFingers.some(finger => finger === 0 || finger === 1),
      'the trapped thumb/index pair must be identified as temporarily yielding');
  }, 'legacy-v3');
});

test('legacy-v3 contact regression: manual sequencing escapes while the obstructing index is commanded open', async t => {
  await withHand(async solver => {
    assert.ok(isAt(direct(solver, [0, 90, 0, 0, 0], 'fold index first').achieved, [0, 90, 0, 0, 0]));
    assert.ok(isAt(direct(solver, [58, 90, 0, 0, 0], 'oppose thumb second').achieved, [58, 90, 0, 0, 0]));
    const blocked = direct(solver, OPEN, 'manual all-open');
    assert.ok(!isAt(blocked.achieved, OPEN), 'the second manual sequence must reproduce the contact trap');
    t.diagnostic(`Reproduced sequential manual deadlock: ${JSON.stringify(blocked.achieved)}`);
    await planned(solver, OPEN, 'recover manual all-open');
  }, 'legacy-v3');
});

test('legacy-v3 contact regression: a finger at its requested angle yields and returns after the index passes', async t => {
  await withHand(async solver => {
    const target = Object.freeze([53.4, 90, 0, 0, 0]);
    assert.ok(isAt(direct(solver, [53.4, 0, 0, 0, 0], 'thumb first').achieved, [53.4, 0, 0, 0, 0]));
    const blocked = direct(solver, target, 'index encounters opposed thumb');
    assert.equal(blocked.achieved[0], target[0], 'the obstructing thumb has already reached its own command');
    assert.ok(blocked.achieved[1] > 68.6 && blocked.achieved[1] < 68.7,
      `expected the reported 53.4° / 68.7° UI contact, actual ${JSON.stringify(blocked.achieved)}`);
    t.diagnostic(`Reproduced reported rounded contact: ${JSON.stringify(blocked.achieved)}`);
    const route = await planned(solver, target, 'thumb yields for index then returns');
    assert.ok(route.yieldedFingers.includes(0), 'the thumb must temporarily leave its already-achieved target');
    assert.equal(solver.getState().achieved[0], target[0], 'the yielding thumb must return to the original requested angle');
    await planned(solver, OPEN, 'release reported-contact regression');
  }, 'legacy-v3');
});

test('an interrupted assisted route replans from its actual pose and finishes at the latest manual target', async () => {
  await withHand(async solver => {
    direct(solver, POSTURES.fist, 'prepare interrupted fist');
    direct(solver, OPEN, 'prepare interrupted contact');
    const initial = solver.getState();
    const first = await planHandPosture(solver, initial.achieved, POSTURES.pinch);
    assert.equal(first.reached, true);
    assert.deepEqual(solver.getState(), initial);
    assert.ok(first.waypoints.length > 0);
    // A new slider command arrives before the temporary yielding path finishes.
    for (let i = 0; i < 3; i++) frame(solver, first.waypoints[0], `interrupted release frame ${i}`);
    const actual = solver.getState();
    const second = await planHandPosture(solver, actual.achieved, POSTURES.peace);
    assert.equal(second.reached, true);
    assert.deepEqual(solver.getState(), actual);
    if (second.waypoints.length) for (let i = 0; i < 4; i++) frame(solver, second.waypoints[0], `second interruption frame ${i}`);
    await planned(solver, OPEN, 'latest all-open replaces previous route');
    for (let i = 0; i < 4; i++) assert.ok(isAt(frame(solver, OPEN, 'hold latest target').achieved, OPEN));
  });
});

test('cancelled assistance keeps the current pose and never returns a stale route', async () => {
  await withHand(async solver => {
    direct(solver, POSTURES.fist, 'prepare cancelled route');
    const before = solver.getState();
    const cancelled = await planHandPosture(solver, before.achieved, OPEN, { isCancelled: () => true });
    assert.deepEqual(cancelled, { reached: false, waypoints: [], yieldedFingers: [], reason: 'cancelled' });
    assert.deepEqual(solver.getState(), before, 'cancellation may not change the contact state or rendered pose');
    await planned(solver, POSTURES.pinch, 'fresh route after cancellation');
  });
});
