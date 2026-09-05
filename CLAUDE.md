# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

RockStyle Chess: an Expo/React Native mobile chess app styled as a "rockstar
arena" experience, with a companion Node/Express/Socket.IO server for real
online multiplayer, accounts, and persistence. Chess rules always come from
`chess.js` (same library on client and server) — nothing in this repo
reimplements move legality, check/checkmate/stalemate/draw detection, or
FEN/PGN handling itself.

This is **two separate npm projects in one repo**: the root is the Expo app,
`server/` is its own independent Node project with its own `package.json`,
`node_modules`, and deploy target. Always `cd server` before running a
server-side command.

Most `src/` subdirectories — every route group under `src/app/` (e.g.
`(play)/`, `(rewards)/`, `(social)/`) and `src/components/` — have their own
`README.md` with file-level rationale (why a screen exists, what Stitch
mockup it came from, which parts are still mock data). Check the relevant
one before making structural changes in that area; this file only covers
the cross-cutting picture.

## Commands

### Client (root)

```bash
npm install
cp .env.example .env   # set EXPO_PUBLIC_SERVER_URL (LAN IP, not localhost, for a physical device)
npx expo start          # Metro dev server; press w for web, or scan the QR/use a simulator
npm run lint             # expo lint (ESLint)
npm run android            # expo run:android
npm run ios                 # expo run:ios
```

No automated test suite exists in this repo (no jest/vitest configured, no
`*.test.*`/`*.spec.*` files). Verify changes with a type check and by
actually running the app (see the `run` skill, or `npx expo start` +
Expo Go/an emulator) — `npm run lint` and TypeScript compiling clean are not
a substitute for exercising the feature:

```bash
npx tsc --noEmit -p tsconfig.json
```

### Server (`server/`)

```bash
cd server
npm install
cp .env.example .env         # DATABASE_URL (local Postgres), BETTER_AUTH_SECRET
npm run dev                   # tsx watch src/index.ts, listens on :4000
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # type check
```

Both root and `server/` have `bin-links=false` in `.npmrc` (this repo lives
on an exFAT drive, which doesn't support the symlinks npm normally creates
for package `bin/` entries) — `npx <tool>` may not resolve. Match the
existing `package.json` scripts' own pattern and invoke the binary directly:
`node node_modules/<pkg>/bin.cjs ...` (drizzle-kit) or
`node node_modules/<pkg>/bin/<tool>` (tsx, tsc).

### Database (`server/`, requires a reachable Postgres via `DATABASE_URL`)

```bash
npm run db:generate      # after editing src/db/schema/*.ts -- writes a reviewable .sql into drizzle/ (commit it)
npm run db:migrate       # applies pending migrations to the LOCAL dev DB
npm run seed:spin        # seed spin_prizes (POST /me/spin 500s with 'spin-prizes-not-seeded' until this runs)
npm run seed:cosmetics   # seed board/piece cosmetic catalogs
npm run seed:quests      # seed the daily quest catalog
```

All seed scripts are idempotent (upsert by `id`). Matching `:remote` variants
(`db:migrate:remote`, `seed:spin:remote`, etc.) target `.env.production`
(the real Neon database) — only run those deliberately, after the local
migration/seed has been tested. See `server/README.md`'s "Local development
vs. production" for the full split and the Railway/Neon deploy steps.

### Android local build

```bash
npx expo prebuild -p android   # generates android/ (gitignored, safe to re-run)
cd android && ./gradlew assembleRelease   # bundles JS statically -- use this, not assembleDebug, for anything installed off this machine
```

`assembleDebug` needs a live Metro server reachable at build time or the app
hangs on the splash screen forever with no error. Needs a full JDK 17 on
`JAVA_HOME` (not just a `java` binary — headless JRE-only installs fail deep
in the build with a confusing error) and the pinned NDK version installed via
`sdkmanager`. **Don't remove `package.json`'s `"overrides": {"expo-asset":
"~12.0.13"}`** — without it, `expo-audio`'s unbounded `expo-asset` dependency
gets hoisted over the version `expo` actually needs, and Android crashes with
`NoClassDefFoundError` right after the splash screen with no build-time error
(verify with `npm ls expo-asset` — must show one version, not two). Full
detail, including the exFAT disk-space failure mode, in root `README.md`'s
Android section.

## Architecture

### Client chess state — `src/hooks/useChessGame.ts`

Wraps one mutable `chess.js` `Chess` instance in React state; it only asks
chess.js questions and mirrors the answer into a render-friendly
`GameSnapshot` — it never implements a rule itself. `mode` is one of `'bot'
| 'local' | 'online' | 'puzzle'`. Every move-application path (human tap, bot
move, online opponent's `move:applied`, puzzle attempt) converges on one
`refresh()` call that commits board/turn/lastMove/lastMoveSound/etc. as a
single atomic snapshot — this atomicity is deliberate (a prior bug from
splitting it into multiple `setState` calls caused torn updates the board
animation observed). Game endings (checkmate/stalemate/draw, resignation,
forfeit, timeout) all funnel through a single `gameOverFiredRef`-guarded path
so exactly one `onGameOver` fires per game regardless of which source
triggered it.

### ChessBoard rendering — `src/components/ui/ChessBoard.tsx`

Pieces have **persistent identity**: a `LivePiece {id, type, square}` list is
reconciled incrementally per move (normal move, capture including en
passant, castling — both king and rook, promotion) rather than re-derived
from the board string every render. Each piece is hosted by exactly one
`BoardPiece` component for its whole lifetime on the board and repositioned
via an animated transform — it is never unmounted/remounted just because a
square's occupancy changed (that was a real prior bug: pieces visibly
blanking/re-decoding on every move, especially on Android). A fast-path
reconciler (`tryFastPath`) resolves ordinary moves from chess.js's verbose
move fields; anything ambiguous (reset, puzzle retry, non-forward replay
scrub) falls back to `resyncFromBoard`, which snaps instantly instead of
animating. Dragging reuses the same persistent piece (no separate ghost
component) via a `draggingIdSV` shared value read directly in the
`useAnimatedStyle` worklet. Per-move-kind travel timing, captures fading
out, and check/checkmate flourishes are all keyed off `lastMoveSound`
(`src/lib/chessBoardSnapshot.ts`'s `classifyMoveSound`), which also drives
which sound effect plays — animation and audio are driven by the same value
so they can't drift out of sync.

### Match clock — `src/hooks/useChessClock.ts`

A real per-side countdown, not derived from `useChessGame`. Refs hold the
authoritative remaining-time anchor (updated only at turn-change boundaries);
a 1Hz interval derives the display value from anchor + true elapsed wall
time, and a separate precise `setTimeout` (not the 1Hz poll) fires expiry at
the exact deadline. For online matches, `reconcile()` snaps to
server-authoritative values delivered on every `move:applied` — server-side
enforcement lives in `server/src/match.ts`'s `ClockState` /
`applyMove`, mirroring the existing disconnect/forfeit-timer pattern
(`server/src/index.ts`'s `RECONNECT_GRACE_MS`). Disconnecting does **not**
pause a running clock (matches lichess/chess.com convention — otherwise a
losing player could grief by disconnecting for free time). Bot/local clocks
are entirely client-side, matching how those modes never touch the server
for anything else gameplay-related.

### Bots — `src/lib/botEngine.ts`

Dispatches by difficulty: `randomBot.ts` (easy, 1-ply), `heuristicBot.ts`
(medium — negamax/alpha-beta, iteratively deepened against a wall-clock
deadline so a complex position can't freeze the single JS thread), or three
Stockfish 18 WASM tiers run inside a hidden `react-native-webview`
(`StockfishEngine.tsx` + `stockfishProtocol.ts`).

### Multiplayer server (`server/`)

One Socket.IO process holds the matchmaking queue and every live match's
`chess.js` instance in process memory — deliberately not Redis-backed (see
`server/README.md`); not needed until real load demands it. Every move is
re-validated server-side with `chess.js` before being broadcast — the
client's own check is instant UI feedback only, never trusted alone. Two
independent single-shot `setTimeout`-per-color mechanisms live on
`MatchState`: `forfeitTimers` (disconnect/reconnect grace,
`RECONNECT_GRACE_MS` = 60s) and `clock.deadlineTimer` (real flag-fall) — kept
deliberately separate (different reschedule cadence) rather than merged.
Auth is **better-auth** (`server/src/betterAuth.ts`, Drizzle adapter, Expo +
bearer plugins — not a hand-rolled bcrypt/JWT scheme, despite what the
READMEs' prose still says), mounted at `/api/auth/*`; a socket with no/invalid
token still connects and plays as an anonymous guest
(`src/lib/playerId.ts`'s persisted device UUID) — `requireAuth`/`socketAuth`
in `authMiddleware.ts` are the two enforcement points. Match persistence
(`server/src/db/persistMatchResult.ts`) runs *after* the realtime broadcast
that ends a match, fire-and-forget, and only when both seats are
authenticated accounts; every async Express route is wrapped in
`asyncHandler.ts` so a DB failure degrades to a logged error, never a
process crash. Full Socket.IO protocol reference in `server/README.md`.

### Data-driven catalogs (quests, spin prizes, cosmetics)

Recurring pattern: an authoritative constant array in `server/src/*.ts`
(e.g. `questCatalog.ts`, `spinPrizes.ts`, `boardThemes.ts`, `pieceSets.ts`),
a matching `drizzle` table it seeds via an idempotent `db/seed*.ts` script
(upsert by `id`, never insert-only), and a read-only display-only mirror of
the same data in `src/lib/*.ts` on the client where one is needed. Per-user
progress against a catalog (quest progress, cosmetic ownership) is a
separate join table keyed by `(userId, catalogId, ...)`, resolved through a
`db/<feature>.ts` module (e.g. `db/quests.ts`) and exposed via a couple of
routes added directly to `server/src/auth.ts`'s single `authRouter` —
there's no per-feature router file. UTC-calendar-day reset logic (daily
bonus, daily spin, daily quests) shares `server/src/db/utcDay.ts`.

### Sound — `src/lib/soundEffects.ts` / `src/lib/backgroundMusic.ts`

Five short SFX (move/capture/castle/check/checkmate/illegal), each a
pre-instantiated `expo-audio` `AudioPlayer` (eager, no pooling — chess is
turn-sequential). A looping menu-only background track is lazily created
instead. Both toggle off a persisted preference; the root layout
(`src/app/_layout.tsx`) starts/stops menu music by exact route (not route
group — `(play)/` contains non-gameplay screens like the bot picker and
setup that should still play menu music).

## Design system

Follow `./DESIGN.md` for all colors/fonts/spacing/radius/shadow tokens when
writing UI — it's pulled live from `src/constants/theme.ts` and is the
single source of truth; never hardcode a hex value or font name in a screen.
`./ui.md` covers the broader UI/UX layer DESIGN.md doesn't — motion/animation
conventions, audio integration, navigation structure, and a screen-by-screen
reference.

## Visual Fidelity Rule (Stitch Integration)

When building any screen from a `stitch-export/*/code.html` file, you MUST
NOT silently drop background images, glow effects, or atmospheric visuals
just because they're implemented as external image URLs or complex CSS in
the source file.

For every visual element in a Stitch mockup, follow this priority order:
1. If it's a stable, real image URL, use it directly via ImageBackground/Image.
2. If it's an unstable/internal URL or a CSS-only effect (gradients, box-shadows,
   layered glows, particle animations), rebuild the same visual effect natively
   using LinearGradient, shadow/glow styling, layered Views, or Animated/Reanimated
   — do not just omit it.
3. If something genuinely cannot be replicated natively and you must simplify it,
   you MUST explicitly flag it to me in your response (e.g. "Note: skipped X because
   Y — let me know if you want it rebuilt a different way") rather than omitting it
   silently. Never simplify a background/atmosphere element without flagging it.

This applies to every screen going forward, including ones already built — if you
notice a past screen has this issue while working on something else, flag it to me
even if fixing it isn't the current task.

## Component Depth Standard

RockButton and RockCard (and any future shared component with a "glossy/glowing"
treatment) must always be built with REAL layered depth, not flat fills:
- Background: LinearGradient, not a solid color, when the source design has any
  gradient or shading.
- Glossy highlight: a top-aligned semi-transparent white-to-transparent gradient
  overlay where the source design shows one.
- Outer glow: real colored shadow (shadowColor/shadowRadius/shadowOpacity on iOS,
  and an Android-compatible equivalent) matching the component's accent color —
  not just a plain elevation with no color.
Before marking any new shared component as "done," compare it directly against
its Stitch source file's CSS and confirm gradients/glow/highlight are present,
not simplified away. If a true visual match isn't achievable in React Native,
flag it explicitly rather than silently flattening it.
