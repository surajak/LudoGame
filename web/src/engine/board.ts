/**
 * Board geometry for classic Ludo.
 *
 * The track is modelled as a single "progress" number per token, which keeps the
 * rules engine independent of any rendering layout:
 *
 *   -1        in the yard (not yet on the board)
 *   0..51     on the shared ring; ring index = (START[seat] + progress) % 52
 *   52..57    in the seat's home column (6 cells, 0 = first cell)
 *   58        home (finished)
 *
 * Progress 51 is the last ring cell: the square immediately counter-clockwise of the
 * seat's own start square, which is where a token turns into its home column.
 */

export const RING_SIZE = 52;
/**
 * Home column cells. A 15×15 board leaves exactly five cells between the arm's outer
 * end and the centre block, so five is the physical answer; the centre counts as "home".
 */
export const HOME_COLUMN = 5;
export const TOKENS_PER_PLAYER = 4;

/** Number of seats on a classic board. A game may use 2, 3 or 4 of them. */
export const SEAT_COUNT = 4;

export type Seat = 0 | 1 | 2 | 3;
export type TokenIndex = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export const YARD = -1;
export const DONE = RING_SIZE + HOME_COLUMN; // 57
export const LAST_RING_PROGRESS = RING_SIZE - 1; // 51
export const FIRST_HOME_PROGRESS = RING_SIZE; // 52

/** Ring index of each seat's start square. Seats sit a quarter of the ring apart. */
export const START: Readonly<Record<Seat, number>> = { 0: 0, 1: 13, 2: 26, 3: 39 };

/**
 * Safe squares: the four start squares plus the four "star" squares eight steps
 * after each start. Tokens standing here cannot be captured.
 */
export const SAFE_RING: ReadonlySet<number> = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export function ringIndex(seat: Seat, progress: number): number {
  return (START[seat] + progress) % RING_SIZE;
}

export function isOnRing(progress: number): boolean {
  return progress >= 0 && progress <= LAST_RING_PROGRESS;
}

export function isInHomeColumn(progress: number): boolean {
  return progress >= FIRST_HOME_PROGRESS && progress < DONE;
}

export function isSafeRingIndex(index: number): boolean {
  return SAFE_RING.has(index);
}

/** Home-column cell 0..5 for a progress value, or null when the token is not there. */
export function homeCell(progress: number): number | null {
  return isInHomeColumn(progress) ? progress - FIRST_HOME_PROGRESS : null;
}
