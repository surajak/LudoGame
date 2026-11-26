import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hashRandom,
  liveEffects,
  spawnEffect,
  type Effect,
} from '../src/render/effects.ts';

const focus = { x: 7, y: 6 };

function capture(start: number, seed = 3): Effect {
  return spawnEffect('capture', start, focus, '#d9534f', seed);
}

test('an effect carries its focus, colour and duration', () => {
  const effect = capture(1000);
  assert.equal(effect.kind, 'capture');
  assert.equal(effect.start, 1000);
  assert.equal(effect.duration, 2000);
  assert.deepEqual(effect.focus, focus);
  assert.equal(effect.colour, '#d9534f');
  assert.equal(effect.seed, 3);
});

test('an effect plays for its duration and is then dropped', () => {
  const effects = [capture(0)];
  assert.equal(liveEffects(effects, 1999).length, 1);
  assert.equal(liveEffects(effects, 2000).length, 0);
  assert.equal(liveEffects(effects, 9000).length, 0);
});

test('only finished effects are dropped, live ones stay', () => {
  const effects = [capture(0), capture(1500)];
  assert.deepEqual(
    liveEffects(effects, 3000).map((effect) => effect.start),
    [1500],
  );
});

test('the same seed always draws the same particles', () => {
  for (let index = 0; index < 20; index += 1) {
    assert.equal(hashRandom(7, index), hashRandom(7, index));
    assert.ok(hashRandom(7, index) >= 0 && hashRandom(7, index) < 1);
  }
});

test('different seeds draw different particles', () => {
  let differing = 0;
  for (let index = 0; index < 20; index += 1) {
    if (hashRandom(1, index) !== hashRandom(2, index)) differing += 1;
  }
  assert.equal(differing, 20);
});