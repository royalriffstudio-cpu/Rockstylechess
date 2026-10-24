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
the cross-cutting picture. `ROADMAP.md` is the prioritized list of what is
still missing or broken (launch blockers, production readiness, game gaps,
known bugs) — update it when you fix or find one.

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
triggered it — including the FIDE 6.9 case where a flag-fall is a draw
because the side still on the clock has no mating material
(`src/lib/chessEndgame.ts`, mirrored in `server/src/chessEndgame.ts`).
Promotion is the one move that isn't applied immediately on tap: it's parked
as `pendingPromotion` until `PromotionPicker` resolves the piece
(`completePromotion` / `cancelPromotion`).

### ChessBoard rendering — `src/components/ui/ChessBoard.tsx`

Open issue: the match screen can freeze/crash on low-end Android GPUs. The
leading suspect is that expo-image draws the traced piece SVGs as vector
`PictureDrawable`s every frame; see `TEMP-match-crash-notes.md` before
touching piece rendering.

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

Dispatches by difficulty: `heuristicBot.ts` for easy (depth 1) and medium
(negamax/alpha-beta + quiescence, iteratively deepened against a wall-clock
deadline so a complex position can't freeze the single JS thread), or three
Stockfish 18 WASM tiers run inside a hidden `react-native-webview`
(`StockfishEngine.tsx` + `stockfishProtocol.ts`). `randomBot.ts` is only a
fallback when no engine is available. The six roster bots (and which is a Tour
boss) come from `economy.config.json` -> `bots`.

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
bearer plugins — not a hand-rolled bcrypt/JWT scheme), mounted at
`/api/auth/*`; a socket with no/invalid
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

### Economy — `economy.config.json`

Every price and payout (cosmetic tiers, match/bot rewards, daily bonus, spin, quests, ads,
IAP packs, analysis, welcome bonus, venue stakes) is in the root `economy.config.json`;
`scripts/gen-economy.mjs` generates the server and client mirrors and
`scripts/check-economy.mjs` asserts the rules (1 gem = 40 chips, tier ladder, no
chip-pack arbitrage, days-to-earn). Never hardcode a price or reward in a screen or
catalog file — read it from `economy.generated.ts`. Details: `server/README.md` → "Economy".

### Progression — `server/src/db/progression.ts`

Fame (XP), level, level rewards and titles are granted in ONE place, `grantFame` (one
transaction; every reward protected by a primary-key conflict). Never write `xp`/`level`
anywhere else. Its summary is stored as a `progression_events` row, pushed live as the
socket event `progression:update` (online) or returned by `/me/bot-matches/:id/finish` (bots), and
rendered by the app's Show Report and global `ProgressionOverlay`. All numbers are in
`economy.config.json` (`fame`, `levels`). Details: `server/README.md` → "Progression".

### The Tour and bot matches — `server/src/db/tour.ts`, `server/src/db/botSessions.ts`

The campaign (6 chapters x 5 gigs + boss bots, the Encore finale) is defined in
`economy.config.json` (`tour`, `bots`) and evaluated by `server/src/tour.ts`; `applyTour`
pays it. It only ever consumes VERIFIED events: online matches from the authoritative
PGN, bot matches via a server-issued session whose PGN the server replays
(`finishBotSession`), puzzles. Never re-add a route that pays from a client-claimed
result; bot rewards must go through `botSessions.ts`. Details: `server/README.md` → "The Tour".

### Festival Run — `server/src/db/festival.ts` / `server/src/serverBot.ts`

The repeatable chip sink: pay an entry, beat a ladder of bots one set at a time, bank the purse
between sets or push on (`economy.config.json` -> `festival`; `check-economy.mjs` solves the
bank/push-on EV per skill profile). The bot is played by the **server** (a bot seat on an ordinary
`MatchState`), never by the device, because the server cannot prove a device-played bot game was
against the engine and the purse is several times the entry. The entry is debited in the
transaction that inserts the run; every payout is a locked conditional status flip out of
`active`. Never move chips for a run outside `festival.ts`; never pay a Festival set from a
client-reported result; run `node scripts/gen-server-bots.mjs` after changing the app's bots.
Details: `server/README.md` → "Festival Run".

### Wagers — `server/src/db/wagers.ts`

Online matches at venues with a buy-in (Club and up) are played for chips: both buy-ins
are escrowed in one transaction at pairing (before the match exists), every ending goes
through `finishMatch` in `server/src/index.ts`, and settlement is an idempotent
conditional UPDATE (winner takes `prize`, 10% rake leaves the economy, draws and
under-6-ply resign/draw/forfeit refund). Never add a new match-ending path that skips
`finishMatch`; never move chips outside `wagers.ts`'s transactions. Details:
`server/README.md` → "Wagers".

### Ads — `src/lib/ads/` / `server/src/adRewards.ts`

AdMob (`react-native-google-mobile-ads`, pinned 16.x for RN 0.81) behind one wrapper:
`src/lib/ads/index.ts` is the only file that imports the SDK (`index.web.ts` is the
web stub — never import the SDK elsewhere, it breaks the web bundle like
react-native-iap does). Placements are a whitelist in `src/lib/ads/types.ts`: rewarded
(Shop free chips, extra spin, daily-bonus x2) and interstitial (leaving the result
screen, "Next Puzzle"); **no banners, nothing during `/match`, `/puzzle-match` or
`/matchmaking`**. The server decides every reward: caps and amounts in `adRewards.ts`,
redeemed inside the reward's own transaction via `db/adEvents.ts`; `ADS_REQUIRE_SSV`
switches from trusting the client (test ids) to Google's signed SSV callback. Test ad
ids are the default until real ones are set — a Play Store build must not ship with
them. "Remove Ads" is a non-consumable entitlement (`ads_removed`, acknowledge-only
verify path). Full detail: root `README.md` → "Ads", `server/README.md` → "Ads".

### Push notifications — `server/src/push.ts` / `src/lib/pushNotifications/`

Expo Push Service (Android first). `src/lib/pushNotifications/index.ts` is the only file that imports
`expo-notifications` (`index.web.ts` is the web stub — keep exports identical). The app registers its token on
every launch (`pushRegistration.ts`, `usePushNotifications` provider in `_layout.tsx`); the server stores it in
`push_devices` (token = primary key, so a shared phone follows the signed-in account) and four per-account
category switches in `push_preferences`. Almost every push goes out through ONE choke point:
`insertNotification` (`db/notifications.ts`) maps the stored type to a category; DMs call `pushDirectMessage`;
the daily reminder is `pushScheduler.ts` (atomic once-a-day claim). A push is skipped while any socket of the
account reports the app in the foreground (`app:state`). New notification types: add them to `PUSH_CATEGORY`
and to `src/lib/notificationRoutes.ts` (shared with the Backstage Alerts feed). Never call `fetch` assuming it
survives the Stockfish loader unpatched — `bots/stockfishNode.ts` restores it. Setup steps: root `README.md`
-> "Push notifications"; server detail: `server/README.md`.

### Email accounts — `server/src/emailPolicy.ts` / `db/emailGate.ts` / `mailer.ts`

Email/password sign-up is checked (`emailPolicy.ts`: syntax, typos, disposable, MX) and, with `EMAIL_GATE=1`, verified by a
6-digit code (better-auth `emailOTP`, mailed by `mailer.ts`). Unverified NEW accounts are softly gated: online matchmaking, rooms,
festival, friend requests/challenges and DMs refuse them (`blockedByEmailGate`, `requireVerifiedEmail`), and their welcome bonus is
held until `grantWelcomeBonus` (idempotent) runs on verification. Existing accounts are `email_grandfathered`; Google and test-domain
accounts are verified at creation. The local test domain lives only in `TEST_EMAIL_DOMAIN` (never in source or docs) and
`isTestEmail` is false on any non-local database: never branch on a literal domain. New online/social actions must call the gate.

### Crash reporting — `src/lib/crashReporting.ts` / `server/src/monitoring.ts`

Sentry, **anonymous by policy** (`docs/privacy-policy.html` Section 2j): no user id, email, name,
headers, bodies or tokens are ever sent, and that is enforced centrally in `beforeSend` /
`beforeBreadcrumb` (app) and `dataCollection` + `beforeSend` (server), not at call sites. The app
SDK is imported ONLY by `src/lib/crashReporting.ts` (`crashReporting.web.ts` is the web stub, same
rule as `src/lib/ads`); everything else calls its helpers (`reportError`, `setCrashTags`,
`addCrashBreadcrumb`). It does nothing in `__DEV__` or without `EXPO_PUBLIC_SENTRY_DSN`; the server
does nothing without `SENTRY_DSN`. Never add a tag or breadcrumb carrying a player id/email/name:
if the privacy policy's description of what is sent changes, update it in the same change.
Details: root `README.md` → "Crash reporting", `server/README.md` → "Crash reporting".

### Sound — `src/lib/soundEffects.ts` / `src/lib/backgroundMusic.ts`

Six short gameplay SFX (move/capture/castle/check/checkmate/illegal) plus
three celebration cues (level-up/reward/title, played by
`src/lib/celebration.ts`), each a pre-instantiated `expo-audio` `AudioPlayer`
in `soundEffects.ts` (eager, no pooling — chess is turn-sequential). Menu
music (three tracks played in a fixed cycle) is lazily created instead.
Both toggle off a persisted preference; the root layout
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
