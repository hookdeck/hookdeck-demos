import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LLM_MODEL, describeLlm } from '../src/llm.ts';
import { FALLBACK_LINES, SCENE_LINES, gestureDelayMs, pickGesture, shouldGesture } from '../src/pixel-lines.ts';

test('the language model is LiveKit Inference gpt-4.1-mini, and the startup line says so', () => {
  assert.equal(LLM_MODEL, 'openai/gpt-4.1-mini');
  assert.equal(describeLlm(), 'LLM: LiveKit Inference openai/gpt-4.1-mini');
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

test('Pixel answers its own turn once, and only its own turn', () => {
  const turn = { turn: 'bot-pixel', turn_seq: '3', scene: 'cave', agent_state: 'speaking' };
  assert.equal(shouldGesture(turn, undefined), 'gesture');
  assert.equal(shouldGesture(turn, '3'), 'idle');
  assert.equal(shouldGesture({ ...turn, turn_seq: '4' }, '3'), 'gesture');
  assert.equal(shouldGesture({ ...turn, turn: 'web-1a2b3c' }, undefined), 'idle');
  assert.equal(shouldGesture({ turn: '' }, undefined), 'idle');
});
