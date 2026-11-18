/**
 * UI smoke test over the Chrome DevTools Protocol.
 *
 * Drives the real page in headless Chrome: clicks the dice button, then clicks a token
 * on the canvas at its drawn coordinates, and asserts the rules engine advanced. This
 * covers the pieces `node --test` cannot see — canvas sizing, hit testing, and the
 * roll/move wiring.
 *
 * No dependencies: Node's built-in fetch and WebSocket do the protocol work.
 *
 *   node scripts/ui-smoke.mjs [url]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] ?? 'http://localhost:5183/';
const PORT = 9333;
const SHOT_DIR = join(tmpdir(), 'opencode');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
];

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.error('Chrome not found; cannot run the UI smoke test.');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`FAIL ${message}`);
  cleanup();
  process.exit(1);
}

let child = null;
let socket = null;

function cleanup() {
  try {
    socket?.close();
  } catch {}
  try {
    child?.kill();
  } catch {}
}

process.on('exit', cleanup);

child = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'opencode-cdp-profile')}`,
    '--window-size=900,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForBrowser() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('Chrome did not expose its debugging port');
}

let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 30000);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  }
  return result.result?.value;
}

async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(90);
}

/** Press the die that belongs to the seat to play. Returns false when it is not ready. */
async function clickActiveDie() {
  return evaluate(`(() => {
    const die = document.querySelector('.seat-die[data-active="true"]:not([disabled])');
    if (!die) return false;
    die.click();
    return true;
  })()`);
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
  const path = join(SHOT_DIR, name);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  return path;
}

async function main() {
  await waitForBrowser();

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_UNDER_TEST)}`, {
      method: 'PUT',
    })
  ).json();

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // Collect page errors so a thrown exception fails the run instead of hiding.
  await evaluate(`(() => {
    globalThis.__errors = [];
    addEventListener('error', (event) => __errors.push(String(event.message)));
    addEventListener('unhandledrejection', (event) => __errors.push(String(event.reason)));
    return true;
  })()`);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(
      `document.readyState === 'complete' && !!globalThis.ludo`,
    ).catch(() => false);
    if (ready) break;
    await sleep(100);
  }

  const boot = await evaluate(`({
    canvas: globalThis.ludo.canvasSize(),
    points: globalThis.ludo.tokenPoints().length,
    status: document.querySelector('#status').textContent,
    turn: document.querySelector('#turn-name').textContent,
  })`);

  if (!boot || boot.points !== 16) fail(`expected 16 tokens on the board, got ${boot?.points}`);
  if (boot.canvas.layout.cell <= 0) fail('board layout has zero cell size');
  if (boot.canvas.width !== boot.canvas.height) {
    fail(`canvas should be square, got ${boot.canvas.width}x${boot.canvas.height}`);
  }
  const fills = Math.abs(boot.canvas.layout.cell * 15 - boot.canvas.width * 0.98) < 2;
  if (!fills) fail('board does not fill the canvas');

  // The mute control must actually toggle, and survive a second click.
  const sound = await evaluate(`(() => {
    const button = document.querySelector('#sound');
    const start = button.getAttribute('aria-pressed');
    button.click();
    const flipped = button.getAttribute('aria-pressed');
    const label = button.textContent;
    button.click();
    return { start, flipped, label, back: button.getAttribute('aria-pressed') };
  })()`);
  if (sound.start === sound.flipped) fail('sound button did not toggle');
  if (sound.back !== sound.start) fail('sound button did not toggle back');
  if (sound.label === null) fail('sound button has no label');

  // Tapping the board must not roll the dice; only the dice button does.
  const beforeTap = await evaluate('globalThis.ludo.state().rollCount');
  const boardCentre = await evaluate(`(() => {
    const rect = document.querySelector('#board').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(boardCentre.x, boardCentre.y);
  const afterTap = await evaluate('globalThis.ludo.state().rollCount');
  if (afterTap !== beforeTap) fail(`board tap rolled the dice (${beforeTap} -> ${afterTap})`);

  // Per-seat dice: two placeholders per rail, ordered like the yards, only one active.
  const rails = await evaluate(`[...document.querySelectorAll('.seat-dice')].map((rail) => ({
    rail: rail.dataset.rail,
    seats: [...rail.children].map((child) => Number(child.dataset.seat)),
  }))`);
  const seats = (railName) => rails.find((entry) => entry.rail === railName)?.seats.join(',');
  if (seats('top') !== '0,1') fail(`top rail should hold seats 0,1, got ${seats('top')}`);
  if (seats('bottom') !== '3,2') fail(`bottom rail should hold seats 3,2, got ${seats('bottom')}`);

  // The die must keep bouncing while nobody rolls, one second after each bounce.
  const pulsesBefore = await evaluate('globalThis.ludo.attentions()');
  await sleep(2100);
  const pulsesAfter = await evaluate('globalThis.ludo.attentions()');
  if (pulsesAfter <= pulsesBefore) {
    fail(`die stopped bouncing while waiting for a roll (${pulsesBefore} -> ${pulsesAfter})`);
  }

  // Roll until a six appears. The die tumbles for ~480ms and disables the button, so
  // only click when it is enabled; otherwise the click is swallowed by the guard.
  let state = await evaluate('globalThis.ludo.state()');
  let sixState = null;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (state.phase === 'await-move') {
      sixState = state;
      break;
    }
    if (state.phase === 'game-over') break;
    await clickActiveDie();
    await sleep(40);
    state = await evaluate('globalThis.ludo.state()');
    if (state.phase === 'await-move') {
      sixState = state;
      break;
    }
  }
  if (!sixState) fail('never reached a move after 600 attempts');

  // Click the first movable token on the canvas, at its drawn position.
  const point = await evaluate(`(() => {
    const legal = globalThis.ludo.legal();
    const points = globalThis.ludo.tokenPoints();
    const match = points.find((p) => legal.some((m) => m.token === p.token && m.seat === p.seat));
    return match ?? null;
  })()`);
  if (!point) fail('no token point matched a legal move');

  const before = await evaluate(
    `globalThis.ludo.state().players[${point.seat}].tokens[${point.token}]`,
  );
  await click(point.x, point.y);
  const after = await evaluate(
    `globalThis.ludo.state().players[${point.seat}].tokens[${point.token}]`,
  );

  if (before === after) {
    fail(`clicking token ${point.token} at (${Math.round(point.x)}, ${Math.round(point.y)}) did not move it`);
  }

  // The token should still be in the air right after the click; capture it.
  await screenshot('ui-hop.png');

  // Play on for a while, then capture the board mid-game. Animations take ~0.5s per
  // action and input is ignored while they run, so allow plenty of iterations.
  let hintsShot = false;
  let sawAttention = false;
  let attentionShot = false;
  for (let step = 0; step < 600; step += 1) {
    const now = await evaluate(`({
      ...globalThis.ludo.state(),
      attention: !!document.querySelector('.seat-die.attention'),
    })`);
    if (now.attention) sawAttention = true;
    if (now.attention && !attentionShot) {
      await screenshot('ui-attention.png');
      attentionShot = true;
    }
    if (now.phase === 'game-over') break;
    if (now.phase === 'await-roll') {
      await clickActiveDie();
    } else {
      // Grab the move-hint trail once a token is already out on the track.
      if (!hintsShot) {
        const trail = await evaluate(
          'globalThis.ludo.legal().some((m) => m.from >= 0 && m.to - m.from >= 2)',
        );
        if (trail) {
          await screenshot('ui-hints.png');
          // 300ms later the ghost marker should have advanced along the path.
          await sleep(300);
          await screenshot('ui-hints-b.png');
          hintsShot = true;
        }
      }
      const candidate = await evaluate(`(() => {
        const legal = globalThis.ludo.legal();
        const points = globalThis.ludo.tokenPoints();
        const hit = points.find((p) => legal.some((m) => m.token === p.token && m.seat === p.seat));
        return hit ?? null;
      })()`);
      if (candidate) await click(candidate.x, candidate.y);
    }
    await sleep(40);
  }

  const finalState = await evaluate(`({
    phase: globalThis.ludo.state().phase,
    turns: globalThis.ludo.state().rollCount,
    tokens: globalThis.ludo.state().players,
    errors: globalThis.__errors ?? [],
  })`);

  const shot = await screenshot('ui-smoke.png');

  const moved = Object.values(finalState.tokens)
    .flatMap((player) => player.tokens)
    .filter((progress) => progress !== -1).length;

  const autoMoves = await evaluate('globalThis.ludo.autoMoves()');
  const attentions = await evaluate('globalThis.ludo.attentions()');

  const seatDice = await evaluate(`[...document.querySelectorAll('.seat-die')].map((holder) => ({
    seat: Number(holder.dataset.seat),
    active: holder.dataset.active === 'true',
    face: Number(holder.firstElementChild.dataset.face),
  }))`);
  if (seatDice.length !== 4) fail(`expected 4 seat dice, got ${seatDice.length}`);
  const activeDice = seatDice.filter((entry) => entry.active);
  if (finalState.phase !== 'game-over' && activeDice.length !== 1) {
    fail(`expected exactly one active seat die, got ${activeDice.length}`);
  }
  const staleFace = seatDice.find((entry) => !entry.active && entry.face !== 0);
  if (staleFace) fail(`inactive seat die ${staleFace.seat} still shows a face`);

  // Portrait phone: each rail must touch the board edge, above and below.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(240);
  await screenshot('ui-phone.png');
  const phone = await evaluate(`(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    const board = document.querySelector('#board').getBoundingClientRect();
    const rails = [...document.querySelectorAll('.seat-dice')].map((rail) => rail.getBoundingClientRect());
    const die = document.querySelector('.seat-die .dice').getBoundingClientRect();
    return {
      stage: Math.round(stage.width),
      board: Math.round(board.width),
      topGap: Math.round(board.top - rails[0].bottom),
      bottomGap: Math.round(rails[1].top - board.bottom),
      die: Math.round(die.width),
      headerDie: !!document.querySelector('#roll'),
    };
  })()`);
  if (phone.headerDie) fail('the old header dice button is still in the page');
  if (phone.board > phone.stage + 1) fail(`board ${phone.board}px overflows a ${phone.stage}px stage`);
  if (Math.abs(phone.topGap) > 2) fail(`top rail is ${phone.topGap}px from the board`);
  if (Math.abs(phone.bottomGap) > 2) fail(`bottom rail is ${phone.bottomGap}px from the board`);
  if (phone.die < 52) fail(`seat die is only ${phone.die}px wide`);
  await send('Emulation.clearDeviceMetricsOverride');

  // The player toggle starts a new game on opposite corners, with only two dice.
  const two = await evaluate(`(() => {
    document.querySelector('#players').click();
    return {
      seats: globalThis.ludo.state().seats,
      dice: [...document.querySelectorAll('.seat-die')].filter((d) => !d.hidden).map((d) => Number(d.dataset.seat)),
      tokens: globalThis.ludo.tokenPoints().length,
      label: document.querySelector('#players').textContent,
    };
  })()`);
  if (two.seats.join(',') !== '0,2') fail(`2-player game should use seats 0,2, got ${two.seats}`);
  if (two.dice.join(',') !== '0,2') fail(`2-player dice should be seats 0,2, got ${two.dice}`);
  const dicePos = await evaluate(`(() => {
    const box = (seat) => document.querySelector(\`.seat-die[data-seat="\${seat}"]\`).getBoundingClientRect();
    return { r0: box(0).left, r1: box(1).left, y2: box(2).left, b3: box(3).left };
  })()`);
  if (dicePos.r0 >= dicePos.r1) fail('red die should stay in the left top slot');
  if (dicePos.y2 <= dicePos.b3) fail(`yellow die should stay in its own right slot, not blue's (${dicePos.y2} <= ${dicePos.b3})`);
  if (two.tokens !== 8) fail(`2-player game should draw 8 pawns, got ${two.tokens}`);
  if (two.label !== 'Play 4 players') fail(`toggle should offer 4 players, got ${two.label}`);
  await clickActiveDie();
  await sleep(800);
  const twoRolls = await evaluate('globalThis.ludo.state().rollCount');
  if (twoRolls < 1) fail('2-player game could not roll');
  await screenshot('ui-2player.png');

  console.log(`ok   board ${boot.canvas.width}x${boot.canvas.height}, cell ${boot.canvas.layout.cell.toFixed(1)}px`);
  console.log(`ok   rolled ${finalState.turns} times, ${moved} tokens out of the yards`);
  console.log(`ok   clicked token ${point.token} on the canvas: ${before} -> ${after}`);
  console.log(`ok   ${autoMoves} single-option moves played without a tap`);
  console.log(`ok   turn-start bounce repeats while waiting (${pulsesBefore} -> ${pulsesAfter})`);
  console.log(`ok   4 seat dice, ${phone.die}px, ${phone.topGap}px/${phone.bottomGap}px from the board on a 390x844 phone`);
  console.log(`ok   2-player mode uses diagonal seats ${two.seats.join(',')}: ${two.dice.length} dice, ${two.tokens} pawns`);
  console.log(`ok   screenshot ${shot}`);

  if (moved < 1) fail('no token ever left the yard; board interaction looks broken');
  if (autoMoves < 1) fail('a lone legal move was never auto-played');
  if (attentions < 2) fail(`turn-start bounce fired only ${attentions} time(s)`);
  if (!sawAttention) fail('no turn-start bounce was ever visible on the active die');
  if (finalState.errors.length > 0) fail(`page errors: ${finalState.errors.join(' | ')}`);

  cleanup();
  process.exit(0);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  cleanup();
  process.exit(1);
});
