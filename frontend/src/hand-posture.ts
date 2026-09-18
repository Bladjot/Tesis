import type { HandContactSolver, MotionProbe } from './hand-contact';

export type PlannedPosture = {
  waypoints: number[][];
  yieldedFingers: number[];
  reached: boolean;
  reason?: string;
};
export type PlanningOptions = {
  yieldControl?: () => Promise<void>;
  isCancelled?: () => boolean;
  maxExpansions?: number;
};
type Node = { pose: number[]; path: number[][]; cost: number; yielded: number[]; contacts: number[] };
const distance = (a: readonly number[], b: readonly number[]) => a.reduce((sum, angle, i) => sum + Math.abs(angle - b[i]), 0);
const key = (pose: readonly number[]) => pose.map(angle => Math.round(angle * 2)).join(',');

/** Search verified joint-space motions. A blocking digit may move away from its own
 * target temporarily, but the complete route always restores ALL requested targets.
 * This runs in a worker; speculative poses never appear in the rendered hand.
 */
export async function planHandPosture(solver: HandContactSolver, from: readonly number[], requested: readonly number[],
  options: PlanningOptions = {}): Promise<PlannedPosture> {
  const target = Array.from({ length: 5 }, (_, i) => Number.isFinite(requested[i]) ? Math.max(0, Math.min(90, requested[i])) : from[i]);
  const frontier: Node[] = [{ pose: [...from], path: [], cost: 0, yielded: [], contacts: [] }];
  const visited = new Map<string, number>();
  const budget = Math.min(80, Math.max(1, options.maxExpansions ?? 32));
  const pause = options.yieldControl ?? (() => Promise.resolve());
  const cancelled = () => options.isCancelled?.() ?? false;
  const probe = (pose: readonly number[], goal: readonly number[]): MotionProbe => solver.probeMotion(pose, goal, 40);
  const enqueue = (node: Node) => {
    const id = key(node.pose);
    if ((visited.get(id) ?? Infinity) <= node.cost) return;
    visited.set(id, node.cost);
    frontier.push(node);
  };
  for (let expansion = 0; expansion < budget && frontier.length; expansion++) {
    if (cancelled()) return { waypoints: [], yieldedFingers: [], reached: false, reason: 'cancelled' };
    frontier.sort((a, b) => a.cost + distance(a.pose, target) * 1.8 - b.cost - distance(b.pose, target) * 1.8);
    const node = frontier.shift()!;
    const direct = probe(node.pose, target);
    const directPath = [...node.path, ...direct.path.slice(1)];
    if (direct.reached) return { waypoints: directPath, yieldedFingers: node.yielded, reached: true };
    const base = direct.achieved;
    const baseCost = node.cost + distance(node.pose, base);
    const involved = [...new Set(direct.contacts.flatMap(contact => contact.fingers))];
    if (distance(node.pose, base) > 0.5) enqueue({ pose: base, path: directPath, cost: baseCost, yielded: node.yielded, contacts: involved });
    if (!direct.limited.some(Boolean) && distance(node.pose, base) > 0.5) { await pause(); continue; }
    const candidates = involved.length ? involved : (node.contacts.length ? node.contacts :
      target.flatMap((angle, finger) => Math.abs(angle - base[finger]) > 0.05 ? [finger] : []));
    for (const finger of candidates) {
      const alternatives = [...new Set([0, 90, Math.max(0, base[finger] - 20), Math.min(90, base[finger] + 20)])]
        .filter(angle => Math.abs(angle - base[finger]) > 1);
      for (const angle of alternatives) {
        await pause();
        if (cancelled()) return { waypoints: [], yieldedFingers: [], reached: false, reason: 'cancelled' };
        const clearTarget = [...base];
        clearTarget[finger] = angle;
        const clearing = probe(base, clearTarget);
        if (distance(base, clearing.achieved) < 0.25) continue;
        const path = [...directPath, ...clearing.path.slice(1)];
        const yielded = [...new Set([...node.yielded, finger])];
        const cost = baseCost + distance(base, clearing.achieved);
        const retry = probe(clearing.achieved, target);
        if (retry.reached) return { waypoints: [...path, ...retry.path.slice(1)], yieldedFingers: yielded, reached: true };
        enqueue({ pose: clearing.achieved, path, cost, yielded, contacts: retry.contacts.flatMap(contact => contact.fingers) });
        if (distance(clearing.achieved, retry.achieved) > 0.5) enqueue({
          pose: retry.achieved, path: [...path, ...retry.path.slice(1)],
          cost: cost + distance(clearing.achieved, retry.achieved), yielded,
          contacts: retry.contacts.flatMap(contact => contact.fingers),
        });
      }
    }
    await pause();
  }
  return { waypoints: [], yieldedFingers: [], reached: false, reason: 'No se encontró un recorrido libre dentro del límite de búsqueda.' };
}
