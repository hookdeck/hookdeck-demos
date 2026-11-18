import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LLM_MODEL, describeLlm } from '../src/llm.ts';
import { SCENE_LINES, gestureDelayMs, shouldGesture } from '../src/pixel-lines.ts';

test('the language model is LiveKit Inference gpt-4.1-mini, and the startup line says so', () => {
  assert.equal(LLM_MODEL, 'openai/gpt-4.1-mini');
  assert.equal(describeLlm(), 'LLM: LiveKit Inference openai/gpt-4.1-mini');
});

test('the gesture delay is one to three seconds', () => {
  assert.equal(gestureDelayMs(() => 0), 1000);
  assert.equal(gestureDelayMs(() => 0.999), 2998);
});

test('Pixel answers its own turn once, and only its own turn', () => {
  const ask = { pixel_seq: '3', line: '*Pixel nods.*' };
  assert.equal(shouldGesture(ask, undefined), 'gesture');
  assert.equal(shouldGesture(ask, '3'), 'idle');
  assert.equal(shouldGesture({ ...ask, pixel_seq: '4' }, '3'), 'gesture');
  assert.equal(shouldGesture({ pixel_seq: '5' }, undefined), 'idle'); // no line, nothing to send
  assert.equal(shouldGesture({}, undefined), 'idle');
});


test('every place has a few gesture lines', () => {
  for (const [place, lines] of Object.entries(SCENE_LINES)) assert.ok(lines.length >= 2, place);
});
