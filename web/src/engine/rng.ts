/**
 * Small deterministic PRNG. The engine never calls Math.random(): the whole game is a
 * function of (seed, actions), so a game can be replayed exactly from a seed plus the
 * list of moves. That makes bug reports reproducible and fuzz runs cheap.
 *
 * mulberry32 — 32-bit state, one multiply-xor round per call. Good enough for dice.
 */

export interface RngState {
  /** Unsigned 32-bit state. */
  readonly s: number;
}

export function createRng(seed: number): RngState {
  // Any seed works, including 0; mix it so tiny seeds still spread out.
  const mixed = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return { s: mixed };
}

/** Returns the next state and a float in [0, 1). */
export function nextFloat(rng: RngState): { rng: RngState; value: number } {
  const s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { rng: { s }, value };
}

/** Returns the next state and an integer in [1, sides]. */
export function nextDie(rng: RngState, sides = 6): { rng: RngState; value: number } {
  const next = nextFloat(rng);
  return { rng: next.rng, value: 1 + Math.floor(next.value * sides) };
}

/** Pick an element deterministically. */
export function pick<T>(rng: RngState, items: readonly T[]): { rng: RngState; value: T } {
  const next = nextFloat(rng);
  return { rng: next.rng, value: items[Math.floor(next.value * items.length)] };
}
