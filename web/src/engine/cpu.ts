/**
 * Computer opponent: a one-ply heuristic, no search.
 *
 * Priorities, highest first:
 *   1. a six opens a new pawn from the yard;
 *   2. save a pawn an opponent could reach on the next roll;
 *   3. capture an opponent pawn;
 *   4. finish a pawn, stand on a safe square, or simply advance the furthest pawn.
 */

import {
  DONE,
  LAST_RING_PROGRESS,
  RING_SIZE,
  isSafeRingIndex,
  ringIndex,
  type Seat,
  type TokenIndex,
} from './board.ts';
import type { GameState, LegalMove } from './state.ts';

/** How close an opponent is to `ring`: 6 for one square behind, 0 when nobody can reach. */
function threat(state: GameState, seat: Seat, ring: number): number {
  let danger = 0;
  for (const other of state.seats) {
    if (other === seat) continue;
    for (const progress of state.players[other].tokens) {
      if (progress < 0 || progress > LAST_RING_PROGRESS) continue;
      const gap = (ring - ringIndex(other, progress) + RING_SIZE) % RING_SIZE;
      if (gap >= 1 && gap <= 6) danger = Math.max(danger, 7 - gap);
    }
  }
  return danger;
}

/** Picks the token to move for the seat whose turn it is. */
export function chooseCpuMove(
  state: GameState,
  moves: readonly LegalMove[],
): TokenIndex | null {
  if (moves.length === 0) return null;

  if (state.dice === 6) {
    const fresh = moves.find((move) => move.entersBoard);
    if (fresh) return fresh.token;
  }

  const seat = state.turn;
  let best: LegalMove | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    const before =
      move.from >= 0 && move.from <= LAST_RING_PROGRESS
        ? threat(state, seat, ringIndex(seat, move.from))
        : 0;
    const after =
      move.to <= LAST_RING_PROGRESS ? threat(state, seat, ringIndex(seat, move.to)) : 0;

    let score = 0;
    // Saving a pawn beats hunting one.
    if (before > 0 && after === 0) score += 600;
    if (after > before) score -= 200;
    score += move.captures.length * 400;
    if (move.to === DONE) score += 300;
    if (move.to <= LAST_RING_PROGRESS && isSafeRingIndex(ringIndex(seat, move.to))) {
      score += 60;
    }
    // Tie-break: push the pawn that is furthest along.
    score += move.to * 0.1;

    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return best ? best.token : null;
}
