import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureStep, windowLabel, readTrainingEvents } from '../src/expo-protocol';

test('two five-second captures with preparation and no transition windows', () => {
  assert.equal(captureStep(0).capturing, false);
  assert.equal(captureStep(2).label, 'open');
  assert.equal(captureStep(2).capturing, true);
  assert.equal(windowLabel(2.1, .2), null);
  assert.equal(windowLabel(2.3, .2), 'open');
  assert.equal(windowLabel(7, .2), null);
  assert.equal(captureStep(7).label, 'fist');
  assert.equal(captureStep(7).capturing, false);
  assert.equal(windowLabel(9.1, .2), null);
  assert.equal(windowLabel(9.3, .2), 'fist');
  assert.equal(captureStep(14).complete, true);
  assert.equal(windowLabel(14, .2), null);
});

test('streamed training events survive arbitrary UTF-8 and line boundaries', async () => {
  const bytes = new TextEncoder().encode('{"type":"progress","detail":"Época"}\n{"type":"result","model":{"name":"José"}}');
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events: any[] = [];
  await readTrainingEvents(new Response(stream), event => { events.push(event); });
  assert.equal(events[0].detail, 'Época');
  assert.equal(events[1].model.name, 'José');
});

test('an interrupted stream cannot be presented as successful training', async () => {
  await assert.rejects(readTrainingEvents(new Response('{"type":"progress"}\n'), () => {}), /interrumpió/);
  await assert.rejects(readTrainingEvents(new Response('{"type":"error","message":"Faltan ventanas"}\n'), () => {}), /Faltan ventanas/);
});
