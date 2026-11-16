import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTENTION_BOUNCE_MS,
  ATTENTION_REST_MS,
  HOP_MS_PER_SQUARE,
  attentionHop,
  hopAt,
  hopSegment,
  moveDuration,
  pathForMove,
  unitForProgress,
} from '../src/render/motion.ts';

test('a move walks one waypoint per square and ends where the token is drawn', () => {
  const destination = unitForProgress(0, 0, 51);
  const points = pathForMove(0, 0, 49, 51, destination);

  assert.equal(points.length, 3);
  assert.deepEqual(points[2], destination);
  assert.deepEqual(points[0], unitForProgress(0, 0, 49));
});

test('leaving the yard starts the path at the yard slot', () => {
  const points = pathForMove(1, 2, -1, 0, unitForProgress(1, 2, 0));

  assert.equal(points.length, 2);
  assert.deepEqual(points[0], unitForProgress(1, 2, -1));
});

test('a hop starts on its first point and is done when the duration elapses', () => {
  const points = pathForMove(0, 0, 49, 50, unitForProgress(0, 0, 50));
  const hop = { points, start: 1000, duration: 300, lift: 0.2 };

  assert.deepEqual(hopAt(hop, 1000), points[0]);
  assert.equal(hopAt(hop, 1300), null);
  assert.equal(hopAt(hop, 9000), null);
});

test('a hop arcs above the straight line between squares', () => {
  const hop = {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    start: 0,
    duration: 100,
    lift: 0.5,
  };

  const mid = hopAt(hop, 50);
  assert.ok(mid);
  assert.equal(mid.x, 0.5);
  assert.ok(mid.y < -0.4, `expected a lift, got y=${mid.y}`);
});

test('the segment index advances one square at a time', () => {
  const points = pathForMove(0, 0, 49, 51, unitForProgress(0, 0, 51));
  const hop = { points, start: 1000, duration: 200, lift: 0.2 };

  assert.equal(hopSegment(hop, 900), 0);
  assert.equal(hopSegment(hop, 1000), 0);
  assert.equal(hopSegment(hop, 1100), 1);
  assert.equal(hopSegment(hop, 1200), 2);
  assert.equal(hopSegment(hop, 5000), 2);
});

test('a move takes the same time per square, however long it is', () => {
  assert.equal(moveDuration(1), HOP_MS_PER_SQUARE);
  assert.equal(moveDuration(2), HOP_MS_PER_SQUARE * 2);
  assert.equal(moveDuration(6), HOP_MS_PER_SQUARE * 6);
  assert.equal(moveDuration(6) - moveDuration(5), moveDuration(1), 'speed stays constant');
});

test('the attention bounce hops twice, then rests for a second', () => {  assert.equal(attentionHop(0), 0);
  assert.ok(attentionHop(ATTENTION_BOUNCE_MS / 4) > 0.5, 'first hop should peak early');
  assert.ok(attentionHop(ATTENTION_BOUNCE_MS * 0.75) > 0.1, 'second hop should still rise');
  assert.equal(attentionHop(ATTENTION_BOUNCE_MS + 1), 0, 'rest after the bounce');
  assert.equal(attentionHop(ATTENTION_BOUNCE_MS + ATTENTION_REST_MS), 0, 'cycle wraps back to rest');
});
