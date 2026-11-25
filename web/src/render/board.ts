/**
 * Canvas renderer. Flat vector style, drawn entirely from geometry — no image assets,
 * no external fonts, nothing to license.
 */

import type { GameState, LegalMove } from '../engine/state.ts';
import { DONE, type Seat } from '../engine/board.ts';
import {
  CENTRE,
  GRID,
  HOME,
  RING,
  SEAT_COLOURS,
  YARD_ORIGIN,
  cellCentre,
  tokenPlacements,
  yardSlot,
  type Cell,
  type Units,
} from './geometry.ts';
import {
  attentionHop,
  hopAt,
  moveDuration,
  pathForMove,
  unitForProgress,
  type Waypoint,
} from './motion.ts';

export interface Layout {
  readonly cell: number;
  readonly originX: number;
  readonly originY: number;
}

const PAPER = '#f7f1e4';
const PAPER_EDGE = '#e4d9c4';
const CELL_FILL = '#fffdf8';
const CELL_STROKE = '#e2d7c3';
const SAFE_FILL = '#f3e8d2';
const STAR = '#b9a98c';

export function computeLayout(width: number, height: number): Layout {
  // The board fills the canvas edge to edge: no margin, so the outer walls sit flush
  // with the screen. The plate keeps a rounded corner, and the page keeps safe-area insets.
  const size = Math.min(width, height);
  const cell = size / GRID;
  return {
    cell,
    originX: (width - cell * GRID) / 2,
    originY: (height - cell * GRID) / 2,
  };
}

function px(layout: Layout, units: Units): { x: number; y: number } {
  return {
    x: layout.originX + units.x * layout.cell,
    y: layout.originY + units.y * layout.cell,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function cellRect(layout: Layout, cell: Cell, inset: number) {
  return {
    x: layout.originX + (cell.col + inset) * layout.cell,
    y: layout.originY + (cell.row + inset) * layout.cell,
    w: layout.cell * (1 - inset * 2),
    h: layout.cell * (1 - inset * 2),
  };
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  colour: string,
): void {
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const r = point % 2 === 0 ? radius : radius * 0.45;
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

function seatOfRing(index: number): Seat | null {
  return index % 13 === 0 ? ((index / 13) as Seat) : null;
}

export interface RenderOptions {
  readonly time: number;
  readonly legal: readonly LegalMove[];
  readonly animate: boolean;
  /** Mid-flight token positions, keyed `seat:token`; overrides the drawn placement. */
  readonly animated?: ReadonlyMap<string, Waypoint>;
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: Layout,
  options: RenderOptions,
): void {
  const { cell, originX, originY } = layout;
  const boardSize = cell * GRID;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Board plate.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = cell * 0.6;
  ctx.shadowOffsetY = cell * 0.18;
  roundRect(ctx, originX, originY, boardSize, boardSize, cell * 0.5);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = Math.max(1, cell * 0.05);
  roundRect(ctx, originX, originY, boardSize, boardSize, cell * 0.5);
  ctx.stroke();

  drawYards(ctx, state, layout, options);
  drawRing(ctx, layout);
  drawHomeColumns(ctx, layout);
  drawCentre(ctx, layout);
  drawMoveHints(ctx, layout, options);
  drawTokens(ctx, state, layout, options);
}

/** Rest between two runs of a move preview. */
const HINT_REST_MS = 700;

/**
 * Preview of each legal move: the squares it crosses, a ring on the landing square, and
 * a ghost marker that hops the same path with the same duration and lift as the real
 * pawn, so the highlight moves exactly like the token will.
 */
function drawMoveHints(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  options: RenderOptions,
): void {
  if (options.legal.length === 0) return;
  const { cell } = layout;

  for (const move of options.legal) {
    const colour = SEAT_COLOURS[move.seat];
    const destination = unitForProgress(move.seat, move.token, move.to);
    const points = pathForMove(move.seat, move.token, move.from, move.to, destination);
    const duration = moveDuration(points.length - 1);
    const travel = options.animate ? options.time % (duration + HINT_REST_MS) : duration;
    const ghost =
      travel < duration ? hopAt({ points, start: 0, duration, lift: 0.22 }, travel) : null;

    ctx.save();
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;

    for (let index = 1; index < points.length; index += 1) {
      const point = px(layout, points[index]);
      if (index === points.length - 1) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, cell * 0.5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = cell * 0.08;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(point.x, point.y, cell * 0.15, 0, Math.PI * 2);
        ctx.globalAlpha = 0.4;
        ctx.fill();
      }
    }

    if (ghost) {
      const at = px(layout, ghost);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(at.x, at.y, cell * 0.19, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(at.x, at.y, cell * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf8';
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawYards(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: Layout,
  options: RenderOptions,
): void {
  const { cell } = layout;

  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const origin = YARD_ORIGIN[seat];
    const colour = SEAT_COLOURS[seat];
    const x = layout.originX + origin.col * cell;
    const y = layout.originY + origin.row * cell;
    const size = cell * 6;
    const active = state.seats.includes(seat) && state.turn === seat && state.phase !== 'game-over';
    const playing = state.seats.includes(seat);

    ctx.save();
    ctx.globalAlpha = playing ? 1 : 0.35;

    roundRect(ctx, x + cell * 0.12, y + cell * 0.12, size - cell * 0.24, size - cell * 0.24, cell * 0.6);
    ctx.fillStyle = '#fbf6ec';
    ctx.fill();
    ctx.lineWidth = cell * (active ? 0.22 : 0.11);
    ctx.strokeStyle = colour;
    ctx.stroke();

    roundRect(ctx, x + cell * 0.75, y + cell * 0.75, size - cell * 1.5, size - cell * 1.5, cell * 0.45);
    ctx.fillStyle = colour;
    ctx.globalAlpha = playing ? 0.1 : 0.05;
    ctx.fill();

    // Resting slots.
    ctx.globalAlpha = playing ? 0.5 : 0.2;
    for (let token = 0; token < 4; token += 1) {
      const slot = px(layout, yardSlot(seat, token));
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, cell * 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = colour;
      ctx.lineWidth = cell * 0.07;
      ctx.stroke();
    }

    // Active seat gets a soft pulse around its yard.
    if (active && options.animate) {
      const pulse = 0.5 + 0.5 * Math.sin(options.time / 520);
      ctx.globalAlpha = 0.12 + pulse * 0.16;
      roundRect(
        ctx,
        x + cell * 0.04,
        y + cell * 0.04,
        size - cell * 0.08,
        size - cell * 0.08,
        cell * 0.7,
      );
      ctx.fillStyle = colour;
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawRing(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const { cell } = layout;
  const radius = cell * 0.16;

  RING.forEach((cellRef, index) => {
    const seat = seatOfRing(index);
    const rect = cellRect(layout, cellRef, 0.055);
    const centre = px(layout, cellCentre(cellRef));

    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);

    if (seat !== null) {
      ctx.fillStyle = SEAT_COLOURS[seat];
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255, 253, 248, 0.65)';
      ctx.lineWidth = cell * 0.06;
      ctx.stroke();
      drawStar(ctx, centre.x, centre.y, cell * 0.26, '#fffdf8');
      return;
    }

    // Star squares: the four safe cells eight steps after each start.
    const safe = index === 8 || index === 21 || index === 34 || index === 47;
    ctx.fillStyle = safe ? SAFE_FILL : CELL_FILL;
    ctx.fill();
    ctx.strokeStyle = CELL_STROKE;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.stroke();

    if (safe) {
      drawStar(ctx, centre.x, centre.y, cell * 0.22, STAR);
    }

    // Arrow on each home-entry cell, pointing into that seat's home column.
    // The triangle is drawn pointing down, so these are rotations from that base.
    const entryAngle: Record<number, number> = { 12: 0, 25: 90, 38: 180, 51: -90 };
    if (index in entryAngle) {
      // Entry cell `START[seat] + 51` belongs to seat `(index + 1) / 13`.
      const seatAtEntry = (((index + 1) / 13) % 4) as Seat;
      const size = cell * 0.3;
      ctx.save();
      ctx.translate(centre.x, centre.y);
      ctx.rotate((entryAngle[index] * Math.PI) / 180);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = SEAT_COLOURS[seatAtEntry];
      ctx.beginPath();
      ctx.moveTo(-size * 0.62, -size);
      ctx.lineTo(size * 0.62, -size);
      ctx.lineTo(0, size * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });
}

function drawHomeColumns(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const { cell } = layout;

  for (const seat of [0, 1, 2, 3] as Seat[]) {
    HOME[seat].forEach((cellRef) => {
      const rect = cellRect(layout, cellRef, 0.055);
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, cell * 0.16);
      ctx.fillStyle = SEAT_COLOURS[seat];
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255, 253, 248, 0.5)';
      ctx.lineWidth = Math.max(1, cell * 0.035);
      ctx.stroke();
    });
  }
}

function drawCentre(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const { cell } = layout;
  const x = layout.originX + CENTRE.col * cell;
  const y = layout.originY + CENTRE.row * cell;
  const size = cell * 3;
  const cx = x + size / 2;
  const cy = y + size / 2;

  const corners: Record<Seat, [Units, Units]> = {
    0: [
      { x, y },
      { x, y: y + size },
    ],
    1: [
      { x, y },
      { x: x + size, y },
    ],
    2: [
      { x: x + size, y },
      { x: x + size, y: y + size },
    ],
    3: [
      { x, y: y + size },
      { x: x + size, y: y + size },
    ],
  };

  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const [a, b] = corners[seat];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fillStyle = SEAT_COLOURS[seat];
    ctx.globalAlpha = 0.88;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = '#fdf9f0';
  ctx.fill();
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = cell * 0.05;
  ctx.stroke();
}

function drawTokens(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: Layout,
  options: RenderOptions,
): void {
  const { cell } = layout;
  const placements = tokenPlacements(state);
  const movable = new Set(options.legal.map((move) => `${move.seat}:${move.token}`));

  for (const [key, placement] of placements) {
    const [seatPart, tokenPart] = key.split(':');
    const seat = Number(seatPart) as Seat;
    if (!state.seats.includes(seat)) continue;
    const token = Number(tokenPart);
    const point = px(layout, options.animated?.get(key) ?? placement.units);
    const finished = state.players[seat].tokens[token] === DONE;
    const colour = SEAT_COLOURS[seat];
    const isMovable = movable.has(key);
    const active = seat === state.turn && state.phase === 'await-move' && isMovable;
    // A playable pawn is drawn larger and bounces with the same rhythm as its die.
    const hop = active && options.animate ? attentionHop(options.time) : 0;
    // Pin half-width. Height runs 3.1x this above the cell point.
    const radius = cell * (finished ? 0.19 : active ? 0.34 : 0.29);

    // Highlight ring under movable tokens.
    if (active) {
      const pulse = options.animate ? 0.3 + 0.7 * hop : 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + cell * (0.13 + pulse * 0.09), 0, Math.PI * 2);
      ctx.strokeStyle = '#2f2618';
      ctx.globalAlpha = 0.22 + pulse * 0.28;
      ctx.lineWidth = cell * 0.07;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawPawn(ctx, point.x, point.y, radius, colour, cell, cell * 0.2 * hop);
  }
}

/**
 * Ludo counter: a map-pin shape in the player's colour, white hole in the head, dark
 * outline. The tip sits on the board point; `lift` raises the pin while the shadow
 * stays on the ground and tightens.
 */
function drawPawn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string,
  cell: number,
  lift = 0,
): void {
  const R = radius;
  const tipY = y - lift;
  const headY = tipY - R * 2.1;
  const air = Math.min(1, lift / (cell * 0.4));

  // Ground contact shadow, smaller and fainter the higher the pin goes.
  ctx.beginPath();
  ctx.ellipse(
    x,
    y + R * 0.18,
    R * (0.62 - air * 0.18),
    R * (0.2 - air * 0.06),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = `rgba(18, 14, 8, ${(0.3 - air * 0.12).toFixed(3)})`;
  ctx.fill();

  // Head circle blended into a tapered tip, one silhouette.
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.bezierCurveTo(x - R * 0.5, tipY - R * 0.9, x - R, headY + R * 0.75, x - R, headY);
  ctx.arc(x, headY, R, Math.PI, 0);
  ctx.bezierCurveTo(x + R, headY + R * 0.75, x + R * 0.5, tipY - R * 0.9, x, tipY);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.11);
  ctx.strokeStyle = '#14110c';
  ctx.stroke();

  // White hole in the head.
  ctx.beginPath();
  ctx.arc(x, headY, R * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf8';
  ctx.fill();
}

