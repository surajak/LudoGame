import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DONE,
  SEATS,
  START,
  YARD,
  ringIndex,
  type Seat,
  type TokenIndex,
} from '../src/engine/board.ts';
import {
  createGame,
  legalMoves,
  step,
  type GameState,
} from '../src/engine/index.ts';

/** Convenience: a state with a chosen dice already showing, as if it had been rolled. */
function atMove(state: GameState, dice: number, seat: Seat = state.turn): GameState {
  return { ...state, turn: seat, dice, sixStreak: dice === 6 ? 1 : 0, phase: 'await-move' };
}

/** Replace one seat's token progress values. */
function withTokens(state: GameState, seat: Seat, tokens: readonly number[]): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { tokens: [...tokens] } },
  };
}

function roll(state: GameState, forced: number) {
  return step(state, { type: 'roll', forced });
}

function move(state: GameState, token: TokenIndex) {
  return step(state, { type: 'move', token });
}

test('a fresh game starts with the first seat to roll and empty yards', () => {
  const game = createGame({ seed: 1 });
  assert.equal(game.phase, 'await-roll');
  assert.equal(game.turn, 0);
  assert.equal(game.dice, null);
  for (const seat of game.seats) {
    assert.deepEqual(game.players[seat].tokens, [YARD, YARD, YARD, YARD]);
  }
});

test('two-player games seat players on opposite corners', () => {
  const game = createGame({ seed: 1, playerCount: 2 });
  assert.deepEqual(game.seats, [0, 2]);
  assert.equal(game.players[1].tokens.length, 4);
});

test('a token can only leave the yard on a six', () => {
  const game = createGame({ seed: 1 });

  // Rolling 3 with everything in the yard leaves no legal move: the turn passes.
  const low = roll(game, 3);
  assert.equal(low.state.turn, 1);
  assert.equal(low.state.phase, 'await-roll');
  assert.deepEqual(
    low.events.map((event) => event.type),
    ['rolled', 'skipped'],
  );

  const six = roll(game, 6);
  assert.equal(six.state.phase, 'await-move');
  assert.equal(legalMoves(six.state).length, 4);

  const entered = move(six.state, 0);
  assert.equal(entered.state.players[0].tokens[0], 0);
  assert.equal(ringIndex(0, entered.state.players[0].tokens[0]), START[0]);
});

test('a six grants another roll, and three sixes forfeit the turn', () => {
  let game = createGame({ seed: 1 });

  const first = roll(game, 6);
  const afterFirst = move(first.state, 0);
  assert.equal(afterFirst.state.turn, 0, 'same seat rolls again after a six');
  assert.equal(afterFirst.state.phase, 'await-roll');

  const second = roll(afterFirst.state, 6);
  const afterSecond = move(second.state, 1);
  assert.equal(afterSecond.state.turn, 0);
  assert.equal(afterSecond.state.sixStreak, 2);

  const third = roll(afterSecond.state, 6);
  assert.equal(third.state.turn, 1, 'third six hands over the turn');
  assert.equal(third.state.sixStreak, 0);
  assert.equal(third.state.phase, 'await-roll');
  assert.deepEqual(
    third.events.map((event) => event.type),
    ['rolled', 'skipped'],
  );
  assert.equal(
    third.events[1].type === 'skipped' ? third.events[1].reason : null,
    'three-sixes',
  );

  // Nothing moved on the forfeited roll.
  game = third.state;
  assert.deepEqual(game.players[0].tokens, [0, 0, YARD, YARD]);
});

test('finishing requires an exact roll', () => {
  const base = createGame({ seed: 1 });
  // Token 0 sits on the last home-column cell (progress 56); DONE is 57.
  const nearHome = withTokens(base, 0, [56, DONE, DONE, DONE]);

  const overshoot = atMove(nearHome, 3);
  assert.deepEqual(legalMoves(overshoot), [], 'progress 59 is past home');

  const exact = atMove(nearHome, 1);
  const moves = legalMoves(exact);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].to, DONE);
});

test('landing on an opponent sends it back to the yard and earns another roll', () => {
  const base = createGame({ seed: 1 });
  // Seat 1 progress 44 -> ring 5 (13 + 44 = 57 -> 5).
  let game = withTokens(base, 0, [0, DONE, DONE, DONE]);
  game = withTokens(game, 1, [44, YARD, YARD, YARD]);
  assert.equal(ringIndex(1, 44), 5);

  const result = move(atMove(game, 5), 0);

  assert.equal(result.state.players[1].tokens[0], YARD, 'victim is sent home');
  assert.equal(result.state.players[0].tokens[0], 5);
  assert.equal(result.state.turn, 0, 'capture earns another roll');
  assert.equal(result.state.phase, 'await-roll');

  const movedEvent = result.events[0];
  assert.equal(movedEvent.type, 'moved');
  if (movedEvent.type === 'moved') {
    assert.deepEqual(movedEvent.captures, [{ seat: 1, token: 0 }]);
  }
});

test('safe squares cannot be captured on', () => {
  const base = createGame({ seed: 1 });
  // Seat 1 progress 47 -> ring 8, a star square.
  let game = withTokens(base, 0, [0, DONE, DONE, DONE]);
  game = withTokens(game, 1, [47, YARD, YARD, YARD]);
  assert.equal(ringIndex(1, 47), 8);

  const result = move(atMove(game, 8), 0);
  assert.equal(result.state.players[1].tokens[0], 47, 'co-existing on a safe square');
  assert.equal(result.state.turn, 1, 'no capture, so no extra roll');
});

test('a blockade of two tokens cannot be landed on, but can be passed', () => {
  const base = createGame({ seed: 1 });
  let game = withTokens(base, 0, [0, DONE, DONE, DONE]);
  // Two seat-1 tokens on ring 5.
  game = withTokens(game, 1, [44, 44, YARD, YARD]);

  const blocked = atMove(game, 5);
  assert.equal(legalMoves(blocked).length, 0, 'cannot land on a blockade');

  // Passing over it is fine: a 7 from progress 0 lands beyond ring 5.
  const pass = move(atMove(game, 6), 0);
  assert.equal(pass.state.players[0].tokens[0], 6);
});

test('own tokens may stack freely', () => {
  const base = createGame({ seed: 1 });
  let game = withTokens(base, 0, [0, DONE, DONE, DONE]);
  const stacked = withTokens(game, 0, [0, 0, DONE, DONE]);
  const result = step(atMove(stacked, 4), { type: 'move', token: 0 });
  assert.deepEqual(result.state.players[0].tokens, [4, 0, DONE, DONE]);
  assert.equal(result.state.turn, 1);
});

test('moving the last token home wins the game', () => {
  const base = createGame({ seed: 1 });
  const game = withTokens(base, 0, [DONE, DONE, DONE, 56]);

  const result = move(atMove(game, 1), 3);
  assert.equal(result.state.phase, 'game-over');
  assert.equal(result.state.winner, 0);
  assert.equal(result.state.players[0].tokens[3], DONE);
  assert.equal(result.events.at(-1)?.type, 'won');

  assert.throws(() => step(result.state, { type: 'roll' }), /game is over/);
});

test('a roll with no legal move passes the turn', () => {
  const base = createGame({ seed: 1 });
  // All tokens home except one needing a 1; rolling a 4 has no legal move.
  const game = withTokens(base, 0, [56, DONE, DONE, DONE]);
  const result = roll(game, 4);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.phase, 'await-roll');
  assert.equal(result.state.dice, null);
});

test('a six with no legal move still ends the turn', () => {
  const base = createGame({ seed: 1 });
  // Everything is home; a six cannot enter the board from the yard.
  const game = withTokens(base, 0, [DONE, DONE, DONE, DONE]);
  const result = roll(game, 6);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.sixStreak, 0);
});

test('same seed and same actions replay to the same state', () => {
  const play = () => {
    let state = createGame({ seed: 2024, playerCount: 4 });
    for (let i = 0; i < 400 && state.phase !== 'game-over'; i += 1) {
      state = step(state, { type: 'roll' }).state;
      if (state.phase === 'await-move') {
        const options = legalMoves(state);
        state = step(state, { type: 'move', token: options[i % options.length].token }).state;
      }
    }
    return state;
  };
  assert.deepEqual(play(), play());
});

test('a token never leaves the legal progress range', () => {
  for (const playerCount of [2, 3, 4] as const) {
    for (let seed = 1; seed <= 25; seed += 1) {
      let state = createGame({ seed, playerCount });
      let guard = 0;
      while (state.phase !== 'game-over' && guard < 20_000) {
        guard += 1;
        state = step(state, { type: 'roll' }).state;
        if (state.phase === 'await-move') {
          const options = legalMoves(state);
          assert.ok(options.length > 0, 'await-move implies a legal move exists');
          state = step(state, {
            type: 'move',
            token: options[guard % options.length].token,
          }).state;
        }
        for (const seat of SEATS) {
          for (const progress of state.players[seat].tokens) {
            assert.ok(progress >= YARD && progress <= DONE, `progress ${progress}`);
          }
        }
      }
      assert.equal(state.phase, 'game-over', `seed ${seed} did not finish`);
      assert.notEqual(state.winner, null);
    }
  }
});

