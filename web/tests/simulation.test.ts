import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DONE, createGame, legalMoves, step } from '../src/engine/index.ts';

/**
 * Headless fuzz run. Catches the failure modes unit tests cannot see: unbounded games,
 * rules that make a seat unreachable, and state corruption after thousands of moves.
 *
 * Policy is deliberately random-but-deterministic so failures are reproducible.
 */
function playRandomGame(seed: number, playerCount: 2 | 3 | 4) {
  let state = createGame({ seed, playerCount });
  let guard = 0;
  while (state.phase !== 'game-over' && guard < 50_000) {
    guard += 1;
    state = step(state, { type: 'roll' }).state;
    if (state.phase === 'await-move') {
      const options = legalMoves(state);
      assert.ok(options.length > 0);
      const pick = options[(seed * 7 + guard * 13) % options.length];
      state = step(state, { type: 'move', token: pick.token }).state;
    }
  }
  return { state, guard };
}

test('2000 random games always terminate with a winner', () => {
  const wins = new Map<number, number>();
  const exposure = new Map<number, number>();
  let totalRolls = 0;
  let longest = 0;

  for (let seed = 1; seed <= 2000; seed += 1) {
    const playerCount = ([2, 3, 4] as const)[seed % 3];
    const start = createGame({ seed, playerCount });
    for (const seat of start.seats) {
      exposure.set(seat, (exposure.get(seat) ?? 0) + 1 / playerCount);
    }

    const { state, guard } = playRandomGame(seed, playerCount);

    assert.equal(state.phase, 'game-over', `seed ${seed} (${playerCount}p) did not finish`);
    assert.notEqual(state.winner, null, `seed ${seed} finished without a winner`);

    // The winner must actually have four tokens home.
    assert.deepEqual(
      state.players[state.winner as 0 | 1 | 2 | 3].tokens,
      [DONE, DONE, DONE, DONE],
      `seed ${seed}: winner does not have four tokens home`,
    );

    wins.set(state.winner as number, (wins.get(state.winner as number) ?? 0) + 1);
    totalRolls += state.rollCount;
    longest = Math.max(longest, state.rollCount);
    assert.ok(guard < 50_000, `seed ${seed} hit the guard`);
  }

  const average = totalRolls / 2000;
  console.log(
    `  2000 games | avg ${average.toFixed(0)} rolls | longest ${longest} | ` +
      `wins by seat ${[...wins.entries()].sort().map(([s, w]) => `${s}:${w}`).join(' ')}`,
  );

  // Sanity band: a classic Ludo game should not need absurd numbers of rolls.
  assert.ok(average > 50, `average roll count suspiciously low: ${average}`);
  assert.ok(average < 1200, `average roll count suspiciously high: ${average}`);

  // Seat fairness. Each game awards exactly one win, so a seat's expected win count is
  // its exposure. A large deviation would mean a seat-dependent rules bug (for example
  // a start square that cannot be reached, or a turn order that skips a seat).
  for (const [seat, won] of wins) {
    const expected = exposure.get(seat) ?? 0;
    const drift = Math.abs(won - expected) / expected;
    assert.ok(
      drift < 0.25,
      `seat ${seat} won ${won} games, expected about ${expected.toFixed(0)} (±25%)`,
    );
  }
});


