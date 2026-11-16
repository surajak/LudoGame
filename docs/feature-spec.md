# Feature spec — offline Ludo (working title *Ludo Offline*)

Derived from `recon-apk.md`. Scope = what we build. Everything not listed as **Keep**
is deliberately absent, not forgotten.

## 0. Ground rules

1. **Rules and UX only.** The rules of Ludo are public-domain board game rules. Layout,
   animation *feel* and sound *roles* are reimplemented from scratch.
2. **Zero copied assets.** No Ludo King board art, dice textures, SVGA/Spine files,
   avatars, audio clips, fonts, or gift/entry-effect packs. No Unity bundles are opened
   at runtime, extracted into the build, or shipped.
3. **Zero network.** No `fetch`, no `XMLHttpRequest`, no WebSocket, no third-party
   script, no analytics, no remote config. Enforced by test, not by promise.
4. **No monetization.** No ads, IAP, coins, chests, battle pass, offerwall, rewarded video,
   energy, lives or timers.

## 1. Keep / drop

### Game modes

| Reference mode | Decision | Note |
|---|---|---|
| Classic Ludo, 2–4 players | **Keep** | Core of the app |
| Vs computer (AI) | **Keep** | 3 difficulties, heuristic AI |
| Local pass-and-play (hotseat) | **Keep** | The actual offline mode |
| Ludo 5-player (`GameController5P`) | Drop | Needs a 5-arm board; low value, high art cost |
| Ludo 6-player (`GameController6P`) | Drop | Same |
| Quick Ludo / LMP (`GameController_LMP_Quick`) | Drop (v1) | Possible fast mode later |
| Team-up online (`gameControllerTeamUpOnline`) | Drop | Online-only concept |
| Snake & Ladders (`GameControllerSNL`) | Drop | Separate game |
| Seasonal event (`GameController_Corona`) | Drop | Live-ops |
| Online multiplayer, invite deep links | Drop | Requires network |

### Rules (public domain, all kept)

- 4 tokens per player; 52-cell shared ring + 6-cell home column + centre.
- Token enters only on a 6; a 6 grants another roll.
- **Three consecutive 6s** → turn forfeited.
- Capture on landing on an opponent's token, unless the cell is a **star/safe** cell.
- A captured token returns to its yard, and the capture **grants another roll**.
- **Blockade**: two tokens of one colour on a cell cannot be landed on by opponents.
  Passing a blockade is allowed (documented ruleset choice — the reference also only
  forbids occupying the square).
- Exact roll required to reach home; overshoot is illegal.
- All four tokens home → that player wins immediately (no ranking play).
- Turn timer optional (default off — this is offline).

### Presentation

| Reference | Decision | Our implementation |
|---|---|---|
| Board skins ×7 (`bpacksnl1..7`) | Keep concept, not art | 3 original palettes + high-contrast mode |
| Dice skins ×17 (`dicepack1..17`) | Keep concept, not art | 3 original dice styles, purely CSS/canvas drawn |
| `boardAnim`, `BOARD_ANIM`, `BG_ANIM` | Keep concept | Subtle board glow/pulse on active player |
| `blinkAnimation` (valid moves) | **Keep** | Pulsing ring on movable tokens |
| `AddPawnAnimTile` (token hop) | **Keep** | Parabolic hop, per-cell, staggered |
| `b_falseTokenOnKillAnim` (capture) | **Keep** | Knock-back + fade + shake |
| dice tumble + settle | **Keep** | 3D-ish tumble via rotation+scale easing |
| `animAudio` / `SoundManager` cues | **Keep roles** | Synthesised WebAudio, see §3 |
| SVGA gift animations `CS_Gift_*` ×40 | Drop | Cosmetics/monetization |
| Entry effects `CS_EntryEffect_0..7` | Drop | Cosmetics |
| Avatars, emotes, chat, voice (Agora) | Drop | Social/online |
| Spine rigs, butterflies, cakes, chests | Drop | Seasonal/cosmetic |
| `prefers-reduced-motion` | **Add** | Not in reference; accessibility requirement |

### Systems

| Reference | Decision |
|---|---|
| Achievements, coins, chests, gifts, leaderboards | Drop |
| Google Sign-In / Play Games / Facebook | Drop |
| Push notifications, FCM | Drop |
| Play Billing / CHECK_LICENSE | Drop |
| Deep link `lk.gggred.com` | Drop |
| Anti-cheat toolkit | Drop (no online play to cheat) |
| Save/resume of an in-progress game | **Keep** (IndexedDB, local only) |
| Settings: sound, motion, palette, player count | **Keep** |
| Haptics | Optional, `VIBRATE` only, off by default |

## 2. Recreated animation set

Own tween engine (~200 LOC): `tween(target, props, {duration, ease, delay, onUpdate})`,
easing library, and a single `requestAnimationFrame` loop; Canvas 2D rendering.
Durations from feel, not from the reference's curves.

| Cue | Motion | Default |
|---|---|---|
| dice.roll | tumble spin 600 ms, ease-out settle, 3 bounces | on |
| dice.idle | 1.5 s micro-bob while awaiting tap | on |
| token.enter | drop from yard onto start cell, 260 ms | on |
| token.hop | arc 180 ms per cell, 24 ms stagger | on |
| token.capture | 320 ms knock-back + 200 ms fade to yard | on |
| token.safe | 400 ms ring pulse | on |
| token.home | slide down home column with shrinking gap, 220 ms/cell | on |
| turn.change | 240 ms banner slide + colour wash | on |
| six.roll | 500 ms gold ring sweep + extra-roll hint | on |
| win.confetti | 1.2 s particle burst, skippable | on |
| score.tick | 120 ms numeric roll-up | on |

Built so far: `dice.roll` (480 ms CSS tumble + face cycling), `token.hop` (one arc per
square, ~70 ms/cell, no stagger) and `token.capture` (one 420 ms arc back to the yard,
no fade or shake yet). The rest are still to do. The sound set is in and covers dice,
step, capture, home, turn, invalid and win.

Global motion scale setting: `full / reduced / off`, auto-detected from
`prefers-reduced-motion`.

## 3. Recreated sound set

Synthesised at runtime with WebAudio (`OscillatorNode` + `GainNode` + noise buffer +
`BiquadFilter`). **No audio files ship.** ~40 lines of synthesis per cue.

| Cue | Synthesis sketch |
|---|---|
| `dice_roll` | filtered noise burst, 380 ms decay, 3 ticks |
| `step` | short sine blip 660 Hz, 60 ms |
| `capture` | descending saw 420→140 Hz + noise, 260 ms |
| `safe` | two-note bell (880, 1320 Hz), triangle |
| `home` | rising triad arpeggio, 400 ms |
| `turn` | soft marimba fifth, 180 ms |
| `win` | 4-note major arpeggio + shimmer noise |
| `ui_tap` | 1 ms click + 900 Hz ping |
| `invalid` | low square 180 Hz, 90 ms, quiet |

Master gain, mute toggle, and settings persisted to IndexedDB. Audio context resumes
only on first user gesture (autoplay policy). No sound plays in reduced-motion mode
unless separately enabled.

## 4. Data model (Phase 1 target)

```ts
import {
  DONE,       // 57 — four tokens here means the seat has won
  YARD,       // -1 — token not yet on the board
  SEATS,      // [0, 1, 2, 3]
  START,      // seat -> ring index of its start square (0, 13, 26, 39)
  SAFE_RING,  // ring indices where captures are impossible
  createGame, // (seed, playerCount) -> GameState
  legalMoves, // GameState -> LegalMove[] (empty unless phase === 'await-move')
  step,       // (GameState, Action) -> { state, events }
} from './engine/index.ts';

type Action =
  | { type: 'roll'; forced?: number } // `forced` is a test hook, not used in play
  | { type: 'move'; token: 0 | 1 | 2 | 3 };
```

Token position is a single number, `progress`, which collapses the four zones into
one ordered axis: `-1` yard, `0..51` ring (index `(START[seat] + progress) % 52`),
`52..56` home column, `57` home. Distance from start to home is 57 steps, so the
"exact roll" rule is simply `progress + dice <= 57`.

The engine never reads `Math.random()`; dice come from the state's own PRNG field.
`step` is pure, so a game is fully described by `(seed, [actions])`. Saves can store
just the seed plus the action list — a few hundred bytes — and replay exactly.

Verified so far: 14 unit tests plus a 2,000-game fuzz run (every game terminates,
winner always has four tokens home, average 298 rolls, longest 673).


## 5. AI (vs computer)

Heuristic scoring per candidate move:

1. `+1000` finish a token, `+700` capture, `+400` escape threat, `+300` enter home column,
   `+200` reach safe cell, `+50` leave yard, `+progress/10` otherwise.
2. Difficulty = score noise + blunder rate: Easy 35 % random, Medium 10 %, Hard 0 %
   plus 2-ply lookahead of opponent capture risk.

No network, no model files — pure functions in the rules package.

## 6. Privacy contract (testable)

| Claim | Verification |
|---|---|
| No network calls | Build test greps bundle for `fetch(`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon` → fail on match |
| No third-party code | `package.json` dependency allowlist; build fails on unlisted dep |
| No telemetry | No analytics import exists; grep for `http://`/`https://` in `dist/` (CSP origin excepted) |
| Offline-capable | Service worker precaches all assets; Playwright test loads with network disabled |
| No permissions (web) | `manifest.webmanifest` declares only display/theme/icon |
| No permissions (APK) | Final `AndroidManifest.xml` has **no** `<uses-permission>` except optional `VIBRATE` |
| Strict CSP | `default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'none'` |

## 7. Out of scope, permanently

Online multiplayer, accounts, cloud save, social features, chat/voice, cosmetics shop,
ads, IAP, push, deep links, 5P/6P boards, SNL, events, leaderboards.

