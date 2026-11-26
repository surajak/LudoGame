/**
 * Event effects drawn on the board canvas, board-wide and time-limited.
 *
 * No GIFs, no sprites, no libraries: every effect is vector work in the same
 * requestAnimationFrame loop that draws the board, so the bundle keeps its
 * zero-dependency, single-file property. Randomness comes from `hashRandom`,
 * a hash of the effect's seed and the particle index, so a seed always draws
 * the same picture and the unit tests stay deterministic.
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
  return { kind, start: now, duration: 2000, seed, focus, colour };
}

/** Drops effects that have played out. Pure, so tests can drive it directly. */
export function liveEffects(effects: readonly Effect[], now: number): Effect[] {
  return effects.filter((effect) => now - effect.start < effect.duration);
}

/** 0..1 through the effect's life. */
function progress(effect: Effect, now: number): number {
  return Math.min(1, Math.max(0, (now - effect.start) / effect.duration));
}

/**
 * Draws every live effect over the board. `layout` maps board units to pixels;
 * `CELL` in the geometry is one square, so a radius of 3 is three squares.
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

    if (effect.kind !== 'capture') continue;

    // Flash on the square, then two rings racing out across the board.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32 * fade * fade;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.4 + 1.6 * t), 0, Math.PI * 2);
    ctx.fill();

    for (const ring of [0, 1]) {
      const lag = t * (1 + ring * 0.35);
      // 7.1 cells of travel: a capture in a corner still sweeps the far side.
      const radius = cell * (0.3 + 6.8 * lag);
      ctx.globalAlpha = Math.max(0, 0.85 * fade - ring * 0.25);
      ctx.lineWidth = cell * (0.14 * fade + 0.01);
      ctx.strokeStyle = ring === 0 ? effect.colour : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shards: ten straight sparks, angles from the seed, spread over the board.
    ctx.globalAlpha = 0.9 * fade;
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.strokeStyle = effect.colour;
    for (let shard = 0; shard < 10; shard += 1) {
      const angle = hashRandom(effect.seed, shard) * Math.PI * 2;
      const speed = 3.2 + 4.2 * hashRandom(effect.seed, shard + 10);
      const inner = cell * (0.5 + speed * lagOf(t));
      const outer = inner + cell * (0.5 + hashRandom(effect.seed, shard + 20));
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(x + cos * inner, y + sin * inner);
      ctx.lineTo(x + cos * outer, y + sin * outer);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Slight ease-out so the shard tips trail the rings. */
function lagOf(t: number): number {
  return 1 - (1 - t) * (1 - t);
}