import {
  DONE,
  LAST_RING_PROGRESS,
  SEAT_COUNT,
  TOKENS_PER_PLAYER,
  YARD,
  isOnRing,
  isSafeRingIndex,
  ringIndex,
  type Seat,
  type TokenIndex,
} from './board.ts';
import { createRng, type RngState } from './rng.ts';

export type Phase = 'await-roll' | 'await-move' | 'game-over';

export interface TokenRef {
  readonly seat: Seat;
  readonly token: TokenIndex;
}

export interface PlayerState {
  /** Progress per token, in token-index order. See board.ts for the encoding. */
  readonly tokens: readonly number[];
}

export interface GameState {
  readonly seed: number;
  /** Seats in play, in turn order. 2, 3 or 4 entries. */
  readonly seats: readonly Seat[];
  /** Always four entries; seats not in `seats` are never turned and stay in the yard. */
  readonly players: Readonly<Record<Seat, PlayerState>>;
  readonly turn: Seat;
  readonly dice: number | null;
  /** Consecutive sixes by the current seat in the current turn. */
  readonly sixStreak: number;
  readonly phase: Phase;
  readonly winner: Seat | null;
  readonly rng: RngState;
  /** Rolls taken so far. Used by fuzz harnesses to bound a game. */
  readonly rollCount: number;
}

export interface LegalMove extends TokenRef {
  readonly from: number;
  readonly to: number;
  readonly captures: readonly TokenRef[];
  readonly entersBoard: boolean;
}

export type GameEvent =
  | { readonly type: 'rolled'; readonly seat: Seat; readonly dice: number }
  | {
      readonly type: 'moved';
      readonly seat: Seat;
      readonly token: TokenIndex;
      readonly from: number;
      readonly to: number;
      readonly captures: readonly TokenRef[];
    }
  | {
      readonly type: 'skipped';
      readonly seat: Seat;
      readonly reason: 'three-sixes' | 'no-moves';
    }
  | { readonly type: 'won'; readonly seat: Seat };

export type Action =
  | { readonly type: 'roll'; readonly forced?: number }
  | { readonly type: 'move'; readonly token: TokenIndex };

export function createGame(options: {
  seed: number;
  playerCount?: 2 | 3 | 4;
}): GameState {
  const playerCount = options.playerCount ?? 4;
  const seats: Seat[] =
    playerCount === 2
      ? [0, 2] // opposite corners, the usual two-player layout
      : playerCount === 3
        ? [0, 1, 2]
        : [0, 1, 2, 3];

  const players = {} as Record<Seat, PlayerState>;
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    players[seat as Seat] = { tokens: new Array(TOKENS_PER_PLAYER).fill(YARD) };
  }

  return {
    seed: options.seed,
    seats,
    players,
    turn: seats[0],
    dice: null,
    sixStreak: 0,
    phase: 'await-roll',
    winner: null,
    rng: createRng(options.seed),
    rollCount: 0,
  };
}

/** All tokens currently standing on a given ring square. */
export function ringOccupants(state: GameState, ring: number): TokenRef[] {
  const found: TokenRef[] = [];
  for (const seat of state.seats) {
    const tokens = state.players[seat].tokens;
    for (let token = 0; token < TOKENS_PER_PLAYER; token += 1) {
      const progress = tokens[token];
      if (isOnRing(progress) && ringIndex(seat, progress) === ring) {
        found.push({ seat, token: token as TokenIndex });
      }
    }
  }
  return found;
}

/**
 * A blockade is two or more tokens of one seat on the same ring square. Blockades
 * cannot be landed on by opponents; passing them is allowed (documented ruleset
 * choice — the reference also lets a blockade be passed, only not occupied).
 */
export function isBlockedFor(
  state: GameState,
  ring: number,
  mover: Seat,
): boolean {
  const bySeat = new Map<Seat, number>();
  for (const ref of ringOccupants(state, ring)) {
    if (ref.seat === mover) continue;
    bySeat.set(ref.seat, (bySeat.get(ref.seat) ?? 0) + 1);
  }
  for (const count of bySeat.values()) {
    if (count >= 2) return true;
  }
  return false;
}

/** Opponent tokens that would be sent home if `mover` landed on `ring`. */
export function captureTargets(
  state: GameState,
  ring: number,
  mover: Seat,
): TokenRef[] {
  if (isSafeRingIndex(ring)) return [];
  return ringOccupants(state, ring).filter((ref) => ref.seat !== mover);
}

export function legalMoves(state: GameState): LegalMove[] {
  if (state.phase !== 'await-move' || state.dice === null) return [];

  const seat = state.turn;
  const dice = state.dice;
  const tokens = state.players[seat].tokens;
  const moves: LegalMove[] = [];

  for (let token = 0; token < TOKENS_PER_PLAYER; token += 1) {
    const from = tokens[token];
    const index = token as TokenIndex;

    if (from === DONE) continue;

    if (from === YARD) {
      // Entering the board requires a six. Start squares are safe, so entry never captures.
      if (dice !== 6) continue;
      moves.push({
        seat,
        token: index,
        from,
        to: 0,
        captures: [],
        entersBoard: true,
      });
      continue;
    }

    const to = from + dice;
    // Exact roll required to finish; overshooting home is not a legal move.
    if (to > DONE) continue;

    if (to <= LAST_RING_PROGRESS) {
      const ring = ringIndex(seat, to);
      if (isBlockedFor(state, ring, seat)) continue;
      moves.push({
        seat,
        token: index,
        from,
        to,
        captures: captureTargets(state, ring, seat),
        entersBoard: false,
      });
      continue;
    }

    // Home column and the final square: only own tokens can be there.
    moves.push({ seat, token: index, from, to, captures: [], entersBoard: false });
  }

  return moves;
}

/** True when the seat has all four tokens home. */
export function hasWon(state: GameState, seat: Seat): boolean {
  return state.players[seat].tokens.every((progress) => progress === DONE);
}
