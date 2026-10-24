# RockStyle Chess

A mobile chess app built with Expo Router (SDK 54) + React Native, styled as a
"rockstar arena" experience, with a companion Node/Express/Socket.IO server
(`server/`) for online play, accounts and the whole economy. Almost everything
is wired end to end; what is still missing before launch is tracked in
[`ROADMAP.md`](ROADMAP.md).

## Features

**Chess and play modes**
- **Chess engine** — `chess.js` drives all legality, check/checkmate/
  stalemate/draw detection on client and server; the app only renders and
  dispatches moves.
- **Six roster bots on five difficulty tiers** (`src/lib/botEngine.ts`,
  roster in `economy.config.json` -> `bots`) — a from-scratch negamax/
  alpha-beta heuristic bot, iteratively deepened against a wall-clock deadline
  so it never freezes the JS thread (easy = depth 1, medium = deeper), and
  three Stockfish 18 WASM tiers (basic ~1600 / lite ~2000 / strong ~2800) run
  in a hidden `react-native-webview` (`src/components/StockfishEngine.tsx`).
  Rewarded bot games go through a server-issued, PGN-verified session.
- **Local pass-and-play** (client-only, unrewarded) and **puzzles** (~250
  Lichess puzzles, local progress).
- **Online multiplayer** — matchmaking per venue and time control, private
  rooms, friend challenges, live move sync, server-authoritative clocks,
  draw offers, rematch, reconnection within a grace window, in-match chat and
  live spectating. Every move is re-validated server-side with `chess.js`.
- **The Tour** (campaign: 6 chapters of gigs and boss bots) and **Festival
  Run** (a paid ladder of server-played bot sets).

**Accounts, progression and economy**
- **Accounts** — email/password via **better-auth** (bearer + Expo plugins),
  or guest play with a persisted device id.
- **Rating, Fame, levels and titles** — Elo (K=32) on rated online games;
  Fame/levels/titles granted in one place (`grantFame`); a post-match Show
  Report and level-up celebrations.
- **Economy** — chips and gems, every price and payout in
  `economy.config.json`: chip wagers at Club-and-up venues, cosmetics in the
  Forge (boards, piece sets, 3 avatar classes), Backstage Gear, Review Packs,
  daily bonus, spin, daily/weekly quests, achievements.
- **Monetization** — Google Play Billing (chip/gem packs, Remove Ads) and
  AdMob rewarded/interstitial ads (test ids until a real AdMob account exists).
- **Social** — friends with live presence, DMs, notifications, global and
  friends leaderboards, public player profiles, report/block.

**Not built yet:** tournaments, Backstage Pass, venue/country leaderboards.
Sign-in is email + password (primary), "Continue with Google" (the one social option,
needs the Google Cloud setup below) and guest play. See [`ROADMAP.md`](ROADMAP.md).

## Tech stack

**Client**
- Expo SDK 54, Expo Router (file-based routing + route groups), React 19,
  React Native 0.81
- `chess.js` — chess rules engine
- `react-native-reanimated` / `react-native-gesture-handler` — board
  animation and drag/tap interaction
- `react-native-webview` — hosts the Stockfish WASM build for the three
  Stockfish bot tiers
- `expo-image` (pieces, art), `expo-audio` (SFX + menu music), `expo-haptics`
- `better-auth` + `@better-auth/expo` (session token in `expo-secure-store`),
  `socket.io-client`, `@react-native-async-storage/async-storage` (persisted
  guest id, local settings)
- `react-native-iap` (Google Play Billing), `react-native-google-mobile-ads` (AdMob)

**Server** (`server/` — a separate Node.js project with its own
`package.json`, deployed independently)
- Express + Socket.IO — realtime match and matchmaking layer
- PostgreSQL + Drizzle ORM (`drizzle-kit` for migrations)
- `better-auth` (Drizzle adapter, bearer + Expo plugins) — auth
- `google-auth-library` — Play purchase verification

## Project structure

```
src/
  app/                    Expo Router screens, grouped by feature
    (auth)/      sign-in, sign-up, onboarding (pick rockstar, welcome reward)
    (play)/      setup, matchmaking, game room, match, bots, Tour, Festival, puzzles, replay, result, tournaments
    (rewards)/   daily bonus, spin, quests, achievements, collections
    (settings)/  Control Core, alerts, account security, support, FAQ, report/blocked players
    (shop)/      Rock Shop (IAP packs, Remove Ads, Gear), Forge (cosmetics)
    (social)/    rankings, Iron ID, friends, messages, Front Row (spectate)
    (tabs)/      home (lobby), play (mode picker)
    (modals)/    reserved, currently empty
    index.tsx    entry route: /home with a session or a chosen guest mode, else /sign-in
  components/    ui/ primitives (RockButton, RockCard, ChessBoard, ...), plus feature folders
  hooks/         useChessGame, useChessClock, useFriends, useTour, useFestival, ...
  lib/           bot engines, Stockfish protocol, sockets, auth, ads, economy mirror
  constants/     theme.ts (design tokens), venues, bots, cosmetics catalogs
server/
  src/
    index.ts                  Express + Socket.IO entry point, every match-ending path (finishMatch)
    match.ts / matchmaking.ts in-memory live match & queue state
    betterAuth.ts             better-auth instance (mounted at /api/auth/*)
    auth.ts                   the single authRouter for every /me/* route
    db/                       Drizzle schema + one module per feature (wagers, tour, festival, ...)
  drizzle/                    generated SQL migrations (committed)
economy.config.json           every price and payout (generated into client + server mirrors)
```

Most directories have their own `README.md` with more detail on individual
files and design decisions (why a file exists, what Stitch mockup it came
from, what's still a stub) — check those first when working in a given
area. `server/README.md` in particular documents the full Socket.IO
protocol and the auth/persistence design.

### Documentation map

| File | What it covers |
|---|---|
| `README.md` | This overview, setup, Android builds |
| `ROADMAP.md` | Prioritized list of what is missing before launch (blockers, production readiness, game gaps, known bugs) |
| `CLAUDE.md` / `AGENTS.md` | Cross-cutting architecture rules for coding agents |
| `server/README.md` | Every server system: economy, progression, Tour, Festival, wagers, ads, protocol, deploys |
| `DESIGN.md` | Design tokens (colors, type, spacing, gradients, shadows) |
| `ui.md` | Motion, audio, navigation and a screen-by-screen UI reference |
| `product_overview.md` | Client-facing, non-technical product description |
| `src/**/README.md` | Per-folder file rationale |
| `TEMP-match-crash-notes.md` | Open Android match-crash investigation (delete when fixed) |

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
cp .env.example .env       # set DATABASE_URL to your local Postgres, + BETTER_AUTH_SECRET
npm run db:migrate         # apply pending migrations (local DB)
npm run seed:spin && npm run seed:cosmetics && npm run seed:quests && npm run seed:achievements
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
`server/README.md` for the full protocol reference and why Drizzle over
Prisma.

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
`.../debug/app-debug.apk` if you built that variant). The release build is
signed with the real upload keystore (`release.jks` + `keystore.properties` in
the repo root, both gitignored) via `plugins/withReleaseKeystore.js`, which
re-applies the signing config on every prebuild and falls back to the debug
keystore when those files are missing (e.g. a fresh clone).

**Play Store upload needs an App Bundle, not an APK:** run
`./gradlew bundleRelease` (output `android/app/build/outputs/bundle/release/app-release.aab`).
`plugins/withKotlinMetadataSkip.js` is required for the AdMob native build.

### Email verification (one-time setup)

New email/password accounts get a 6-digit code by email (and "Forgot Password?" works) once the mail side exists. Until
`EMAIL_GATE=1` is set on the server nothing is enforced, so it can be deployed first. Email *checks* (typos, disposable
and non-existent domains) are always on.

1. A domain you control and a Resend account (free tier is fine); add the SPF/DKIM DNS records it shows and create an API key.
2. `npm run db:migrate:remote` (migration 0022) **before** deploying the new server. It marks every existing unverified account
   as grandfathered, so nobody already playing is gated.
3. Railway variables `RESEND_API_KEY`, `MAIL_FROM` (e.g. `Rockstyle Chess <no-reply@yourdomain>`), then `EMAIL_GATE=1`.
4. Locally, with no key the code is printed in the server console. A fake test domain can be exempted with `TEST_EMAIL_DOMAIN`
   in your local `server/.env` (see `.env.example`); it is ignored on any non-local database.

### Google sign-in (one-time setup)

The code is complete and uses the browser flow (Chrome Custom Tab; no native module, no SHA-1s). Until the two
server variables below are set, the Google button just reports "not available" and email/password is unaffected.

1. Google Cloud Console -> OAuth consent screen: External, app name + support email, scopes `openid`, `email`,
   `profile` only (no Google review). Publish it ("In production"), otherwise only listed test users can sign in.
2. Credentials -> OAuth client ID -> **Web application**. Authorised redirect URIs:
   `https://<your-railway-url>/api/auth/callback/google` and, for local testing,
   `http://localhost:4000/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Railway (and in `server/.env` locally). `BETTER_AUTH_URL`
   must be the real public URL, because it builds that redirect URI (a mismatch is Google's `redirect_uri_mismatch`).
4. Existing email/password players are not auto-linked (their email is unverified, and linking on it would allow
   account takeover); they sign in with their password and tap **Link Now** under Account Security.

### Push notifications (one-time setup)

The code is complete (Expo Push Service); delivery needs accounts only you can create. Until step 1-3 are done
the app simply never gets a push token and nothing breaks.

1. **Firebase:** create a project, add an Android app `com.rockstylechess.app`, download `google-services.json`
   into the repo root and add `"googleServicesFile": "./google-services.json"` under `android` in `app.json`
   (adding it earlier would make `expo prebuild` fail on the missing file).
2. **Expo project id:** `npx eas-cli init` (free account; builds stay local). It writes `extra.eas.projectId` into
   `app.json`, which `getExpoPushTokenAsync` needs.
3. **FCM key for Expo:** Firebase -> Project settings -> Service accounts -> generate a key, then upload it at
   expo.dev -> your project -> Credentials -> Android -> FCM V1 service account key.
4. **Server:** `npm run db:migrate:remote` (migration 0021) before deploying; `EXPO_ACCESS_TOKEN` only if you turn
   on enhanced push security. Details: `server/README.md` -> "Push notifications".
5. Rebuild the APK (`expo prebuild` + gradle). Expo Go cannot receive Android push on SDK 54, and an emulator
   returns no token (`Device.isDevice` is false). Test with a real phone: sign in, allow notifications, then use
   expo.dev -> Push notifications tool with the token the server stored (`select token from push_devices`).

## Architecture

- **Client chess state** — `useChessGame` (`src/hooks/useChessGame.ts`)
  wraps a single `chess.js` instance in React state. It never implements
  chess rules itself — it asks chess.js and mirrors the answer into a
  render-friendly snapshot. Its `mode` selects between `'bot'`, `'local'`,
  and `'online'`; online mode routes moves through the shared Socket.IO
  connection (`src/lib/socket.ts`) instead of applying them directly, and
  reconciles incoming opponent moves from the server.
- **Bots** — `src/lib/botEngine.ts` dispatches by difficulty to
  `heuristicBot.ts` (easy = depth 1, medium = deeper; negamax with alpha-beta
  pruning, quiescence and a hard wall-clock deadline so a complex position
  can't freeze the UI thread) or the Stockfish WebView bridge
  (`StockfishEngine.tsx` + `stockfishProtocol.ts`) for the three Stockfish
  tiers. `randomBot.ts` is only a fallback.
- **Multiplayer server** — a single Socket.IO instance holds the
  matchmaking queue and live match state (`chess.js` instances) in process
  memory. Deliberately not Redis-backed: one instance is simpler and has
  fewer failure modes than a horizontally-scaled Socket.IO + Redis-adapter
  setup, and isn't needed until real load demands it (see
  `server/README.md`). Every move is authoritatively re-validated
  server-side before being broadcast to both players.
- **Auth** — self-hosted with **better-auth** (`server/src/betterAuth.ts`,
  Drizzle adapter, bearer + Expo plugins, mounted at `/api/auth/*`; the app
  uses `src/lib/authClient.ts`). REST calls send the session token as
  `Authorization: Bearer`, checked by `requireAuth`; sockets send it in the
  handshake (`socketAuth`, `server/src/authMiddleware.ts`). A missing or
  invalid token doesn't reject the connection, it
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

## Crash reporting (Sentry)

Crashes and handled errors go to Sentry, **anonymously** (see `docs/privacy-policy.html`, Section
2j): no account id, email, name, chat, tokens, request bodies or screenshots. `src/lib/crashReporting.ts`
is the only file that imports the SDK (the web build uses `crashReporting.web.ts`); it is off in
development and whenever `EXPO_PUBLIC_SENTRY_DSN` is unset. `src/app/_layout.tsx` starts it, wraps the
root, and exports an `ErrorBoundary` so a render error shows a themed "Something went wrong" screen
(`src/components/ui/AppErrorScreen.tsx`) instead of closing the app. The match screen tags reports
with `screen`/`matchMode`/`difficulty` and leaves breadcrumbs (including the measured board size).

Setup: create a Sentry account on the **EU region**, two projects (`rockstyle-app`: React Native,
`rockstyle-server`: Node), then
- put the app project's DSN in the root `.env` as `EXPO_PUBLIC_SENTRY_DSN` (public by design) and
  optionally `EXPO_PUBLIC_SENTRY_TRACES` (default `0.1`, `0` = no performance timings);
- put the build-time secrets in a gitignored `.env.sentry` (`SENTRY_AUTH_TOKEN` with
  `project:releases` + `org:read`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL=https://de.sentry.io/`).
  `scripts/build-apk.sh` loads it so the Gradle plugin uploads source maps and native symbols (readable
  stack traces); without it the build still works but traces are minified.
Sentry cannot see a process that Android kills with SIGKILL (for example after a GPU hang); its ANR
and frozen-frame data would show the symptom, but `adb logcat` is still the tool for that case.

## Scripts

| Command | Where | What |
|---|---|---|
| `npx expo start` | root | Start the Expo dev server |
| `npm run lint` | root | ESLint |
| `npm run dev` | `server/` | Run the multiplayer server with hot reload |
| `npm run build` then `npm start` | `server/` | Compile and run the server for production |
| `npm run db:generate` | `server/` | Generate a SQL migration from schema changes (`npx drizzle-kit` won't resolve: `bin-links=false`) |
| `npm run db:migrate` | `server/` | Apply pending migrations to the local DB (`db:migrate:remote` for Neon) |
| `npm run seed:<spin\|cosmetics\|quests\|achievements>` | `server/` | Idempotent catalog seeds (`:remote` variants for Neon) |
| `npx tsc --noEmit -p tsconfig.json` | root | Client type check |
| `node scripts/gen-economy.mjs && node scripts/check-economy.mjs` | root | Regenerate + validate the economy mirrors |
| `node scripts/rasterize-pieces.mjs` | root | Render piece SVGs to PNGs (`assets/pieces/png/`) |
| `bash scripts/build-apk.sh [fast\|full]` | root | Release APK (fast = arm64 only) |
