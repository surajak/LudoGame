/**
 * Event effects drawn on the board canvas, board-wide and time-limited.
 *
 * No GIFs, no sprites, no libraries: every effect is vector work in the same
 * requestAnimationFrame loop that draws the board, so the bundle keeps its
 * zero-dependency, single-file property. Randomness comes from `hashRandom`,
 * a hash of the effect's seed and the particle index, so a seed always draws
 * the same picture and the unit tests stay deterministic.
 *
 *   enter   a pawn leaves the yard            1.2s
 *   capture a pawn sends an opponent home     2.0s
 *   home    a pawn reaches its home column    2.0s
 *   win     a seat finishes all four          2.4s
 */

import type { Units } from './geometry.ts';

export type EffectKind = 'capture' | 'home' | 'enter' | 'win';

export interface Effect {
  readonly kind: EffectKind;
  /** Frame time the effect started, in the same clock the render loop uses. */
  readonly start: number;
  /** How long it plays, in milliseconds. */
  readonly duration: number;
  readonly seed: number;
  /** Focus point in board units, the square the event happened on. */
  readonly focus: Units;
  readonly colour: string;
}

const DURATION: Readonly<Record<EffectKind, number>> = {
  enter: 1200,
  capture: 2000,
  home: 2000,
  win: 2400,
};

const GOLD = '#e0a92c';

/** Stable number in [0, 1) from a seed and an index. */
export function hashRandom(seed: number, index: number): number {
  const value = Math.sin(seed * 127.1 + index * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function spawnEffect(
  kind: EffectKind,
  now: number,
  focus: Units,
  colour: string,
  seed: number,
): Effect {
  return { kind, start: now, duration: DURATION[kind], seed, focus, colour };
}

/** Drops effects that have played out. Pure, so tests can drive it directly. */
export function liveEffects(effects: readonly Effect[], now: number): Effect[] {
  return effects.filter((effect) => now - effect.start < effect.duration);
}

/** 0..1 through the effect's life. */
function progress(effect: Effect, now: number): number {
  return Math.min(1, Math.max(0, (now - effect.start) / effect.duration));
}

/** Slight ease-out so the outer edge lags the inner flash. */
function ease(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** One circle outline, drawn in the effect's glow blend mode. */
function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  width: number,
  colour: string,
): void {
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** Straight sparks flying outward, angles and speeds from the seed. */
function sparks(
  ctx: CanvasRenderingContext2D,
  effect: Effect,
  x: number,
  y: number,
  cell: number,
  t: number,
  fade: number,
  count: number,
  minSpeed: number,
  maxSpeed: number,
  tail: number,
  colour: string,
  upperOnly = false,
): void {
  ctx.globalAlpha = 0.9 * fade;
  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.strokeStyle = colour;
  for (let i = 0; i < count; i += 1) {
    // Upper half only means negative angles: the board's y axis grows downward.
    const angle = upperOnly
      ? -Math.PI * hashRandom(effect.seed, i)
      : hashRandom(effect.seed, i) * Math.PI * 2;
    const speed = minSpeed + (maxSpeed - minSpeed) * hashRandom(effect.seed, i + count);
    const inner = cell * (0.4 + speed * ease(t));
    const outer = inner + cell * tail * hashRandom(effect.seed, i + count * 2);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(x + cos * inner, y + sin * inner);
    ctx.lineTo(x + cos * outer, y + sin * outer);
    ctx.stroke();
  }
}

/** A bright disc that decays fast, the "hit" of the event. */
function flash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  fade: number,
  radius: number,
  colour: string,
): void {
  ctx.globalAlpha = 0.34 * fade * fade;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, cell * radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draws every live effect over the board. `layout` maps board units to pixels, and
 * one unit is one square, so a radius of 7 sweeps the whole 15x15 board.
 */
export function drawEffects(
  ctx: CanvasRenderingContext2D,
  effects: readonly Effect[],
  layout: { cell: number; originX: number; originY: number },
  now: number,
): void {
  for (const effect of effects) {
    const t = progress(effect, now);
    const fade = 1 - t;
    const x = layout.originX + effect.focus.x * layout.cell;
    const y = layout.originY + effect.focus.y * layout.cell;
    const cell = layout.cell;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (effect.kind === 'enter') {
      // A pawn steps onto its start square: rings from that square, own colour.
      flash(ctx, x, y, cell, fade, 0.4 + 0.9 * t, '#ffffff');
      for (const ring2 of [0, 1]) {
        ring(
          ctx, x, y,
          cell * (0.3 + 3.2 * ease(t) * (1 - ring2 * 0.35)),
          Math.max(0, 0.85 * fade - ring2 * 0.3),
          cell * (0.12 * fade + 0.01),
          ring2 === 0 ? effect.colour : '#ffffff',
        );
      }
      sparks(ctx, effect, x, y, cell, t, fade, 8, 1.2, 2.8, 0.5, effect.colour);
    }

    if (effect.kind === 'capture') {
      // Two rings racing across the board plus ten sparks in the winner's colour.
      flash(ctx, x, y, cell, fade, 0.4 + 1.6 * t, '#ffffff');
      for (const ring2 of [0, 1]) {
        ring(
          ctx, x, y,
          cell * (0.3 + 6.8 * ease(t) * (1 - ring2 * 0.35)),
          Math.max(0, 0.85 * fade - ring2 * 0.25),
          cell * (0.14 * fade + 0.01),
          ring2 === 0 ? effect.colour : '#ffffff',
        );
      }
      sparks(ctx, effect, x, y, cell, t, fade, 10, 3.2, 7.4, 0.5, effect.colour);
    }

    if (effect.kind === 'home') {
      // Gold rings and embers rising from the pawn, gold pulse on the centre.
      flash(ctx, x, y, cell, fade, 0.4 + 0.6 * t, GOLD);
      ring(ctx, x, y, cell * (0.3 + 2.6 * ease(t)), 0.8 * fade, cell * (0.12 * fade + 0.01), GOLD);
      ring(ctx, x, y, cell * (0.3 + 3.6 * ease(t)), 0.5 * fade, cell * (0.08 * fade + 0.01), effect.colour);
      sparks(ctx, effect, x, y, cell, t, fade, 12, 1.6, 3.4, 0.4, GOLD, true);
      const cx = layout.originX + 7 * cell;
      const cy = layout.originY + 7 * cell;
      flash(ctx, cx, cy, cell, fade, 1.6 + 1.4 * t, GOLD);
      ring(ctx, cx, cy, cell * (1.2 + 2.4 * ease(t)), 0.45 * fade, cell * 0.12, GOLD);
    }

    if (effect.kind === 'win') {
      // Whole-board tint, then confetti raining down from the top edge.
      ctx.globalAlpha = 0.22 * fade * fade;
      ctx.fillStyle = effect.colour;
      ctx.fillRect(0, 0, layout.cell * 15, layout.cell * 15);
      const colours = [effect.colour, '#fffdf8', GOLD, '#6cb6ff'];
      for (let piece = 0; piece < 44; piece += 1) {
        const start = hashRandom(effect.seed, piece);
        const drift = (hashRandom(effect.seed, piece + 44) - 0.5) * 2;
        const fall = ease(t);
        const px = (start + drift * fall * 0.25) * cell * 15;
        const py = fall * cell * 17 - cell * 2;
        const size = cell * (0.12 + hashRandom(effect.seed, piece + 88) * 0.16);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(hashRandom(effect.seed, piece + 132) * 6.28 * ease(t));
        ctx.globalAlpha = 0.95 * fade;
        ctx.fillStyle = colours[piece % colours.length];
        ctx.fillRect(-size / 2, -size / 2, size, size * 1.6);
        ctx.restore();
      }
    }

    ctx.restore();
  }
}