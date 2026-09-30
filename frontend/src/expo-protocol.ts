export type ExpoLabel = 'open' | 'fist';
export type CaptureStep = { label: ExpoLabel; capturing: boolean; remaining: number; complete: boolean };
export const PREP_SECONDS = 2;
export const HOLD_SECONDS = 5;
export const TOTAL_SECONDS = 2 * (PREP_SECONDS + HOLD_SECONDS);

/** Acquisition timestamps, rather than wall time, delimit the labelled windows. */
export function captureStep(elapsed: number): CaptureStep {
  const phase = Math.max(0, elapsed);
  const second = phase >= PREP_SECONDS + HOLD_SECONDS;
  const local = phase - (second ? PREP_SECONDS + HOLD_SECONDS : 0);
  const capturing = local >= PREP_SECONDS && phase < TOTAL_SECONDS;
  return {
    label: second ? 'fist' : 'open', capturing,
    remaining: Math.max(0, (capturing ? PREP_SECONDS + HOLD_SECONDS : PREP_SECONDS) - local),
    complete: phase >= TOTAL_SECONDS,
  };
}

export function windowLabel(elapsed: number, windowSeconds: number): ExpoLabel | null {
  const step = captureStep(elapsed);
  const start = captureStep(elapsed - windowSeconds);
  return step.capturing && start.capturing && step.label === start.label && !step.complete ? step.label : null;
}

export async function readTrainingEvents(response: Response, accept: (event: any) => void | Promise<void>): Promise<void> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'No se pudo iniciar el entrenamiento.');
  }
  if (!response.body) throw new Error('No llegó la comparación de modelos.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let terminal = false;
  const consume = async (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.message);
    await accept(event);
    if (event.type === 'result') terminal = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop()!;
      for (const line of lines) await consume(line);
      if (done) { await consume(pending); break; }
    }
    if (!terminal) throw new Error('La comparación se interrumpió. Vuelve a entrenar.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
