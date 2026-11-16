import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseLlm, describeLlm } from '../src/llm.ts';
import { FALLBACK_LINES, SCENE_LINES, gestureDelayMs, pickGesture, shouldGesture } from '../src/pixel-lines.ts';

test('LiveKit Inference is the default, and an OpenAI key switches the language model only', () => {
  assert.deepEqual(chooseLlm({}), { kind: 'inference', model: 'openai/gpt-4.1-mini' });
  assert.deepEqual(chooseLlm({ OPENAI_API_KEY: '' }), { kind: 'inference', model: 'openai/gpt-4.1-mini' });
  assert.deepEqual(chooseLlm({ OPENAI_API_KEY: ' ' }), { kind: 'inference', model: 'openai/gpt-4.1-mini' });
  assert.deepEqual(chooseLlm({ OPENAI_API_KEY: 'sk-test' }), { kind: 'openai', model: 'gpt-4.1-mini' });
});

test('the startup line names the path and never contains the key', () => {
  const line = describeLlm(chooseLlm({ OPENAI_API_KEY: 'sk-secret-value' }));
  assert.ok(line.includes('OpenAI') && !line.includes('sk-secret-value'));
  assert.ok(describeLlm(chooseLlm({})).includes('LiveKit Inference'));
});

test('every scene has four to six gesture lines, and a line is not repeated until the pool runs out', () => {
  for (const [scene, lines] of Object.entries(SCENE_LINES)) assert.ok(lines.length >= 4 && lines.length <= 6, scene);
  const used = new Set<string>();
  const picked = SCENE_LINES.cave.map(() => pickGesture('cave', used));
  assert.equal(new Set(picked).size, SCENE_LINES.cave.length);
  assert.ok(picked.every((l) => SCENE_LINES.cave.includes(l)));
});

test('after a scene\'s lines run out, and for an unknown scene, the generic lines are used without repeats', () => {
  const used = new Set<string>(SCENE_LINES.tavern);
  const generic = FALLBACK_LINES.map(() => pickGesture('tavern', used));
  assert.deepEqual(new Set(generic), new Set(FALLBACK_LINES));
  assert.ok(FALLBACK_LINES.includes(pickGesture(undefined, new Set())));
  // once the generic lines are used up too it starts them again instead of failing
  assert.ok(FALLBACK_LINES.includes(pickGesture('tavern', used)));
});

test('the gesture delay is one to three seconds', () => {
  assert.equal(gestureDelayMs(() => 0), 1000);
  assert.equal(gestureDelayMs(() => 0.999), 2998);
});

test('Pixel answers its own turn once, and only when the storyteller is listening', () => {
  const turn = { turn: 'bot-pixel', turn_seq: '3', scene: 'cave', agent_state: 'listening' };
  assert.equal(shouldGesture(turn, undefined), 'gesture');
  assert.equal(shouldGesture({ ...turn, agent_state: 'speaking' }, undefined), 'wait');
  assert.equal(shouldGesture(turn, '3'), 'idle');
  assert.equal(shouldGesture({ ...turn, turn_seq: '4' }, '3'), 'gesture');
  assert.equal(shouldGesture({ ...turn, turn: 'web-1a2b3c' }, undefined), 'idle');
  assert.equal(shouldGesture({ turn: '', agent_state: 'listening' }, undefined), 'idle');
});
