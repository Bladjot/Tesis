import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { HandModel } from '../src/hand-model.ts';
import {
  CONTACT_CLEARANCE, HandContactSolver, MAX_ANGULAR_SPEED,
  type ContactState,
} from '../src/hand-contact.ts';

const OPEN = [0, 0, 0, 0, 0];
const CLOSED = [90, 90, 90, 90, 90];
const FRAME = 1 / 60;
const GEOMETRY_TOLERANCE = 0.00008;
const COLLIDER_POINT_TRAVEL_BOUND = 0.25;

function disposeModel(model: HandModel): void {
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

async function withHand(action: (solver: HandContactSolver, model: HandModel) => void): Promise<void> {
  const model = new HandModel();
  let solver: HandContactSolver | undefined;
  try {
    solver = await HandContactSolver.create(model.collisionParts, angles => model.applyPose(angles));
    action(solver, model);
  } finally {
    solver?.dispose();
    disposeModel(model);
  }
}

function assertSafe(solver: HandContactSolver, context: string): ContactState {
  const state = solver.getState();
  for (const name of ['requested', 'achieved'] as const) {
    assert.equal(state[name].length, 5, `${context}: ${name} must have five continuous controls`);
    state[name].forEach((angle, finger) => {
      assert.ok(Number.isFinite(angle) && angle >= 0 && angle <= 90,
        `${context}: ${name}[${finger}] must be finite and bounded, got ${angle}`);
    });
  }
  const violations = solver.inspect().filter(pair => pair.distance < CONTACT_CLEARANCE - GEOMETRY_TOLERANCE);
  assert.deepEqual(violations, [], `${context}: real enclosure collision / lost clearance: ${JSON.stringify(violations)}`);
  return state;
}

function advance(solver: HandContactSolver, target: readonly number[], frames: number, label: string, dt = FRAME): ContactState {
  let state = solver.getState();
  for (let frame = 0; frame < frames; frame++) {
    const previous = state.achieved;
    solver.step(target, dt);
    state = assertSafe(solver, `${label}, frame ${frame}`);
    const speedBudget = Number.isFinite(dt) && dt > 0 ? MAX_ANGULAR_SPEED * Math.min(dt, 0.05) : 0;
    state.achieved.forEach((angle, finger) => {
      assert.ok(Math.abs(angle - previous[finger]) <= speedBudget + 1e-5,
        `${label}: finger ${finger} teleported from ${previous[finger]} to ${angle}`);
    });
    // Once settled or mechanically stopped, another identical command cannot change the geometry.
    if (frame > 3 && !state.moving) break;
  }
  return state;
}

function assertOpened(state: ContactState, context: string): void {
  state.achieved.forEach((angle, finger) => assert.ok(angle < 0.05,
    `${context}: finger ${finger} stayed stuck at ${angle.toFixed(4)} degrees while reopening`));
}

test('the complete rendered hand starts open with valid material clearance', async () => {
  await withHand((solver, model) => {
    const state = assertSafe(solver, 'initial pose');
    assert.deepEqual(state.achieved, OPEN);
    assert.ok(model.collisionParts.some(part => part.finger === null), 'the palm and wrist must participate');
    for (let finger = 0; finger < 5; finger++) {
      for (const role of ['shell', 'shaft', 'hinge']) {
        assert.ok(model.collisionParts.some(part => part.finger === finger && part.role === role),
          `finger ${finger} must include the actual ${role} material in collision checks`);
      }
    }
  });
});

test('sampled enclosure surface motion stays below the conservative sweep travel bound', t => {
  const model = new HandModel();
  try {
    model.model.updateMatrixWorld(true);
    // A rigid-transform displacement is convex in a local point. Bounding-box corners
    // therefore bound every actual enclosed mesh vertex over each sampled interval.
    const samples = model.collisionParts.filter(part => part.finger !== null).map(part => {
      part.geometry.computeBoundingBox();
      const bounds = part.geometry.boundingBox!;
      const corners: THREE.Vector3[] = [];
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
        }
      }
      return { part, corners, previous: corners.map(corner => corner.clone().applyMatrix4(part.object.matrixWorld)) };
    });
    const step = 0.25;
    const point = new THREE.Vector3();
    let largestSpeed = 0;
    let largestPart = '';
    for (let angle = step; angle <= 90; angle += step) {
      // Each finger depends only on its own command, so the shared sweep samples
      // the full motion range of every branch without requiring a five-dimensional grid.
      model.applyPose([angle, angle, angle, angle, angle]);
      model.model.updateMatrixWorld(true);
      for (const sample of samples) sample.corners.forEach((corner, index) => {
        point.copy(corner).applyMatrix4(sample.part.object.matrixWorld);
        const speed = point.distanceTo(sample.previous[index]) / step;
        if (speed > largestSpeed) { largestSpeed = speed; largestPart = sample.part.id; }
        assert.ok(speed <= COLLIDER_POINT_TRAVEL_BOUND,
          `${sample.part.id} at ${angle} degrees travels ${speed} units/degree, exceeding the sweep bound`);
        sample.previous[index].copy(point);
      });
    }
    assert.ok(largestSpeed > 0, 'the rig must actually move during the sweep');
    t.diagnostic(`Maximum sampled point travel: ${largestSpeed.toFixed(6)} units/degree (${largestPart}); bound ${COLLIDER_POINT_TRAVEL_BOUND}.`);
  } finally {
    disposeModel(model);
  }
});

test('thumb opposition cannot enter the palm and reverses without sticking', async t => {
  await withHand(solver => {
    const closed = advance(solver, [90, 0, 0, 0, 0], 120, 'thumb opposition');
    assert.ok(closed.achieved[0] >= 89.95,
      `the thumb must reach its full opposition range, achieved only ${closed.achieved[0]} degrees`);
    t.diagnostic(`Thumb opposition: ${JSON.stringify({ achieved: closed.achieved, contacts: closed.contacts })}`);
    assert.deepEqual(closed.achieved.slice(1), [0, 0, 0, 0]);
    assertOpened(advance(solver, OPEN, 150, 'thumb release'), 'thumb release');
  });
});

test('a whole-hand close reaches the full command range and reopens without material contact', async t => {
  await withHand(solver => {
    const closed = advance(solver, CLOSED, 150, 'whole-hand close');
    for (let finger = 0; finger < 5; finger++) {
      assert.ok(closed.achieved[finger] >= 89.95,
        `finger ${finger} was falsely blocked at ${closed.achieved[finger]} degrees`);
    }
    t.diagnostic(`Whole-hand closure: ${JSON.stringify({ achieved: closed.achieved, contacts: closed.contacts })}`);
    assertOpened(advance(solver, OPEN, 180, 'whole-hand release'), 'whole-hand release');
  });
});

test('the index closes and releases while the thumb stays opposed, without assistance', async () => {
  await withHand(solver => {
    for (const thumb of [53.4, 65, 75, 90]) {
      const held = [thumb, 0, 0, 0, 0];
      advance(solver, held, 150, `hold thumb at ${thumb}`);
      const closed = advance(solver, [thumb, 90, 0, 0, 0], 180, `close index with thumb at ${thumb}`);
      assert.ok(closed.achieved[1] >= 89.95,
        `The thumb at ${thumb} blocks index closure: ${JSON.stringify(closed.achieved)}; contacts=${JSON.stringify(closed.contacts)}`);
      const released = advance(solver, held, 180, `release index with thumb at ${thumb}`);
      assert.ok(released.achieved[1] < .05,
        `The thumb at ${thumb} traps the opening index: ${JSON.stringify(released.achieved)}; contacts=${JSON.stringify(released.contacts)}`);
      assert.ok(Math.abs(released.achieved[0] - thumb) < .05, 'The thumb must retain its command while the index opens.');
      assertOpened(advance(solver, OPEN, 180, `release thumb from ${thumb}`), `release thumb from ${thumb}`);
    }
  });
});

test('repeated Expo fist commands release the index without a planned route', async () => {
  await withHand(solver => {
    for (let cycle = 0; cycle < 4; cycle++) {
      const closed = advance(solver, [75, 90, 90, 90, 90], 150, `Expo close ${cycle}`);
      assert.ok(closed.achieved[1] >= 89.95, `Expo index stopped at ${closed.achieved[1]}`);
      assertOpened(advance(solver, OPEN, 180, `Expo open ${cycle}`), `Expo open ${cycle}`);
    }
  });
});

test('each finger independently completes its full 0–90 degree range and releases', async () => {
  await withHand(solver => {
    for (let finger = 0; finger < 5; finger++) {
      const target = OPEN.map((_, index) => index === finger ? 90 : 0);
      const closed = advance(solver, target, 150, `independent finger ${finger} close`);
      assert.ok(closed.achieved[finger] >= 89.95,
        `independent finger ${finger} stopped early at ${closed.achieved[finger]} degrees`);
      closed.achieved.forEach((angle, index) => {
        if (index !== finger) assert.ok(angle < 0.05, `moving finger ${finger} moved unrelated finger ${index}`);
      });
      assertOpened(advance(solver, OPEN, 180, `independent finger ${finger} release`), `independent finger ${finger} release`);
    }
  });
});

test('asymmetric continuous commands and mixed reversals keep every rendered enclosure separated', async () => {
  await withHand(solver => {
    const poses = [
      [90, 0, 90, 0, 90],
      [0, 90, 0, 90, 0],
      [73.4, 18.2, 62.7, 31.9, 47.5],
      [90, 90, 0, 0, 0],
      [17.5, 79.3, 44.1, 85.8, 22.2],
      [90, 0, 0, 90, 90],
    ];
    poses.forEach((pose, i) => advance(solver, pose, 65, `asymmetric pose ${i}`));
    assertOpened(advance(solver, OPEN, 180, 'asymmetric release'), 'asymmetric release');
  });
});

test('live-regression outliers, missing values and frame interruptions cannot teleport or corrupt the hand', async () => {
  await withHand(solver => {
    advance(solver, [22.5, 24.3, 25.7, 23.1, 26.4], 35, 'valid regression output');
    const previous = solver.getState();
    solver.step([120, -40, Number.NaN, Number.POSITIVE_INFINITY, 44.25], 0);
    const held = assertSafe(solver, 'bad model output');
    assert.deepEqual(held.achieved, previous.achieved, 'zero elapsed time must hold the pose');
    assert.deepEqual(held.requested, [90, 0, previous.requested[2], previous.requested[3], 44.25]);
    for (const dt of [0.001, 0.05, 2, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      advance(solver, CLOSED, 1, `frame interruption dt=${dt}`, dt);
    }
    solver.step([], FRAME);
    assertSafe(solver, 'missing channels');
    assertOpened(advance(solver, OPEN, 180, 'outlier release'), 'outlier release');
  });
});

test('seeded streaming targets remain collision-free across repeated abrupt reversals', async () => {
  await withHand(solver => {
    let seed = 0x48a7d3c1;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let command = 0; command < 24; command++) {
      const target = Array.from({ length: 5 }, () => random() * 90);
      advance(solver, target, 8, `seeded stream command ${command}`, command % 4 === 0 ? 0.05 : FRAME);
    }
    assertOpened(advance(solver, OPEN, 180, 'stream release'), 'stream release');
  });
});
