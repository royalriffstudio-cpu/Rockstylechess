# RockStyle Chess

A mobile chess app built with Expo Router (SDK 54) + React Native, styled as a
"rockstar arena" experience. Chess itself, the five-tier bot ladder, and real
online multiplayer (with accounts, Elo, and match history) are fully wired up
end-to-end. Most of the surrounding meta-game — shop, social, daily
rewards — is still UI rendering mock data over Stitch-generated designs,
being wired up incrementally on top of the database schema that already
exists for it.

## Features

**Real / working**
- **Chess engine** — `chess.js` drives all legality, check/checkmate/
  stalemate/draw detection; the app only renders and dispatches moves.
- **Five-tier bot ladder** (`src/lib/botEngine.ts`) — a from-scratch
  negamax/alpha-beta heuristic bot, iteratively deepened against a shared
  time budget (time-budgeted to stay responsive on React Native's single JS
  thread) for easy (1-ply) and medium (up to 3-ply), and three Stockfish 18
  WASM tiers (basic ~1600 Elo / lite ~2000 Elo / strong ~2800 Elo) run
  inside a hidden `react-native-webview` (`src/components/StockfishEngine.tsx`).
- **Local pass-and-play** and **bot matches**, fully client-side, no server
  required.
- **Real online multiplayer** — matchmaking by venue tier, live move sync,
  resign/forfeit, and reconnection within a grace window, via a companion
  Socket.IO server (`server/`). Every move is re-validated server-side with
  `chess.js` again before being broadcast — the client's own check is only
  for instant UI feedback, never trusted alone.
- **Self-hosted accounts** — email/password sign-up and sign-in, bcrypt +
  JWT sessions, wired end-to-end from the `(auth)` screens through the
  server.
- **Persistence** — PostgreSQL (via Drizzle ORM) stores accounts, player
  profiles, Elo ratings, and match history. Elo (K=32) and win/loss/streak
  stats update automatically after every online match between two
  authenticated players. Persistence writes happen *after* the realtime
  broadcast, fire-and-forget — a database hiccup degrades to "this result
  didn't save," never to blocked or broken gameplay.
- **Safe-area-aware layout** across every screen (notch/status bar, gesture
  bar, bottom nav all accounted for).

**UI-only / mock (not backed by real data yet)**
- Shop (chip/gem packs, VIP), Forge (cosmetics), Rewards (daily bonus,
  quests, achievements, spin wheel, collections), and Social (friends,
  bands, messages, world rankings, front-row spectate) all render hardcoded
  arrays today. Their Postgres tables already exist — see
  [Database](#database) — but no endpoints or screen wiring consume them
  yet; this is deliberately scoped as follow-up work, not an oversight.

## Tech stack

**Client**
- Expo SDK 54, Expo Router (file-based routing + route groups), React 19,
  React Native 0.81
- `chess.js` — chess rules engine
- `react-native-reanimated` / `react-native-gesture-handler` — board
  animation and drag/tap interaction
- `react-native-webview` — hosts the Stockfish WASM build for the two
  hard-mode bots
- `socket.io-client`, `expo-secure-store` (JWT), `@react-native-async-storage/async-storage`
  (persisted guest id for unauthenticated play)

**Server** (`server/` — a separate Node.js project with its own
`package.json`, deployed independently)
- Express + Socket.IO — realtime match and matchmaking layer
- PostgreSQL + Drizzle ORM (`drizzle-kit` for migrations)
- `bcryptjs` + `jsonwebtoken` — auth

## Project structure

```
src/
  app/                    Expo Router screens, grouped by feature
    (auth)/               sign-up, sign-in, onboarding
    (play)/                venue select, matchmaking, live match, bot & tournament galleries
    (rewards)/             daily bonus, quests, achievements, spin, collections     [mock]
    (settings)/             control core (incl. logout), notifications, account, support
    (shop)/                  chip/gem shop, cosmetics forge                          [mock]
    (social)/                 rankings, own profile, bands, friends, messages, spectate [mock]
    (tabs)/                    main lobby shell
    (modals)/                   reserved, currently empty
    index.tsx                    entry route: routes to /home or /sign-up based on stored session
  components/
    ui/                    design-system primitives (RockButton, RockCard, ChessBoard, ...)
    StockfishEngine.tsx    headless WebView-hosted Stockfish bridge
  hooks/useChessGame.ts    chess.js wrapper + bot/online move orchestration
  lib/                     bot engines, Stockfish protocol, socket client, auth/session storage
  constants/theme.ts       colors, fonts, spacing tokens
server/
  src/
    index.ts               Express + Socket.IO entry point
    match.ts / matchmaking.ts   in-memory live match & queue state
    auth.ts / authMiddleware.ts REST + Socket.IO JWT auth
    db/                     Drizzle client, schema (users/matches/economy/progression/social), Elo, match persistence
  drizzle/                  generated SQL migrations (committed)
```

Most directories have their own `README.md` with more detail on individual
files and design decisions (why a file exists, what Stitch mockup it came
from, what's still a stub) — check those first when working in a given
area. `server/README.md` in particular documents the full Socket.IO
protocol and the auth/persistence design.

## Setup

### Client

```bash
npm install
cp .env.example .env      # set EXPO_PUBLIC_SERVER_URL, see below
npx expo start
```

Open in Expo Go, or a dev build. `chess.js`, the bot ladder, and local
pass-and-play all work with no server running at all. Online multiplayer
and accounts need the server below; `EXPO_PUBLIC_SERVER_URL` should point
at it — your machine's LAN IP + port when developing against a physical
device (Expo Go can't resolve `localhost` to your dev machine). Day-to-day
this should be your **local** server from the section below, not the
deployed Railway one — that keeps every edit-and-reload cycle off the real
production database. Temporarily swap in the deployed `wss://` URL only
when you deliberately want to smoke-test against production; Expo
specifically recommends against relying on multiple auto-loaded `.env.*`
files for this kind of switch (`expo export`/EAS always force
`NODE_ENV=production`, making file selection unpredictable), so this one
`.env` value is a manual edit, same as the server's local-vs-remote split
below.

### Server (multiplayer + database)

```bash
cd server
npm install
cp .env.example .env       # set DATABASE_URL to your local Postgres, + JWT_SECRET
npm run db:migrate         # apply pending migrations (local DB)
npm run dev                # tsx watch src/index.ts, listens on :4000
```

Requires a reachable PostgreSQL instance (`DATABASE_URL`) — a local
Postgres install (or `createdb`'d database) for day-to-day development,
kept entirely separate from the Neon database that backs production. See
**"Local development vs. production"** in `server/README.md` for the full
local-DB setup and the `:remote` npm scripts that deliberately push a
tested migration/seed change to the real Neon database once it's approved
— that split, plus a normal `git push` for the Railway deploy itself, is
the whole "promote local changes to production" workflow. Also see
`server/README.md` for the full protocol reference, why Drizzle over
Prisma, and why auth is self-hosted rather than a third-party provider.

### Redeploying the server to Railway

The one-time Railway/Neon project setup is in `server/README.md`. Once that
exists, shipping a server code change is just:

```bash
cd server
railway up --detach   # builds + deploys the local server/ dir directly
```

The service is already linked (`railway status` from `server/` resolves to
project `RockStyleChess`, service `server`, environment `production`), so
this pushes straight from your working tree via the Railway CLI — no
`git push` + auto-deploy round trip needed, and no extra `DATABASE_URL` step
either (it's already set as a Railway service variable pointing at the
production Neon database). Poll `railway status --json` for the new
deployment's `status` (`BUILDING` → `DEPLOYING` → `SUCCESS`), then confirm
with:

```bash
curl https://server-production-62b1.up.railway.app/health   # -> {"ok":true}
```

Client builds that should hit this instead of your local dev server need
root `.env`'s `EXPO_PUBLIC_SERVER_URL` pointed at that same URL (see the
note in **Client** above — it's a manual edit, remember to swap it back for
local dev afterward).

### Android (local build)

`android/` is gitignored (standard Expo managed workflow, regenerated on
demand) — generate it, then build with Gradle directly, no EAS account
needed:

```bash
npx expo prebuild -p android   # generates android/, safe to re-run
cd android
./gradlew assembleRelease       # standalone APK, bundles JS statically
# or: ./gradlew assembleDebug   # see warning below
```

**Use `assembleRelease` for anything you're going to install and actually use
off this machine.** `assembleDebug` produces an APK that does *not* bundle
the JS — it connects to a Metro dev server over
`ws://localhost:8081/message` at runtime and fetches the bundle live. Without
that server reachable (which it never is for a standalone install on a real
device), the app hangs on the splash screen forever, silently retrying the
websocket connection — no crash, no error, just stuck. `assembleRelease`
runs `bundleReleaseJsAndAssets` and packages the JS into the APK itself, so
it needs nothing else running.

If `android/` already exists and nothing native-facing changed (no new
native module, no `app.json` plugin/icon changes), you can skip
`prebuild` and just re-run Gradle directly against the existing `android/`.

Things that aren't obvious the first time:

- **`android/local.properties` isn't committed** (machine-specific SDK path)
  — create it with `sdk.dir=/path/to/Android/Sdk` if it's missing, or export
  `ANDROID_HOME`.
- **Needs a full JDK 17, not just a `java` binary on `PATH`.** Gradle's
  toolchain resolution can pick a JRE-only Java install (some distros ship a
  headless `java-21` package with no `javac`) and fail deep into the build
  with a confusing "does not provide the required capabilities: JAVA_COMPILER"
  error. Point `JAVA_HOME` at a JDK that actually has `javac` if that
  happens, e.g. `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew ...`.
- The pinned NDK version (currently `27.1.12297006`, see the Gradle error if
  it drifts) has to be installed once: `sdkmanager "ndk;<version>"`.
- **The native build is disk-hungry (2GB+ in `android/app/build` alone) —
  fatal if the repo lives on a drive that's nearly full**, which is the case
  here (this repo is on an exFAT SD card). A build that dies mid-way with
  `No space left on device` can leave CMake/ninja's intermediate state (and
  Kotlin's compiled classes for individual Expo modules) corrupted badly
  enough that even `./gradlew clean` fails trying to reconfigure it, or
  succeeds but leaves one module's stale compiled output behind (see the
  `expo-modules-core`/`AnyTypeCache` note below — that's how it was
  discovered: a partial cleanup that missed one module's `android/build`).
  If a build dies from disk space, free space first, then nuke **every**
  module's native build output rather than hand-picking which ones —
  cheaper than debugging a stale-cache mismatch later:
  ```bash
  find node_modules -maxdepth 3 -type d \( -path "*/android/build" -o -path "*/android/.cxx" \) \
    | xargs rm -rf
  rm -rf android/app/build android/build android/app/.cxx android/.gradle
  ```
  then re-run `./gradlew assembleRelease`.
- **`package.json` has an `"overrides": { "expo-asset": "~12.0.13" }`.**
  Don't remove it without understanding why: `expo-audio@1.1.1` declares an
  unbounded `"expo-asset": "*"` dependency, which npm resolves to whatever
  the latest published `expo-asset` is (was `57.0.13`, a version from a
  completely different/newer Expo SDK generation) and hoists to the top of
  `node_modules` — shadowing the `~12.0.13` that `expo@54.0.35` actually
  needs, which gets nested under `node_modules/expo/node_modules/expo-asset`
  instead. Android's autolinking picks up the wrong top-level one; its
  compiled Kotlin references an `expo-modules-core` internal API
  (`AnyTypeCache`) that doesn't exist in the older, actually-installed
  `expo-modules-core`, and the app crashes with `NoClassDefFoundError` right
  after the splash screen hands off to JS — no build error, only a runtime
  crash, and a full clean rebuild alone does *not* fix it (only re-resolving
  `node_modules` to a single consistent version does). Verify with
  `npm ls expo-asset` — it should show one version, not two, before trusting
  a build.

**Faster test builds:** `bash scripts/build-apk.sh` (default `fast`) builds
`arm64-v8a` only — the native C++ compiles once instead of four times, so it's
several times quicker and the APK is about half the size. It installs on
virtually any modern phone but not on old 32-bit phones or x86 emulators. Use
`bash scripts/build-apk.sh full` for anything you distribute / upload. The ABI
list is passed as a Gradle flag, so the regenerated `android/gradle.properties`
is never edited.

Output lands at `android/app/build/outputs/apk/release/app-release.apk` (or
`.../debug/app-debug.apk` if you built that variant). The release build type
currently signs with the Expo-generated debug keystore
(`android/app/debug.keystore`) — fine for sideloading/testing, but swap in a
real release keystore before shipping to the Play Store.

## Architecture

- **Client chess state** — `useChessGame` (`src/hooks/useChessGame.ts`)
  wraps a single `chess.js` instance in React state. It never implements
  chess rules itself — it asks chess.js and mirrors the answer into a
  render-friendly snapshot. Its `mode` selects between `'bot'`, `'local'`,
  and `'online'`; online mode routes moves through the shared Socket.IO
  connection (`src/lib/socket.ts`) instead of applying them directly, and
  reconciles incoming opponent moves from the server.
- **Bots** — `src/lib/botEngine.ts` dispatches by difficulty to
  `randomBot.ts` (easy), `heuristicBot.ts` (medium — negamax with alpha-beta
  pruning and a hard wall-clock deadline so a complex position can't freeze
  the UI thread), or the Stockfish WebView bridge (`StockfishEngine.tsx` +
  `stockfishProtocol.ts`) for the two hard tiers.
- **Multiplayer server** — a single Socket.IO instance holds the
  matchmaking queue and live match state (`chess.js` instances) in process
  memory. Deliberately not Redis-backed: one instance is simpler and has
  fewer failure modes than a horizontally-scaled Socket.IO + Redis-adapter
  setup, and isn't needed until real load demands it (see
  `server/README.md`). Every move is authoritatively re-validated
  server-side before being broadcast to both players.
- **Auth** — self-hosted, not a third-party provider: bcrypt-hashed
  passwords and JWT sessions (`server/src/auth.ts`,
  `server/src/authMiddleware.ts`). Sockets carry the JWT in the connection
  handshake; a missing or invalid token doesn't reject the connection, it
  just means that seat plays as an anonymous guest (`src/lib/playerId.ts`'s
  persisted device UUID) — guest play works identically, it's just never
  persisted.
- **Persistence** — match results are written to Postgres *after* the
  realtime broadcast that actually ends the match, fire-and-forget, and
  only when both seats are authenticated accounts
  (`server/src/db/persistMatchResult.ts`). A DB failure is logged
  (`console.error`) and never blocks or crashes gameplay; every async
  Express route handler is similarly wrapped (`server/src/asyncHandler.ts`)
  so a database outage can't take the whole process down.

## Economy

All prices and payouts come from `economy.config.json` (see `server/README.md` → "Economy"). After editing it run `node scripts/gen-economy.mjs && node scripts/gen-avatar-catalog.mjs && node scripts/check-economy.mjs`, then re-seed the server (`seed:cosmetics`, `seed:spin`, `seed:quests`). The Play Console products must use the SKU ids in the config (`chips_starter`, `chips_roadie`, `chips_headliner`, `chips_bonus`, `gems_100`, `gems_550`, `gems_1200`, `remove_ads`).

## Progression

Fame/levels/titles and the post-match Show Report: `server/README.md` → "Progression". The
celebration sounds (`assets/sounds/level-up.wav`, `reward.wav`, `title.wav`) are synthesised
placeholders from `node scripts/gen-celebration-sounds.mjs` — drop real audio over the same
filenames to replace them. Haptics need `expo-haptics` (native rebuild); web has no haptics.

## Venues and wagers

Venues from Club up are played for real chips (buy-in escrowed from both players, winner
takes 1.8x, 10% rake, early exits refunded) with rating gates on the top three; Garage is
free. Numbers: `economy.config.json` (`venues`, `venueRake`, `wagerVoidPlies`). Rules and
recovery behaviour: `server/README.md` → "Wagers". Deploy order: migration `0013`
(`db:migrate:remote`) then the Railway server, then the app.

## Ads

AdMob via `react-native-google-mobile-ads` (pinned to the 16.x line — 17.x needs React
Native 0.86+). Everything runs on **Google's public test IDs** until a real AdMob account
exists: the test *app* id is in `app.json`'s plugin entry, the test *unit* ids are the
defaults in `src/lib/ads/adsConfig.ts`. To go live, replace the `androidAppId` in
`app.json`, set `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID` / `EXPO_PUBLIC_ADMOB_REWARDED_ID`,
turn on `ADS_REQUIRE_SSV` on the server, and rebuild the APK — no code change. Never
upload a Play Store build that still uses test ids.

- **Placements:** rewarded — Shop "Free Chips", Spin "extra spin", Daily Bonus "claim x2";
  interstitial — leaving the result screen (every 3rd match) and "Next Puzzle" (every 5th
  solve). No banners, nothing during a match. The whitelist lives in `src/lib/ads/types.ts`.
- **Wrapper:** `src/lib/ads/` is the only code that imports the SDK (`index.web.ts` is the
  no-op web stub). It runs the Google UMP consent flow, starts the SDK after the splash,
  preloads one interstitial + one rewarded ad, pauses menu music while an ad is up, and
  never blocks navigation. Settings shows "Privacy & Ad Choices" only where consent
  rules require it (EEA/UK).
- **Remove Ads** (Shop → Chips): one-time purchase that switches off interstitials
  (`useAdsEnabled`); rewarded ads stay because the player opts into them. It must exist
  in Play Console as a one-time product with id `remove_ads`.
- Native module → needs `npx expo prebuild -p android` and a rebuild; not in Expo Go.
  Server rules: `server/README.md` → "Ads".

## Scripts

| Command | Where | What |
|---|---|---|
| `npx expo start` | root | Start the Expo dev server |
| `npm run lint` | root | ESLint |
| `npm run dev` | `server/` | Run the multiplayer server with hot reload |
| `npm run build` then `npm start` | `server/` | Compile and run the server for production |
| `npx drizzle-kit generate` | `server/` | Generate a SQL migration from schema changes |
| `npx drizzle-kit migrate` | `server/` | Apply pending migrations to `DATABASE_URL` |
