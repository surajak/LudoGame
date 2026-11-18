# Ludo Offline — web app

Offline, ad-free, privacy-first Ludo. This folder is the whole app: a deterministic
TypeScript rules engine, and (from Phase 2) a canvas board with original art and
synthesised sound.

No runtime dependencies. `vite` and `typescript` are dev-only and never ship.

## Commands

```sh
npm install        # dev tooling only (vite + typescript)
npm test           # unit tests, Node's built-in runner
npm run test:fuzz  # 2,000 random games: termination + invariants
npm run typecheck  # tsc --noEmit, strict
npm run dev        # dev harness at http://localhost:5173
npm run dev:lan    # same, exposed on the LAN for a phone
npm run build      # typecheck + production bundle in dist/
npm run bundle     # build, then dist/ludo.html: one file, no external requests
```

Node 22+ runs the `.ts` test files directly via type stripping; no test framework is
installed. `tests/` imports `../src/engine/index.ts` with explicit extensions so both
Node and Vite resolve the same specifiers.

## Layout

The board is square and centred. The space above and below it holds four dice
placeholders, one beside each player's home: red and green on the top rail, blue and
yellow below it. Only the seat to play shows a die, ringed in that seat's colour, and
that die is the roll control. The board keeps a strip free for the rails even on a short
screen, so the control is always reachable. `Space`/`Enter` also roll.

```
src/engine/board.ts     geometry: ring, home column, safe squares, progress encoding
src/engine/rng.ts       mulberry32 PRNG — the only source of randomness
src/engine/state.ts     state shape, occupancy, legal-move generation
src/engine/game.ts      step(): roll / move / turn flow / win detection
src/render/geometry.ts  15×15 cell map: 52 ring cells, home columns, yards, centres
src/render/board.ts     canvas renderer, flat vector, no image assets
src/render/motion.ts    token hops: waypoints along the track, one arc per square
src/audio/sfx.ts        WebAudio cues: noise burst + oscillators, no audio files
src/main.ts             app shell: canvas sizing, hit testing, HUD wiring, animation glue
scripts/ui-smoke.mjs    drives headless Chrome over CDP and clicks real tokens
tests/                  engine + motion + fuzz tests
```

## UI smoke test

```sh
node scripts/ui-smoke.mjs [url]
```

Launches headless Chrome with the DevTools protocol, loads the page, presses the die of
the seat to play, then clicks a token **at its drawn pixel position** and asserts the
engine advanced. It also checks that the canvas is square and the board fills it, and
that the per-seat dice rails stay flush against the board on a 390x844 phone viewport.
No dependencies: Node's built-in `fetch` and `WebSocket` do the protocol work. It writes
`ui-smoke.png` (end state), `ui-hints.png` (move trails), `ui-phone.png` (portrait
layout) and `ui-hop.png` (a token mid-hop) to the temp directory so the board and the
animation can be inspected.

Motion is skipped entirely when the OS asks for `prefers-reduced-motion`; the rules
still apply instantly, and the dice reveals its result without tumbling.

## Sound

Cues are synthesised on the fly with WebAudio — a filtered noise burst for the dice and
short oscillator tones for moves, captures, finishing, turn changes and the win. Each
square a token crosses gets its own tick, so a six rattles six times. Nothing
is downloaded and no audio files ship. The `Sound on/off` button in the header persists
its state in `localStorage`; browsers only allow audio after a real tap, so the first
cue plays from your first click.

## Phone on the same Wi-Fi

`npm run dev` binds to loopback only. For a phone, run `npm run dev:lan` and open
`http://<this-PC's-LAN-IP>:5183/` (find it with `ipconfig`). Windows must allow
`node.exe` inbound; on a Public-profile network that is the only prompt you may see.
If the phone cannot connect, check the router is not isolating clients (guest Wi-Fi)
and that the phone is on the same subnet.

## Share it

```sh
npm run bundle
```

Writes `dist/ludo.html` (~23 kB): CSS and JS inlined, no image files, no network calls.
Send that one file to a friend. They double-click it and play. Works offline, on any
modern browser, with no install and no server.

A normal `npm run build` is not double-clickable: it points at `/assets/...`, which only
resolves through a web server (`npm run preview`). Use `bundle` when handing the game
over. The UI smoke test accepts a URL, so the single file is verified the same way:
`node scripts/ui-smoke.mjs file:///.../dist/ludo.html`.

## Ruleset

Classic Ludo, 2–4 players, four tokens each, 52-square ring plus a 5-cell home column. The header button starts a new game in the other mode; 2-player games use the opposite diagonal (seats 0 and 2), and unused yards and dice are hidden.

| Rule | Implementation |
|---|---|
| Enter the board | only on a 6; lands on your start square |
| Six | grants another roll |
| Three sixes in a row | turn forfeited, nothing moves |
| Capture | landing on an opponent sends it to its yard and grants another roll |
| Safe squares | the 4 start squares + the 4 star squares; no captures there |
| Blockade | 2+ tokens of one colour: opponents cannot land on it, may pass it |
| Stacking | your own tokens may share a square |
| Home | exact roll required; overshoot is rejected |
| Win | first seat with all four tokens home; game ends immediately |
| No legal move | turn passes automatically (a six that cannot move also passes) |

Every rule above has a test in `tests/engine.test.ts`.

## Position encoding

One number per token:

| Progress | Meaning |
|---|---|
| `-1` | in the yard |
| `0..51` | on the ring; ring index `(START[seat] + progress) % 52` |
| `52..56` | own home column, cell `0..4` |
| `57` | home (finished) |

That makes "exact roll to finish" a single comparison `progress + dice <= 57` and
lets the renderer map positions to board coordinates without the engine knowing any
layout.

## Determinism

`GameState` carries its PRNG state. Given the same seed and the same actions, `step`
produces byte-identical states — asserted by a test. Consequences:

- a saved game is `{seed, playerCount, actions[]}`, a few hundred bytes;
- any bug is reproducible from a seed;
- the AI can be fuzzed without mocks.

