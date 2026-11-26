/**
 * App bootstrap: ties the rules engine to the canvas board.
 *
 * Rendering is a single requestAnimationFrame loop; interaction is a hit test against
 * the same token placements the renderer uses, so a tap always lands on the token that
 * was drawn under the finger.
 */

import {
  DONE,
  chooseCpuMove,
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
import { drawEffects, liveEffects, spawnEffect, type Effect } from './render/effects.ts';
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
const playersButton = required<HTMLButtonElement>('#players');
const modeScreen = required<HTMLElement>('#mode-screen');

const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('canvas 2d context unavailable');
const ctx: CanvasRenderingContext2D = maybeCtx;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Height of one dice rail: the die chip plus its button padding and border. */
const RAIL_BOX = 71;
/** Vertical room the rails take in the spare space above and below the board. */
const RAIL_SPACE = RAIL_BOX * 2 + 6;
/**
 * Headroom the canvas keeps above the board so a pawn standing on the top wall draws
 * its whole pin instead of being cut by the canvas edge.
 */
const PIN_ROOM = 1.2;
/** Beat after each action, so a roll and the reply never land in the same instant. */
const ACTION_PAUSE_MS = 500;
/** How long the computer waits before rolling or moving, so its turn is readable. */
const CPU_PAUSE_MS = 650;

let playerCount: 2 | 4 = 4;
/** Seat driven by the computer in a single-player game; null when every seat is human. */
let cpuSeat: Seat | null = null;
let game: GameState = createGame({ seed: (Date.now() & 0x7fffffff) || 1, playerCount });
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
/** Pending computer action; 0 when none. */
let cpuTimer = 0;
/** Board-wide event effects (capture, home, entry, win). */
const effects: Effect[] = [];
/** Monotonic seed for effect randomness, so two captures never look identical. */
let effectSeed = Math.floor(Math.random() * 1e9);

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
      // Six cube faces, pips 1..6; CSS places them in 3D and rotates the cube.
      for (let pips = 1; pips <= 6; pips += 1) {
        const face = document.createElement('span');
        face.className = 'dice-face';
        face.dataset.pips = String(pips);
        for (let pip = 0; pip < 9; pip += 1) face.append(document.createElement('i'));
        die.append(face);
      }
      holder.append(die);

      holder.addEventListener('click', () => {
        if (holder.dataset.active === 'true' && !isCpuTurn()) roll();
      });

      rail.append(holder);
      seatDies.set(seat, holder);
    }
  }
}

/** Seat label for messages: the computer seat is named by role, not colour. */
function nameOf(seat: Seat): string {
  return seat === cpuSeat ? 'Computer' : SEAT_NAMES[seat];
}

/** Human-readable summary of what just happened, newest event wins. */
function describe(events: readonly GameEvent[], state: GameState): string {
  for (const event of [...events].reverse()) {
    switch (event.type) {
      case 'won':
        return `<strong>${nameOf(event.seat)} wins!</strong> All four tokens are home.`;
      case 'skipped':
        return event.reason === 'three-sixes'
          ? `${nameOf(event.seat)} rolled three sixes — turn forfeited.`
          : `${nameOf(event.seat)} has no legal move. Pass.`;
      case 'moved':
        if (event.captures.length > 0) {
          const victims = event.captures.map((ref) => nameOf(ref.seat)).join(' and ');
          return `${nameOf(event.seat)} captured ${victims} — roll again.`;
        }
        if (event.to === DONE) {
          const again =
            state.phase === 'await-roll' && state.turn === event.seat && state.winner === null
              ? ' — roll again.'
              : '.';
          return `${nameOf(event.seat)} brought a token home${again}`;
        }
        return `${nameOf(event.seat)} moved.`;
      case 'rolled':
        if (state.phase === 'await-move' && state.turn !== cpuSeat) {
          return `${nameOf(event.seat)} rolled <strong>${event.dice}</strong>. Pick a token.`;
        }
        return `${nameOf(event.seat)} rolled <strong>${event.dice}</strong>.`;
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

  spawnEventEffects(result.events, performance.now());

  if (game.phase === 'game-over') {
    stopAttentionLoop();
    play('win');
  } else if (game.phase === 'await-roll') {
    if (game.turn !== previousTurn) play('turn');
    startAttentionLoop();
  }
  scheduleCpu();
}

/** True while the computer seat is to act and the board is in view. */
/** Queue a board-wide effect for an event that deserves one. */
function spawnEventEffects(events: readonly GameEvent[], now: number): void {
  const placements = tokenPlacements(game);
  for (const event of events) {
    if (event.type !== 'moved' || event.captures.length === 0) continue;
    const focus = placements.get(`${event.seat}:${event.token}`)?.units;
    if (!focus) continue;
    effectSeed += 1;
    effects.push(
      spawnEffect('capture', now, focus, SEAT_COLOURS[event.seat], effectSeed),
    );
  }
}

function isCpuTurn(): boolean {
  return (
    cpuSeat !== null && game.turn === cpuSeat && game.phase !== 'game-over' && modeScreen.hidden
  );
}

/** Queue the computer's next action. Safe to call after any state change. */
function scheduleCpu(): void {
  window.clearTimeout(cpuTimer);
  cpuTimer = 0;
  if (!isCpuTurn()) return;
  cpuTimer = window.setTimeout(() => {
    cpuTimer = 0;
    // A move in flight re-queues from the settle callback.
    if (!isCpuTurn() || busy) return;
    if (game.phase === 'await-roll') {
      roll();
      return;
    }
    const token = chooseCpuMove(game, legal);
    if (token !== null) moveToken(token);
  }, CPU_PAUSE_MS);
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

/** Show the mode picker and hold the game until a mode is chosen. */
function showModes(): void {
  window.clearTimeout(cpuTimer);
  cpuTimer = 0;
  stopAttentionLoop();
  modeScreen.hidden = false;
  modeScreen.querySelector<HTMLButtonElement>('[data-mode]')?.focus();
}

/** Start the chosen mode and put the board in view. */
function startMode(mode: 1 | 2 | 4): void {
  modeScreen.hidden = true;
  newGame(mode);
}

/** The mode currently on the board, for reopening the picker. */
function currentMode(): 1 | 2 | 4 {
  return cpuSeat !== null ? 1 : playerCount;
}

/**
 * Repaint the page backdrop: three soft colour blobs on a dark tint, re-rolled for
 * every new game. Pure CSS gradients built from random hues — no images, no network,
 * no resources beyond a string assignment.
 */
function paintBackdrop(): void {
  const hue = Math.floor(Math.random() * 360);
  const spot = (h: number, x: number, y: number, size: number): string =>
    `radial-gradient(${size}% ${size}% at ${x.toFixed(0)}% ${y.toFixed(0)}%, hsl(${h.toFixed(0)} 78% 38% / 0.7) 0%, transparent 72%)`;
  document.body.style.backgroundImage = [
    spot(hue, 8 + Math.random() * 30, 8 + Math.random() * 25, 55 + Math.random() * 30),
    spot((hue + 90 + Math.random() * 60) % 360, 55 + Math.random() * 35, 20 + Math.random() * 30, 50 + Math.random() * 30),
    spot((hue + 200 + Math.random() * 60) % 360, 15 + Math.random() * 60, 65 + Math.random() * 25, 55 + Math.random() * 35),
    `linear-gradient(160deg, hsl(${hue} 40% 12%), hsl(${(hue + 40) % 360} 35% 9%) 60%, #0b0f14)`,
  ].join(', ');
}

/**
 * Start a new game. One player means red against the computer on yellow, using the
 * same opposite-corner layout as a two-player game.
 */
function newGame(next: 1 | 2 | 4): void {
  stopAttentionLoop();
  window.clearTimeout(settleTimer);
  window.clearTimeout(attentionTimer);
  window.clearTimeout(cpuTimer);
  settleTimer = 0;
  cpuTimer = 0;
  hops.clear();
  ticked.clear();
  busy = false;
  autoMoves = 0;
  lastFace = 0;
  rolledSeat = null;

  cpuSeat = next === 1 ? 2 : null;
  playerCount = next === 1 ? 2 : next;
  paintBackdrop();
  game = createGame({ seed: (Date.now() & 0x7fffffff) || 1, playerCount });
  message = 'Tap the dice to start.';
  legal = legalMoves(game);
  syncHud();
  startAttentionLoop();
  scheduleCpu();
}

function syncHud(): void {
  const over = game.phase === 'game-over';
  const winner = game.winner;
  const shownSeat = winner !== null ? winner : game.turn;

  turnName.textContent = over
    ? `${nameOf(shownSeat)} won`
    : `${nameOf(shownSeat)}${
        game.phase === 'await-move' && shownSeat !== cpuSeat ? ' — pick a token' : ''
      }`;
  turnDot.style.setProperty('--seat', SEAT_COLOURS[shownSeat]);
  turnDot.style.background = SEAT_COLOURS[shownSeat];

  if (game.dice !== null) {
    lastFace = game.dice;
    rolledSeat = game.turn;
  }

  // Only seats in this game get a die; only the seat to play shows a face.
  for (const [seat, holder] of seatDies) {
    holder.hidden = !game.seats.includes(seat);
    const active = !over && seat === shownSeat;
    holder.dataset.active = String(active);
    holder.disabled = !active;
    const die = holder.firstElementChild as HTMLElement;
    die.dataset.face = String(active && rolledSeat === seat ? lastFace : 0);
  }

  status.innerHTML = message;
  status.dataset.win = over ? 'true' : 'false';
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
  // Each face change is a >= 1 full turn, so the cube reads as rolling.
  busy = true;
  const holder = seatDies.get(game.turn);
  const die = holder?.firstElementChild as HTMLElement | undefined;
  const spin = window.setInterval(() => {
    if (die) die.dataset.face = String(1 + Math.floor(Math.random() * 6));
  }, 70);

  window.setTimeout(() => {
    window.clearInterval(spin);
    busy = false;
    apply(step(game, { type: 'roll' }));
    // Let the rolled face read before the lone legal token walks on its own.
    window.setTimeout(autoMoveIfSingle, ACTION_PAUSE_MS);
  }, 480);
}

/** One legal move needs no decision: play it. */
function autoMoveIfSingle(): void {
  // The computer always decides for itself, even when only one move is legal.
  if (isCpuTurn() || game.phase !== 'await-move' || legal.length !== 1) return;
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
  // for the per-seat dice, so they always have somewhere to sit. The canvas is taller
  // than the board by one pin height, so pins standing on the top wall stay whole.
  const side = Math.max(120, Math.floor(Math.min(width, height - RAIL_SPACE)));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cell = side / 15;
  const pinRoom = Math.ceil(cell * PIN_ROOM);
  const canvasHeight = side + pinRoom;

  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(canvasHeight * dpr);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${canvasHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Square board flush with the screen edges, dropped by one pin height.
  layout = { ...computeLayout(side, side), originY: pinRoom };
  sizeVersion += 1;

  // Rails hug the board edges, so tell them where the square sits in the stage.
  const canvasTop = Math.floor((height - canvasHeight) / 2);
  stage.style.setProperty('--rail-gap', `${canvasTop + pinRoom}px`);
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
        scheduleCpu();
      }, ACTION_PAUSE_MS);
    }
  }

  renderBoard(ctx, game, layout, {
    time,
    legal,
    animate: !prefersReducedMotion,
    animated,
  });
  if (effects.length > 0) {
    // Drop what finished, then draw what is left over the board.
    const alive = liveEffects(effects, time);
    if (alive.length !== effects.length) effects.splice(0, effects.length, ...alive);
    drawEffects(ctx, effects, layout, time);
  }
  requestAnimationFrame(frame);
}

function tokenAt(clientX: number, clientY: number): { seat: Seat; token: TokenIndex } | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const placements = tokenPlacements(game);

  let best: { seat: Seat; token: TokenIndex; distance: number } | null = null;
  for (const [key, placement] of placements) {
    const px = layout.originX + placement.units.x * layout.cell;
    // The pin stands above its cell, so aim at the body, not the tip.
    const py = layout.originY + placement.units.y * layout.cell - layout.cell * 0.5;
    const distance = Math.hypot(px - x, py - y);
    if (distance > layout.cell * 0.62) continue;
    if (best && best.distance <= distance) continue;
    const [seatPart, tokenPart] = key.split(':');
    const seat = Number(seatPart) as Seat;
    if (!game.seats.includes(seat)) continue;
    best = {
      seat,
      token: Number(tokenPart) as TokenIndex,
      distance,
    };
  }
  return best ? { seat: best.seat, token: best.token } : null;
}

canvas.addEventListener('pointerdown', (event) => {
  // Only the dice rolls. Board taps are for choosing a token.
  if (game.phase !== 'await-move' || isCpuTurn()) return;
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

playersButton.addEventListener('click', () => {
  showModes();
  play('tap');
});

for (const button of modeScreen.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.addEventListener('click', () => {
    play('tap');
    startMode(Number(button.dataset.mode) as 1 | 2 | 4);
  });
}

window.addEventListener('keydown', (event) => {
  if (!modeScreen.hidden) {
    if (event.key === 'Escape') startMode(currentMode());
    return;
  }
  if (event.key >= '1' && event.key <= '4') {
    moveToken((Number(event.key) - 1) as TokenIndex);
    return;
  }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (!isCpuTurn()) roll();
  }
});

new ResizeObserver(() => resize()).observe(stage);
window.addEventListener('resize', resize);
buildSeatDice();
resize();
legal = legalMoves(game);
syncHud();
paintBackdrop();
showModes();
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
    /** Seat the computer plays, or null in a hotseat game. */
    cpuSeat: () => cpuSeat,
    /** Live board-wide event effects, for scripted checks. */
    effects: () => effects.map((effect) => ({ ...effect })),
    sizes: () => sizeVersion,
    canvasSize: () => ({ width: canvas.width, height: canvas.height, layout }),
    /** Token centres in CSS pixels, so tests can click exactly where a token is drawn. */
    tokenPoints: () => {
      const rect = canvas.getBoundingClientRect();
      return [...tokenPlacements(game)]
        .filter(([key]) => game.seats.includes(Number(key.split(':')[0]) as Seat))
        .map(([key, placement]) => {
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

