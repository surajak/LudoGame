import { DONE, SEAT_COUNT, TOKENS_PER_PLAYER, YARD, type Seat, type TokenIndex } from './board.ts';
import { nextDie } from './rng.ts';
import {
  hasWon,
  legalMoves,
  type Action,
  type GameEvent,
  type GameState,
  type LegalMove,
} from './state.ts';

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * Applies one action. Pure: the same (state, action) always yields the same result,
 * because dice come from `state.rng` rather than Math.random().
 *
 * Turn flow, in short:
 *   - a six grants another roll, but three sixes in a row forfeit the turn;
 *   - capturing grants another roll;
 *   - a roll with no legal move passes the turn immediately;
 *   - finishing all four tokens wins, ending the game.
 */
export function step(state: GameState, action: Action): StepResult {
  if (state.phase === 'game-over') {
    throw new Error('game is over');
  }
  switch (action.type) {
    case 'roll':
      return rollDice(state, action.forced);
    case 'move':
      return playMove(state, state.turn, action.token);
    default:
      throw new Error(`unknown action: ${JSON.stringify(action)}`);
  }
}

function rollDice(state: GameState, forced?: number): StepResult {
  if (state.phase !== 'await-roll') {
    throw new Error(`cannot roll while phase is ${state.phase}`);
  }

  let rng = state.rng;
  let dice: number;
  if (forced !== undefined) {
    if (!Number.isInteger(forced) || forced < 1 || forced > 6) {
      throw new Error(`forced dice must be an integer 1..6, got ${forced}`);
    }
    dice = forced;
  } else {
    const rolled = nextDie(rng);
    rng = rolled.rng;
    dice = rolled.value;
  }

  const sixStreak = dice === 6 ? state.sixStreak + 1 : 0;
  const rolledEvent: GameEvent = { type: 'rolled', seat: state.turn, dice };
  const base: GameState = {
    ...state,
    rng,
    dice,
    sixStreak,
    rollCount: state.rollCount + 1,
  };

  // Three sixes in a row forfeits the turn, whatever the board looks like.
  if (dice === 6 && sixStreak >= 3) {
    return {
      state: passTurn(base),
      events: [rolledEvent, { type: 'skipped', seat: state.turn, reason: 'three-sixes' }],
    };
  }

  const candidates = legalMoves({ ...base, phase: 'await-move' });
  if (candidates.length === 0) {
    return {
      state: passTurn(base),
      events: [rolledEvent, { type: 'skipped', seat: state.turn, reason: 'no-moves' }],
    };
  }

  return {
    state: { ...base, phase: 'await-move' },
    events: [rolledEvent],
  };
}

function playMove(state: GameState, seat: Seat, token: TokenIndex): StepResult {
  if (state.phase !== 'await-move') {
    throw new Error(`cannot move while phase is ${state.phase}`);
  }

  const move = legalMoves(state).find((candidate) => candidate.token === token);
  if (!move) {
    throw new Error(`token ${token} has no legal move`);
  }

  const events: GameEvent[] = [
    {
      type: 'moved',
      seat,
      token,
      from: move.from,
      to: move.to,
      captures: move.captures,
    },
  ];

  const players = { ...state.players };
  const own = players[seat].tokens.slice();
  own[token] = move.to;
  players[seat] = { tokens: own };

  for (const victim of move.captures) {
    const tokens = players[victim.seat].tokens.slice();
    tokens[victim.token] = YARD;
    players[victim.seat] = { tokens };
  }

  let next: GameState = { ...state, players, dice: null };

  if (own.every((progress) => progress === DONE)) {
    return {
      state: { ...next, phase: 'game-over', winner: seat, sixStreak: 0 },
      events: [...events, { type: 'won', seat }],
    };
  }

  const earnedExtraRoll = move.captures.length > 0 || state.dice === 6;
  if (earnedExtraRoll) {
    // Same seat rolls again. A six keeps the streak alive; a capture does not.
    return {
      state: {
        ...next,
        phase: 'await-roll',
        turn: seat,
        sixStreak: state.dice === 6 ? state.sixStreak : 0,
      },
      events,
    };
  }

  return { state: passTurn(next), events };
}

/** Hands the turn to the next active seat and clears per-turn scratch state. */
export function passTurn(state: GameState): GameState {
  const index = state.seats.indexOf(state.turn);
  const nextSeat = state.seats[(index + 1) % state.seats.length];
  return {
    ...state,
    turn: nextSeat,
    dice: null,
    sixStreak: 0,
    phase: 'await-roll',
  };
}

export function assertActiveSeats(state: GameState): void {
  if (state.seats.length < 2 || state.seats.length > SEAT_COUNT) {
    throw new Error(`invalid seat count ${state.seats.length}`);
  }
  for (const seat of state.seats) {
    if (state.players[seat].tokens.length !== TOKENS_PER_PLAYER) {
      throw new Error(`seat ${seat} does not have ${TOKENS_PER_PLAYER} tokens`);
    }
  }
}

export { legalMoves, hasWon };
export type { GameState, GameEvent, LegalMove };
