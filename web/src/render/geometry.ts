/**
 * Board geometry for a classic 15×15 Ludo board.
 *
 * Cell coordinates are `(col, row)` with the origin at the top-left. A cell `i` occupies
 * the unit square `[i, i+1)`, so its centre is `i + 0.5`.
 *
 * The board is a cross 3 cells wide: columns 6–8 and rows 6–8. The 3×3 centre block is
 * home. Each of the four arms contributes 13 ring cells: six along one side, the outer
 * "turn" cell, six along the other side. 4 × 13 = 52.
 *
 * The ring index here is the same number the rules engine uses, which is why the seat
 * starts land on indices 0, 13, 26 and 39 without any remapping.
 */

import {
  DONE,
  FIRST_HOME_PROGRESS,
  START,
  YARD,
  homeCell,
  isInHomeColumn,
  isOnRing,
  ringIndex,
  type Seat,
  type TokenIndex,
} from '../engine/board.ts';
import type { GameState } from '../engine/state.ts';

export const GRID = 15;

export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** Point in grid units (1 = one cell). */
export interface Units {
  readonly x: number;
  readonly y: number;
}

function cells(...items: readonly [number, number][]): Cell[] {
  return items.map(([col, row]) => ({ col, row }));
}

/**
 * The 52-cell ring, clockwise from the top-left arm's outer cell. Four steps are
 * diagonal: that is how the ring turns the corner of the centre block on a real board.
 */
export const RING: readonly Cell[] = cells(
  // row 6, left arm, outer to inner
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  // column 6, up the top arm's left side
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  // top arm turn cell
  [7, 0],
  // column 8, down the top arm's right side
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  // row 6, right arm, inner to outer
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  // right arm turn cell
  [14, 7],
  // row 8, right arm, outer to inner
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  // column 8, down the bottom arm's right side
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  // bottom arm turn cell
  [7, 14],
  // column 6, up the bottom arm's left side
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  // row 8, left arm, inner to outer
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  // left arm turn cell
  [0, 7],
);

if (RING.length !== 52) throw new Error(`ring must have 52 cells, got ${RING.length}`);

/** Home column per seat, outer cell first, ending next to the centre. */
export const HOME: Readonly<Record<Seat, readonly Cell[]>> = {
  0: cells([1, 7], [2, 7], [3, 7], [4, 7], [5, 7]),
  1: cells([7, 1], [7, 2], [7, 3], [7, 4], [7, 5]),
  2: cells([13, 7], [12, 7], [11, 7], [10, 7], [9, 7]),
  3: cells([7, 13], [7, 12], [7, 11], [7, 10], [7, 9]),
};

/** Top-left corner of each seat's 6×6 yard. */
export const YARD_ORIGIN: Readonly<Record<Seat, Cell>> = {
  0: { col: 0, row: 0 },
  1: { col: 9, row: 0 },
  2: { col: 9, row: 9 },
  3: { col: 0, row: 9 },
};

/** The 3×3 home block in the middle of the cross. */
export const CENTRE: Cell = { col: 6, row: 6 };

export const SEAT_COLOURS: Readonly<Record<Seat, string>> = {
  0: '#d9534f', // red, top-left
  1: '#3f9e63', // green, top-right
  2: '#d9a13b', // yellow, bottom-right
  3: '#3c7dc4', // blue, bottom-left
};

export const SEAT_NAMES: Readonly<Record<Seat, string>> = {
  0: 'Red',
  1: 'Green',
  2: 'Yellow',
  3: 'Blue',
};

export function cellCentre(cell: Cell): Units {
  return { x: cell.col + 0.5, y: cell.row + 0.5 };
}

/** Offset of the four resting slots inside a yard, in grid units from its origin. */
const YARD_SLOTS: readonly Units[] = [
  { x: 1.7, y: 1.7 },
  { x: 4.3, y: 1.7 },
  { x: 1.7, y: 4.3 },
  { x: 4.3, y: 4.3 },
];

export function yardSlot(seat: Seat, token: number): Units {
  const origin = YARD_ORIGIN[seat];
  const slot = YARD_SLOTS[token];
  return { x: origin.col + slot.x, y: origin.row + slot.y };
}

/** Where a finished token sits: a small fan inside the centre, on the seat's side. */
export function doneSlot(seat: Seat, token: number): Units {
  const centre = { x: CENTRE.col + 1.5, y: CENTRE.row + 1.5 };
  const angle = (seat * Math.PI) / 2 + Math.PI; // point away from the seat's yard
  const spread = (token - 1.5) * 0.13;
  const radius = 1.02;
  // Tangential offset spreads the four tokens across the seat's triangle.
  const tangentX = Math.cos(angle + Math.PI / 2) * spread;
  const tangentY = Math.sin(angle + Math.PI / 2) * spread;
  return {
    x: centre.x + Math.cos(angle) * radius + tangentX,
    y: centre.y + Math.sin(angle) * radius + tangentY,
  };
}

/** Ring cell for a progress value on the shared track. */
export function ringCell(seat: Seat, progress: number): Cell {
  return RING[ringIndex(seat, progress)];
}

export function homeCellOf(seat: Seat, progress: number): Cell {
  return HOME[seat][homeCell(progress) ?? 0];
}

/** Stable key identifying the square a token occupies, used to stack shared cells. */
function occupancyKey(seat: Seat, progress: number): string | null {
  if (isOnRing(progress)) return `ring:${ringIndex(seat, progress)}`;
  if (isInHomeColumn(progress)) return `home:${seat}:${homeCell(progress)}`;
  if (progress === DONE) return `done:${seat}`;
  return null;
}

export interface TokenPlacement {
  readonly units: Units;
  readonly zone: 'yard' | 'ring' | 'home' | 'done';
}

/**
 * Screen position of every token on the board, with small offsets so tokens sharing a
 * square stay visible. Shared by the renderer and by hit testing, so clicks always land
 * where the token is drawn.
 */
export function tokenPlacements(state: GameState): Map<string, TokenPlacement> {
  const groups = new Map<string, { seat: Seat; token: TokenIndex }[]>();

  for (const seat of state.seats) {
    state.players[seat].tokens.forEach((progress, token) => {
      const key = occupancyKey(seat, progress);
      if (!key) return;
      const list = groups.get(key) ?? [];
      list.push({ seat, token: token as TokenIndex });
      groups.set(key, list);
    });
  }

  const out = new Map<string, TokenPlacement>();

  for (const [key, members] of groups) {
    const [kind] = key.split(':');
    members.forEach((member, index) => {
      const { seat, token } = member;
      const progress = state.players[seat].tokens[token];
      let units: Units;
      let zone: TokenPlacement['zone'];

      if (kind === 'done') {
        units = doneSlot(seat, token);
        zone = 'done';
      } else if (kind === 'home') {
        units = cellCentre(homeCellOf(seat, progress));
        zone = 'home';
      } else {
        units = cellCentre(ringCell(seat, progress));
        zone = 'ring';
      }

      // Nudge tokens apart when they share a square; the middle token stays put.
      if (members.length > 1) {
        const offset = (index - (members.length - 1) / 2) * 0.17;
        units = { x: units.x + offset, y: units.y - Math.abs(offset) * 0.35 };
      }

      out.set(`${seat}:${token}`, { units, zone });
    });
  }

  // Tokens still in the yard never group, so add them directly.
  for (const seat of state.seats) {
    state.players[seat].tokens.forEach((progress, token) => {
      if (progress !== YARD) return;
      out.set(`${seat}:${token}`, { units: yardSlot(seat, token), zone: 'yard' });
    });
  }

  return out;
}

export function progressOf(state: GameState, seat: Seat, token: TokenIndex): number {
  return state.players[seat].tokens[token];
}

export { DONE, FIRST_HOME_PROGRESS, START, YARD, isInHomeColumn, isOnRing };
