import { HandModel } from './hand-model';
import { HandContactSolver } from './hand-contact';
import { planHandPosture, type PlannedPosture } from './hand-posture';

export type PlanningRequest = { revision: number; from: number[]; target: number[] } | { revision: number; cancel: true };
export type PlanningResponse = { revision: number; plan?: PlannedPosture; error?: string };
const host = self as unknown as { onmessage: ((event: MessageEvent<PlanningRequest>) => void) | null; postMessage(message: PlanningResponse): void };
let revision = 0;
let queue: Promise<void> = Promise.resolve();
let ready: Promise<HandContactSolver> | undefined;
const getSolver = () => ready ??= (async () => {
  const model = new HandModel();
  return HandContactSolver.create(model.collisionParts, angles => model.applyPose(angles));
})();
host.onmessage = event => {
  const request = event.data;
  revision = request.revision;
  if ('cancel' in request) return;
  queue = queue.then(async () => {
    if (request.revision !== revision) return;
    try {
      const solver = await getSolver();
      if (request.revision !== revision) return;
      const plan = await planHandPosture(solver, request.from, request.target, {
        isCancelled: () => request.revision !== revision,
        yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)),
      });
      if (request.revision === revision) host.postMessage({ revision, plan });
    } catch (error) {
      if (request.revision === revision) host.postMessage({ revision, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
