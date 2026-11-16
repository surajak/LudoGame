/**
 * App bootstrap: ties the rules engine to the canvas board.
 *
 * Rendering is a single requestAnimationFrame loop; interaction is a hit test against
 * the same token placements the renderer uses, so a tap always lands on the token that
 * was drawn under the finger.
 */

import {
  DONE,
  createGame,
  legalMoves,
  step,
  type GameEvent,
  type GameState,
  type LegalMove,
  type Seat,
  type TokenIndex,
} from './engine/index.ts';
import { computeLayout, renderBoard, type Layout } from './render/board.ts';
import { SEAT_COLOURS, SEAT_NAMES, tokenPlacements } from './render/geometry.ts';
import {
  ATTENTION_BOUNCE_MS,
  ATTENTION_REST_MS,
  hopAt,
  hopSegment,
  moveDuration,
  pathForMove,
  type Hop,
  type Waypoint,
} from './render/motion.ts';
import { isMuted, play, setMuted } from './audio/sfx.ts';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#board');
const stage = required<HTMLElement>('#stage');
const turnName = required<HTMLElement>('#turn-name');
const turnDot = required<HTMLElement>('#turn-dot');
const status = required<HTMLElement>('#status');
const soundButton = required<HTMLButtonElement>('#sound');

const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('canvas 2d context unavailable');
const ctx: CanvasRenderingContext2D = maybeCtx;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Vertical room kept free for the dice rails, above and below the board. */
const RAIL_SPACE = 164;
/** Beat after each action, so a roll and the reply never land in the same instant. */
const ACTION_PAUSE_MS = 500;

let game: GameState = createGame({ seed: (Date.now() & 0x7fffffff) || 1, playerCount: 4 });
let legal: LegalMove[] = [];
let layout: Layout = { cell: 0, originX: 0, originY: 0 };
let message = 'Tap the dice to start.';
let sizeVersion = 0;
/** Last rolled face, kept on screen while the token moves (state clears `dice`). */
let lastFace = 0;
/** Tokens in flight, keyed `seat:token`. Input is ignored until this drains. */
const hops = new Map<string, Hop>();
/** Last square crossed per token, so each cell gets exactly one tick. -1 = none yet. */
const ticked = new Map<string, number>();
let busy = false;
/** Count of moves played automatically because only one was legal. */
let autoMoves = 0;
/** Seat whose dice face is currently on screen; null before the first roll. */
let rolledSeat: Seat | null = null;
/** Count of turn-start bounces, so a scripted check can prove the cue fires. */
let attentions = 0;
let attentionTimer = 0;
let repeatTimer = 0;
/** Pending post-move pause before input opens again; 0 when none. */
let settleTimer = 0;

/** Per-seat dice placeholders in the empty space above and below the board. */
const seatDies = new Map<Seat, HTMLButtonElement>();

/**
 * Rail order mirrors the yards on screen: red and green on top, blue and yellow below.
 * Each placeholder shows a face only while that seat is to play.
 */
function buildSeatDice(): void {
  const byRail: Record<string, Seat[]> = { top: [0, 1], bottom: [3, 2] };

  for (const rail of document.querySelectorAll<HTMLElement>('.seat-dice')) {
    for (const seat of byRail[rail.dataset.rail ?? 'top'] ?? []) {
      const holder = document.createElement('button');
      holder.type = 'button';
      holder.className = 'seat-die';
      holder.dataset.seat = String(seat);
      holder.dataset.active = 'false';
      holder.style.setProperty('--seat', SEAT_COLOURS[seat]);
      holder.setAttribute('aria-label', `Roll the dice for ${SEAT_NAMES[seat]}`);

      const die = document.createElement('span');
      die.className = 'dice';
      die.dataset.face = '0';
      for (let pip = 0; pip < 9; pip += 1) die.append(document.createElement('i'));
      holder.append(die);

      holder.addEventListener('click', () => {
        if (holder.dataset.active === 'true') roll();
      });

      rail.append(holder);
      seatDies.set(seat, holder);
    }
  }
}

/** Human-readable summary of what just happened, newest event wins. */
function describe(events: readonly GameEvent[], state: GameState): string {
  for (const event of [...events].reverse()) {
    switch (event.type) {
      case 'won':
        return `<strong>${SEAT_NAMES[event.seat]} wins!</strong> All four tokens are home.`;
      case 'skipped':
        return event.reason === 'three-sixes'
          ? `${SEAT_NAMES[event.seat]} rolled three sixes — turn forfeited.`
          : `${SEAT_NAMES[event.seat]} has no legal move. Pass.`;
      case 'moved':
        if (event.captures.length > 0) {
          const victims = event.captures.map((ref) => SEAT_NAMES[ref.seat]).join(' and ');
          return `${SEAT_NAMES[event.seat]} captured ${victims} — roll again.`;
        }
        return event.to === DONE
          ? `${SEAT_NAMES[event.seat]} brought a token home.`
          : `${SEAT_NAMES[event.seat]} moved.`;
      case 'rolled':
        if (state.phase === 'await-move') {
          return `${SEAT_NAMES[event.seat]} rolled <strong>${event.dice}</strong>. Pick a token.`;
        }
        return `${SEAT_NAMES[event.seat]} rolled ${event.dice}.`;
      default:
        break;
    }
  }
  return message;
}

function apply(result: { state: GameState; events: readonly GameEvent[] }): void {
  const previousTurn = game.turn;
  game = result.state;
  message = describe(result.events, game);
  legal = legalMoves(game);
  syncHud();

  if (game.phase === 'game-over') {
    stopAttentionLoop();
    play('win');
  } else if (game.phase === 'await-roll') {
    if (game.turn !== previousTurn) play('turn');
    startAttentionLoop();
  }
}

/** Bounce the die of the seat to play, so a new turn is hard to miss. */
function pulseSeatDie(seat: Seat): void {
  const holder = seatDies.get(seat);
  if (!holder) return;
  attentions += 1;
  holder.classList.remove('attention');
  void holder.offsetWidth; // restart the animation if it just ran
  holder.classList.add('attention');
  window.clearTimeout(attentionTimer);
  attentionTimer = window.setTimeout(() => holder.classList.remove('attention'), ATTENTION_BOUNCE_MS + 100);
}

/** Keep bouncing the current seat's die, with a 1s rest, until somebody rolls. */
function startAttentionLoop(): void {
  window.clearTimeout(repeatTimer);
  if (game.phase !== 'await-roll') return;

  const tick = () => {
    if (game.phase !== 'await-roll') {
      repeatTimer = 0;
      return;
    }
    pulseSeatDie(game.turn);
    repeatTimer = window.setTimeout(tick, ATTENTION_BOUNCE_MS + ATTENTION_REST_MS);
  };

  tick();
}

function stopAttentionLoop(): void {
  window.clearTimeout(repeatTimer);
  repeatTimer = 0;
  for (const holder of seatDies.values()) holder.classList.remove('attention');
}

function syncHud(): void {
  const over = game.phase === 'game-over';
  const winner = game.winner;
  const shownSeat = winner !== null ? winner : game.turn;

  turnName.textContent = over
    ? `${SEAT_NAMES[shownSeat]} won`
    : `${SEAT_NAMES[shownSeat]}${game.phase === 'await-move' ? ' — pick a token' : ''}`;
  turnDot.style.setProperty('--seat', SEAT_COLOURS[shownSeat]);
  turnDot.style.background = SEAT_COLOURS[shownSeat];

  if (game.dice !== null) {
    lastFace = game.dice;
    rolledSeat = game.turn;
  }

  // Only the seat to play shows a die; the rest stay dim with blank pips.
  for (const [seat, holder] of seatDies) {
    const active = !over && seat === shownSeat;
    holder.dataset.active = String(active);
    holder.disabled = !active;
    const die = holder.firstElementChild as HTMLElement;
    die.dataset.face = String(active && rolledSeat === seat ? lastFace : 0);
  }

  status.innerHTML = message;
}

function roll(): void {
  if (busy || game.phase !== 'await-roll') return;
  play('dice');
  stopAttentionLoop();

  if (prefersReducedMotion) {
    apply(step(game, { type: 'roll' }));
    window.setTimeout(autoMoveIfSingle, ACTION_PAUSE_MS);
    return;
  }

  // Tumble before revealing: cycle cosmetic faces, then apply the engine's real roll.
  // Math.random here only picks which face to show — the dice value is still the engine's.
  busy = true;
  const holder = seatDies.get(game.turn);
  const die = holder?.firstElementChild as HTMLElement | undefined;
  holder?.classList.add('tumbling');
  const spin = window.setInterval(() => {
    if (die) die.dataset.face = String(1 + Math.floor(Math.random() * 6));
  }, 70);

  window.setTimeout(() => {
    window.clearInterval(spin);
    holder?.classList.remove('tumbling');
    busy = false;
    apply(step(game, { type: 'roll' }));
    // Let the rolled face read before the lone legal token walks on its own.
    window.setTimeout(autoMoveIfSingle, ACTION_PAUSE_MS);
  }, 480);
}

/** One legal move needs no decision: play it. */
function autoMoveIfSingle(): void {
  if (game.phase !== 'await-move' || legal.length !== 1) return;
  autoMoves += 1;
  moveToken(legal[0].token);
}

function moveToken(token: TokenIndex): void {
  if (busy || game.phase !== 'await-move') return;
  const move = legal.find((candidate) => candidate.token === token);
  if (!move) {
    play('invalid');
    return;
  }

  const before = tokenPlacements(game);
  const result = step(game, { type: 'move', token });

  if (move.captures.length > 0) play('capture');
  else if (move.to === DONE) play('home');

  if (prefersReducedMotion) {
    apply(result);
    return;
  }

  const after = tokenPlacements(result.state);
  const now = performance.now();

  const moverKey = `${move.seat}:${token}`;
  const destination = after.get(moverKey)?.units;
  if (destination) {
    const points = pathForMove(move.seat, token, move.from, move.to, destination);
    // Constant speed: one hop per square, no cap, so a six is not a blur.
    hops.set(moverKey, {
      points,
      start: now,
      duration: moveDuration(points.length - 1),
      lift: 0.22,
    });
    ticked.set(moverKey, -1);
  }

  for (const victim of move.captures) {
    const key = `${victim.seat}:${victim.token}`;
    const from = before.get(key)?.units;
    const to = after.get(key)?.units;
    if (!from || !to) continue;
    // A capture is a knock-back: one longer arc, faster than a walk.
    hops.set(key, { points: [from, to], start: now, duration: 420, lift: 0.9 });
  }

  busy = hops.size > 0;
  apply(result);
}

function resize(): void {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  // The board is square; the stage centres it and keeps a strip free above and below
  // for the per-seat dice, so they always have somewhere to sit.
  const side = Math.max(120, Math.floor(Math.min(width, height - RAIL_SPACE)));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(side * dpr);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(side, side);
  sizeVersion += 1;

  // Rails hug the board edges, so tell them where the square sits in the stage.
  stage.style.setProperty('--rail-gap', `${Math.floor((height - side) / 2)}px`);
  stage.style.setProperty('--rail-inset', `${Math.floor((width - side) / 2)}px`);
  stage.style.setProperty('--board-side', `${side}px`);
}

function frame(time: number): void {
  let animated: Map<string, Waypoint> | undefined;

  if (hops.size > 0) {
    animated = new Map();
    for (const [key, hop] of hops) {
      const at = hopAt(hop, time);
      if (!at) {
        hops.delete(key);
        ticked.delete(key);
        continue;
      }
      animated.set(key, at);

      // One tick per square the moving token crosses.
      const last = ticked.get(key);
      if (last !== undefined) {
        const segment = hopSegment(hop, time);
        if (segment > last) {
          ticked.set(key, segment);
          play('step');
        }
      }
    }
    // Hold input for one beat after the last pawn lands, so the next roll never
    // lands in the same instant as the move it answers.
    if (hops.size === 0 && settleTimer === 0) {
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        busy = false;
        syncHud();
      }, ACTION_PAUSE_MS);
    }
  }

  renderBoard(ctx, game, layout, {
    time,
    legal,
    animate: !prefersReducedMotion,
    animated,
  });
  requestAnimationFrame(frame);
}

function tokenAt(clientX: number, clientY: number): { seat: Seat; token: TokenIndex } | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const placements = tokenPlacements(game);
  const threshold = layout.cell * 0.52;

  let best: { seat: Seat; token: TokenIndex; distance: number } | null = null;
  for (const [key, placement] of placements) {
    const px = layout.originX + placement.units.x * layout.cell;
    const py = layout.originY + placement.units.y * layout.cell;
    const distance = Math.hypot(px - x, py - y);
    if (distance > threshold) continue;
    if (best && best.distance <= distance) continue;
    const [seatPart, tokenPart] = key.split(':');
    best = {
      seat: Number(seatPart) as Seat,
      token: Number(tokenPart) as TokenIndex,
      distance,
    };
  }
  return best ? { seat: best.seat, token: best.token } : null;
}

canvas.addEventListener('pointerdown', (event) => {
  // Only the dice rolls. Board taps are for choosing a token.
  if (game.phase !== 'await-move') return;
  const hit = tokenAt(event.clientX, event.clientY);
  if (hit) moveToken(hit.token);
});

function syncSound(): void {
  const off = isMuted();
  soundButton.setAttribute('aria-pressed', String(!off));
  soundButton.dataset.muted = String(off);
  soundButton.textContent = off ? 'Sound off' : 'Sound on';
}

soundButton.addEventListener('click', () => {
  setMuted(!isMuted());
  syncSound();
  play('tap');
});
syncSound();

window.addEventListener('keydown', (event) => {
  if (event.key >= '1' && event.key <= '4') {
    moveToken((Number(event.key) - 1) as TokenIndex);
    return;
  }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    roll();
  }
});

new ResizeObserver(() => resize()).observe(stage);
window.addEventListener('resize', resize);
buildSeatDice();
resize();
legal = legalMoves(game);
syncHud();
startAttentionLoop();
requestAnimationFrame(frame);

// Expose a tiny debug handle for scripted checks; no network, no globals beyond this.
Object.assign(globalThis, {
  ludo: {
    state: () => game,
    legal: () => legal,
    /** Legal moves played without a tap, i.e. the single-option shortcut. */
    autoMoves: () => autoMoves,
    /** Turn-start bounces played on the seat dice. */
    attentions: () => attentions,
    roll: () => roll(),
    move: (token: number) => moveToken(token as TokenIndex),
    sizes: () => sizeVersion,
    canvasSize: () => ({ width: canvas.width, height: canvas.height, layout }),
    /** Token centres in CSS pixels, so tests can click exactly where a token is drawn. */
    tokenPoints: () => {
      const rect = canvas.getBoundingClientRect();
      return [...tokenPlacements(game)].map(([key, placement]) => {
        const [seat, token] = key.split(':').map(Number);
        return {
          seat,
          token,
          x: rect.left + layout.originX + placement.units.x * layout.cell,
          y: rect.top + layout.originY + placement.units.y * layout.cell,
        };
      });
    },
  },
});

