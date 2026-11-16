/**
 * Token movement: walk the squares between two progress values, one hop per cell.
 *
 * Deliberately tiny — no timeline, no easing registry, no general tween system. The
 * engine already knows a move's start and end, so this only turns that into a path.
 */

import { DONE, FIRST_HOME_PROGRESS, YARD, type Seat } from '../engine/board.ts';
import { cellCentre, doneSlot, homeCellOf, ringCell, yardSlot } from './geometry.ts';

export interface Waypoint {
  readonly x: number;
  readonly y: number;
}

export interface Hop {
  readonly points: readonly Waypoint[];
  readonly start: number;
  /** Milliseconds for the whole path. */
  readonly duration: number;
  /** Peak lift in grid units on each hop between two waypoints. */
  readonly lift: number;
}

/** Board position for one progress value, ignoring any stacking offset. */
export function unitForProgress(seat: Seat, token: number, progress: number): Waypoint {
  if (progress === YARD) return yardSlot(seat, token);
  if (progress === DONE) return doneSlot(seat, token);
  if (progress >= FIRST_HOME_PROGRESS) return cellCentre(homeCellOf(seat, progress));
  return cellCentre(ringCell(seat, progress));
}

/**
 * Every square the token passes through, so a long move follows the track instead of
 * cutting across the board. The last point is the real drawn destination.
 */
export function pathForMove(
  seat: Seat,
  token: number,
  from: number,
  to: number,
  destination: Waypoint,
): Waypoint[] {
  const points: Waypoint[] = [];
  for (let progress = from; progress <= to; progress += 1) {
    points.push(unitForProgress(seat, token, progress));
  }
  points[points.length - 1] = destination;
  return points;
}

/** Index of the square being crossed right now: 0 at the start, points-1 at the end. */
export function hopSegment(hop: Hop, now: number): number {
  const segments = hop.points.length - 1;
  if (segments <= 0) return 0;
  const t = (now - hop.start) / hop.duration;
  if (t <= 0) return 0;
  if (t >= 1) return segments;
  return Math.min(segments, Math.floor(t * segments));
}

/** Position of a token mid-hop, or null once the hop is over. */
export function hopAt(hop: Hop, now: number): Waypoint | null {
  const t = (now - hop.start) / hop.duration;
  if (t >= 1) return null;
  const last = hop.points.length - 1;
  if (t <= 0 || last === 0) return hop.points[0];

  const span = last * t;
  const index = Math.min(Math.floor(span), last - 1);
  const local = span - index;
  const a = hop.points[index];
  const b = hop.points[index + 1];

  return {
    x: a.x + (b.x - a.x) * local,
    y: a.y + (b.y - a.y) * local - Math.sin(Math.PI * local) * hop.lift,
  };
}

/**
 * Milliseconds one square takes. Constant, so a six-square move lasts six times a
 * one-square move instead of speeding up as the move gets longer.
 */
export const HOP_MS_PER_SQUARE = 265;

/** Time a pawn takes to cross `steps` squares, at that constant speed. */
export function moveDuration(steps: number): number {
  return Math.max(1, steps) * HOP_MS_PER_SQUARE;
}

/**
 * 0..1 attention bounce shared by the die and the eligible pawns: two hops inside the
 * first 900 ms of a 1900 ms cycle, then a 1 s rest. Keeps that rhythm in one place.
 */
export function attentionHop(time: number): number {
  const cycle = time % (ATTENTION_BOUNCE_MS + ATTENTION_REST_MS);
  if (cycle >= ATTENTION_BOUNCE_MS) return 0;
  const t = cycle / ATTENTION_BOUNCE_MS;
  return Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t * 0.35);
}

/** Length of one attention bounce, matching the `seat-die-attention` animation. */
export const ATTENTION_BOUNCE_MS = 900;
/** Silence between two bounces of the same cue. */
export const ATTENTION_REST_MS = 1000;
