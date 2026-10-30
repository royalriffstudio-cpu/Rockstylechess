# RockStyle Chess server

Realtime multiplayer backend: Express + Socket.IO + `chess.js` (the same
library the client uses, so move legality matches exactly), plus PostgreSQL
via Drizzle ORM for everything that outlives a single match (accounts,
elo/history, progression, social, economy). Live match state itself (the
in-progress `Chess` instance, the matchmaking queue) stays in process
memory -- no database, no Redis for that part. See
`/home/abdullah/.claude/plans/is-this-bot-good-greedy-toucan.md` (or the
repo's plan history) for the reasoning behind that: a single instance is
simpler and has fewer failure modes than a horizontally-scaled Socket.IO +
Redis-adapter setup, and isn't needed until real load actually demands it.
Swapping in `@socket.io/redis-adapter` later, once you run 2+ instances, is
an isolated change, not a rewrite.

## Database

PostgreSQL + [Drizzle ORM](https://orm.drizzle.team) (`drizzle-orm` +
`drizzle-kit`, driver: `postgres`). Chosen over Prisma specifically because
it has no generated query-engine binary to download/link -- this drive's
exFAT filesystem already caused enough native-binary/symlink friction
elsewhere (see `bin-links=false` below) that a pure-TypeScript ORM avoids
repeating it. Schema lives in `src/db/schema/*.ts`, one file per domain
(`users`, `matches`, `economy`, `progression`, `social`), barrel-exported
from `schema/index.ts`.

**Auth is self-hosted here**, not Supabase (superseding the old
`(auth)/README.md` placeholder) -- bcrypt-hashed passwords in `users`,
JWT sessions issued by `POST /auth/signup` / `POST /auth/login`, verified
by `authMiddleware.ts` for both REST (`requireAuth`) and Socket.IO
connections (`socketAuth`, via `socket.handshake.auth.token`). A socket
with no/invalid token is still allowed to connect and play as a guest
(`src/lib/playerId.ts`'s persisted UUID on the client side) -- it just
never gets a trusted `socket.data.userId`, and match persistence below
requires *both* seats to have one.

**Match persistence is fire-and-forget**, per the project's async-vs-realtime
split: `db/persistMatchResult.ts` runs *after* the Socket.IO broadcast that
actually ends a match for both players, wrapped so a DB failure only logs
(`console.error`) and never blocks or crashes gameplay -- verified by
pointing `DATABASE_URL` at an unreachable host mid-match and confirming
checkmate still resolved normally client-side. (Every async Express route
handler is wrapped in `asyncHandler.ts` for the same reason on the REST
side -- an uncaught rejection there would otherwise crash the whole process,
taking every in-progress match down with it, not just that one request.)
Guest-involving matches (either seat missing a `userId`) simply aren't
persisted -- gameplay is identical, there's just nothing to save.

Migrations: schema changes go into `src/db/schema/*.ts`, then:

```bash
npm run db:generate   # writes a reviewable .sql file into drizzle/ (commit it)
npm run db:migrate    # applies pending migrations to the LOCAL dev DB ($DATABASE_URL from .env)
```

(These wrap `node node_modules/drizzle-kit/bin.cjs <command>` directly --
this drive's `bin-links=false` means `drizzle-kit` has no `.bin/` shim, so
`npx drizzle-kit ...` won't resolve it.)

Seeding: the `spin_prizes` and `cosmetic_items` catalog tables have no rows
until seeded -- `POST /me/spin` throws a clean 500
(`spin-prizes-not-seeded`) and the Forge's shop tabs have nothing
purchasable until these have been run once against `$DATABASE_URL`:

```bash
npm run seed:spin
npm run seed:cosmetics
```

Both are idempotent (upsert by `id`, not insert-only) -- safe to re-run any
time the seed data in `src/spinPrizes.ts`/`src/boardThemes.ts`/
`src/pieceSets.ts` is tuned.

**Level/XP progression** (the first written documentation of any
economy-adjacent system in this repo -- the chips economy above was never
documented here either, only in code comments): `playerProfiles.level`/
`.xp` are driven by a single polynomial curve, `src/leveling.ts`'s
`xpForLevel(level) = 300 * level^2` (level 1 is pinned to 0 XP as a special
case, since the raw formula would otherwise require 300 XP just to *start*
at level 1). `levelForXp`/`getLevelProgress` invert it and derive a
progress-bar-ready breakdown; `applyXpGain` is the only place XP is ever
granted (via `db/progression.ts`'s `grantFame`, used by `db/persistMatchResult.ts` for
online matches and `db/botSessions.ts` for verified bot matches) so `level` can never
drift from what the current `xp` implies. Fame amounts live in `economy.config.json`
(`fame`). The curve itself is
mirrored read-only in `src/lib/leveling.ts` on the client (display math
only, no mutation helper) -- keep both files in sync if it changes.

## Avatar classes (premium cosmetics)

Avatars come in three classes: **Garage Band** (the 12 original badges — free and
implicit, never rows in `cosmetic_items`), **Main Stage** (41, gems *or* chips) and
**Hall of Fame** (24, gems only **and** a rating gate). Catalog: `src/avatars.ts` +
generated `src/avatarCatalog.generated.ts` (edit prices/bands/gates in
`../scripts/gen-avatar-catalog.mjs`, which also writes the client mirror). Seeded
as `category: 'avatar'` by `seed:cosmetics` (run `seed:cosmetics:remote` after any
catalog change; no schema migration involved). Rules enforced here, not in the app:
`PATCH /me/profile` rejects an `avatarId` that is unknown (`invalid-avatar`) or
premium-and-unowned (`avatar-not-owned`); `POST /me/cosmetics/:id/unlock` adds
`currency-not-allowed` (Hall of Fame + chips), `rating-too-low` (403, with
`required`/`current`, gate read from `player_profiles.rating` at purchase time) and
`not-purchasable` (price 0). Once owned an avatar is kept even if rating drops.

## Economy (prices and payouts)

Every price and payout lives in **one file**: `../economy.config.json`. Edit it, then run
`node scripts/gen-economy.mjs && node scripts/gen-avatar-catalog.mjs && node scripts/check-economy.mjs`
from the repo root. The first writes `src/economy.generated.ts` (this server) and
`../src/lib/economy.generated.ts` (the app) so the two cannot drift; `check-economy.mjs`
asserts the rules below and prints how many casual days each tier takes to earn
(an *estimate* -- see `incomeModel` in the config, not telemetry).

Rules: **1 gem = 40 chips** everywhere. One tier ladder for all cosmetics (Common 100 gems /
4,000 chips, Rare 250 / 10,000, Epic 450 / 18,000, Legendary 750 / 30,000; Hall of Fame
900 / 1,350 / 1,800 gems only + rating gate). No chip pack may give more chips per dollar
than gems give chip-equivalent. Online win 200 / draw 40 / loss 0; bot wins pay by
difficulty (20 / 40 / 80 / 120 / 200; the server knows the difficulty from the bot session);
welcome bonus 4,000 (one Common); analysis 200 chips or 5 gems. After a price change
re-seed: `seed:cosmetics`, `seed:spin`, `seed:quests` (`:remote` for Neon). Venue buy-ins,
prizes and rating gates in the config are REAL since the wagers phase (next section).
Bot payouts are
server-verified (see "The Tour and verified bot matches"); puzzle reports are still
client-reported.

## Progression (Fame, levels, titles)

"XP" is now **Fame**; the curve is unchanged (`300 x L^2`, `src/leveling.ts`) but everything
that grants it goes through ONE transaction, `grantFame` in `src/db/progression.ts`
(`economy.config.json` -> `fame`, `levels`):

- **How much:** online win 500 / draw 50; **bot wins by difficulty** 100 / 200 / 300 / 400 /
  500 (draw = 10%), with a **daily bot-Fame cap** (2,000 of base Fame, per UTC day; online is
  never capped); **Opening Night** x2 on the first win of the UTC day (any source); **Hot
  Streak** x1.2 at a 3-win streak and x1.5 at 5+ (online wins). A draw no longer breaks a win
  streak (only a loss resets it). Multipliers apply to Fame only, never to chips.
- **What it unlocks:** each level pays a small fixed chips/gems reward exactly once
  (`level_rewards_granted` primary key, table in `economy.config.json`, expanded by
  `gen-economy.mjs` into `LEVEL_REWARDS`), and crossing a title threshold unlocks and
  auto-equips a title (`user_titles`, `player_profiles.equipped_title_id`; first grant also
  backfills titles for existing players, level rewards are NOT retroactive).
- **What the app is told:** `grantFame` returns (and stores in `progression_events`) a summary
  `{fame{base,gained,openingNight,hotStreak,capped}, xp/level before+after, rewards, titles,
  rating{before,after,delta,tier*}, goals}`. Online matches push it as the socket event
  `progression:update` (from `persistMatchResult`), bot matches get it in the
  `POST /me/bot-matches/:id/finish` reply (`progression`, which includes the `goals` the
  match moved and the Tour update). Celebrations (level up / new title) that the player missed are
  replayed from `GET /me/progression/unseen` until `POST /me/progression/:id/seen`.
  `queue:matched` opponents carry `rating` and `title` for the match header.
- Pass-and-play ('local') no longer pays or counts; `persistMatchResult` skips the flat chip
  reward for wagered matches, as before. The daily-progress rows live in `daily_progress`.

## The Tour (campaign) and verified bot matches

**The Tour** is six chapters (one per venue). Each has 5 *gigs* (goals any match can move:
win as Black, capture 10 in a win, play 3 online games, reach rating 1300, ...) and a *boss
bot*; beating the boss completes the chapter, unlocks the next one, pays a bigger reward and
a chapter title. Chapter 6 is "The Encore": beat all five bosses in a row (any boss loss
resets it). Finishing all 5 gigs of a chapter adds a "perfect" gem bonus. Everything (gig
text, targets, rewards, titles, the bot roster) is in `economy.config.json` (`tour`, `bots`);
`src/tour.ts` is the pure rule set (`gigDelta`), `src/db/tour.ts` persists and pays it
(`applyTour`, one transaction per event, advisory-locked per player, every row completes
once). Gigs only progress in chapters the player has unlocked. It reads **verified** events
only: online matches (from the authoritative PGN in `persistMatchResult`), bot matches
(below) and puzzle reports. `GET /me/tour` is the read model; the update also rides in the
Show Report (`progression.tour`).

**Bot matches are server-issued** (`src/db/botSessions.ts`): `POST /me/bot-matches {botId,
color}` creates a session, `POST /me/bot-matches/:id/finish {pgn, endedBy}` claims it
atomically, replays the PGN with chess.js (`src/matchAnalysis.ts`; an illegal move rejects
it), reads the result from the position (a win must be a real checkmate; only a *loss* is
believed on a claim), requires at least 6 plies and a plausible duration, then pays chips,
Fame, quests, achievements and the Tour from those verified facts. This replaced
`POST /me/match-reward` and `POST /me/quests/report-match`, which anyone signed in could call
in a loop. It cannot prove the opponent was really the engine, so bot rewards stay modest
and rating/wagers stay online-only. Puzzle reports (`/me/quests/report-puzzle-solved`)
are still client-reported (minimum 4 s between reports).

**Weekly quests ("Tour Dates")**: three quests (win 10, play 5 online, solve 20 puzzles)
that unlock at level 5 and reset Monday 00:00 UTC (`questPeriodStart` in `db/quests.ts`);
`GET /me/quests?type=weekly`. Seed with `npm run seed:quests`. Migration `0015`.

## Wagers (chips at stake on online venues)

Online matches at Club and above (`ECONOMY.venues`, buy-in > 0) are played for chips.
Garage is free, open to guests, and keeps the flat 200/40/0 reward. Friend challenges and
game rooms are unwagered. All the money logic is `src/db/wagers.ts`; the lifecycle:

1. **Entry (`queue:join`, `src/index.ts`)**: guests, a rating under the venue's `minRating`,
   a balance under the buy-in, or an account already seated in a live match are refused with
   a new `queue:error {reason}` (it used to fail silently). One queue entry per socket,
   guest and account (a second device replaces the first, so an account can never be paired
   against itself).
2. **Escrow at pairing, before the match exists** (`startPairedMatch`): `escrowWager` debits
   BOTH buy-ins and inserts the `wagers` row in one transaction (conditional
   `chips >= buyIn` UPDATE; either side short rolls back both). A dead socket or a
   now-short balance puts the other player back in the queue instead.
3. **One ending path**: every way a match ends (mate/draw rules, resign, agreed draw, flag
   fall, forfeit, server restart) goes through `finishMatch` in `index.ts`: broadcast,
   `endMatchClean` synchronously (first ending wins), then `settleWager` (retried), then a
   per-player `wager:settled` event, then `persistMatchResult`.
4. **Settlement** is idempotent (the `held` -> `settled`/`refunded` flip is conditional) and
   conserves chips: winner gets `prize` (1.8x buy-in), `rake` (10% of the pot) leaves the
   economy, a draw refunds both. **Void rule:** a resignation, agreed draw or disconnect
   forfeit before 6 plies (3 moves each) refunds both and leaves no rating, XP or history
   row; checkmate and flag-fall always settle. Wagered wins pay NO flat chip reward
   (`persistMatchResult` `wagered` option), only XP and rating.
5. **Recovery**: SIGTERM (a normal deploy) ends live wagered matches as refunded draws
   (`reason: 'serverRestart'`) and waits for the refunds to commit; a sweeper every 2 min
   refunds any wager still `held` 35 min after it started and owned by no live match
   (hard crash / failed settlement). Account deletion nulls a seat on the `wagers` row
   (`ON DELETE SET NULL`) rather than erasing the opponent's record.
6. **Seats** of a wagered match are authorized by the authenticated `userId` as well as
   the client's `guestId` (`seatColor` in `match.ts`).

`queue:matched` now carries `venueTier`, `buyIn`, `prize`; `match_participants.chips_delta`
and `matches.venue_tier` are recorded and returned by `GET /me/matches`. Known gaps (Phase
3): checkmate/timeout under 6 plies still settle, so colluding accounts can move chips
slowly; no per-pair limits.

## Ads (AdMob rewarded ads + Remove Ads)

Rewards for rewarded ads are decided here, never by the client. `src/adRewards.ts` holds
the placements, daily caps (UTC day) and reward sizes (`free-chips` 60 chips x3/day,
`extra-spin` 1/day, `daily-double` 1/day — a day's free chips stays under one online
win). Every reward path calls `redeemAdReward` (`src/db/adEvents.ts`) *inside its own
transaction* — `POST /me/ads/redeem` (free chips), `POST /me/spin {withAd}` and
`POST /me/daily-bonus/claim {doubleWithAd}` — so a failed reward never costs the ad. A
per-user/placement advisory lock makes the cap race-free. `GET /me/ads/status` is display
state only.

**Test phase vs. real:** `ADS_REQUIRE_SSV` (env, default off) decides what proves an ad
was watched. Off (test ad units): the client's "finished" report is trusted but capped.
On (once real ad units + the callback URL exist in AdMob): a reward is only redeemable
against a row inserted by Google's signed server-side-verification callback
`GET /ads/ssv` (`src/adsSsv.ts` verifies the ECDSA signature against Google's published
keys; the ad's `user_id` is our player id). Whether *test* ads trigger the callback is
unverified — confirm when switching on.

**Remove Ads** is an entitlement, not a pack: `ENTITLEMENT_PRODUCTS` in
`src/iapCatalog.ts` (`remove_ads`, $4.99). `POST /me/purchases/verify` verifies it with
the Play API, records a `purchases` row (`entitlement` set, currency/amount null),
sets `player_profiles.ads_removed` and **acknowledges only** (`acknowledgePurchase`) —
consuming it would let Play sell it again. A purchase token already recorded for another
account is refused (`purchase-belongs-to-another-account`). `ads_removed` is not in
`PATCH /me/profile`'s whitelist. Migration `0011` adds `ad_events`, `ads_removed` and the
`purchases` changes.

## Local development vs. production

Postgres 16 runs locally on this machine as a system service (not Docker --
none installed) on the default port; a dedicated `rockstyle_dev` role +
`rockstyle_chess_dev` database were created once for this project
(`CREATE ROLE rockstyle_dev LOGIN PASSWORD '...' CREATEDB;` /
`CREATE DATABASE rockstyle_chess_dev OWNER rockstyle_dev;`, run once via
`psql`). Plain `.env` points `DATABASE_URL` at that local database -- this
is what `npm run dev`, `npm run db:migrate`, and `npm run seed:*` all use
by default, so ordinary day-to-day development (including running
migrations while iterating on a schema change) never touches the real data.

`.env.production` (gitignored, never committed -- see root `.gitignore`)
holds the actual Neon `DATABASE_URL` and exists *only* so the `:remote`
npm scripts can point at it deliberately:

```bash
npm run db:migrate:remote      # applies the same migration to the real Neon DB
npm run seed:spin:remote       # re-seeds spin prizes on production
npm run seed:cosmetics:remote  # re-seeds board/piece cosmetics on production
```

These set `ENV_FILE=.env.production` (read by both `drizzle.config.ts` and
`src/env.ts`) instead of touching `.env` itself -- there's no file-swapping
step, and `npm run dev` always still targets the local database no matter
which `:remote` script you last ran. The workflow this enables end to end:
develop and test against the local DB, run `db:generate` + `db:migrate`
locally until a schema change is right, then once it's approved run the
matching `:remote` command(s) against Neon, and `git push` (Railway
auto-deploys from the repo, see below) to ship the code that depends on it.
Railway's own running service never reads `.env.production` or any local
file -- its `DATABASE_URL` is a service variable set directly in Railway's
dashboard, same as today.

## Protocol

Client -> Server:
- `queue:join { guestId, displayName, venueTier }`
- `queue:leave`
- `room:create { guestId, displayName }`
- `room:join { guestId, displayName, code }`
- `room:cancel`
- `move:make { matchId, from, to, promotion? }`
- `match:resign { matchId }`
- `draw:offer { matchId }` -- one outstanding offer per match; cleared by any move
- `draw:respond { matchId, accept }` -- only the player who didn't offer can answer
- `match:rejoin { matchId, guestId }` -- the client re-emits this on every
  Socket.IO auto-reconnect while a match screen is mounted; the server replies
  with a fresh `queue:matched` (position + live clocks) and clears any pending
  forfeit timer.
- `match:chat:send { matchId, text }`
- `friend:challenge { guestId, toUserId, duration }` -- authed only
- `friend:challenge:respond { guestId, challengeId, accept }` -- authed only
- `friend:challenge:cancel { challengeId }` -- authed only
- `dm:send { toUserId, text }` -- authed only; persisted, friends-only

Server -> Client:
- `queue:matched { matchId, color, opponent: { userId, displayName, avatarId }, fen, clocks, incrementMs }` --
  emitted for a tier-queue pairing, a room-code pairing, a friend challenge,
  or a rejoin alike (see `gameRoom.ts` below); the client doesn't need to
  know which path produced it.
- `room:created { code }`
- `room:error { reason: 'not-found' | 'own-room' }`
- `move:applied { from, to, promotion, fen, turn, isGameOver, clocks }`
- `move:rejected { reason, fen, turn }` -- to the mover only; `fen`/`turn` are
  the server's authoritative position so a desynced client can snap back to it
  rather than dead-ending.
- `match:opponentDisconnected { color }`
- `match:opponentReconnected { color }`
- `match:ended { result }` -- resignation / forfeit / timeout / **draw**
  (`{ type: 'draw', winner: null }`, with an optional `reason:
  'insufficientVsTimeout'` for a flag-fall the flagging side can't lose under
  FIDE 6.9 because the opponent has no mating material). Checkmate / stalemate /
  *natural* draw (repetition, 50-move, insufficient material) are still derived
  independently by both clients from the move itself (`move:applied`'s
  `isGameOver`) -- only a draw a move can't imply is broadcast.
- `draw:offered { color }` -- the opponent offered a draw
- `draw:declined {}` -- the opponent declined your offer
- `draw:cleared {}` -- a pending offer was voided by a move
- `match:chat:message { color, displayName, text, sentAt }`
- `friend:presence { userId, status: 'online' | 'offline' }` -- to a user's
  accepted friends, on their first socket connecting / last one leaving
- `friend:request { friend }` / `friend:request:accepted { friend }` /
  `friend:request:withdrawn { userId }` / `friend:removed { userId }` -- so a
  friend list updates live without a refetch (also refetched on screen mount)
- `friend:challenge:incoming { challengeId, from, duration, expiresInMs }`
- `friend:challenge:sent { challengeId, toUserId, duration }` (to challenger)
- `friend:challenge:declined | :expired | :cancelled { challengeId }`
- `friend:challenge:error { reason: 'offline' | 'not-friends' | 'expired' | 'challenger-left' }`
- `dm:message { id, conversationId, fromUserId, toUserId, text, sentAt }` --
  to the recipient and echoed to the sender's own other devices

**Friends / DMs / challenges** (`db/friends.ts`, `db/directMessages.ts`,
`realtime.ts`, `challenge.ts`) are the account-only social layer. Friendships
are stored one row per pair, canonically ordered by UUID. Per-user Socket.IO
targeting is `realtime.ts`'s `emitToUser` (each authed socket joins a
`user:<id>` room); it also holds the presence registry. A **friend challenge**
is a 30s in-memory rendezvous (`challenge.ts`) that bottoms out in the exact
same `createMatch()` + `queue:matched` path as matchmaking and room codes.
**DMs** persist to `messages` / `conversations` (`pair_key` = sorted user id
pair) and deliver live via the socket if the recipient is online, else on
their next `GET /me/conversations`. The REST side (list/history/requests/
accept) is on `authRouter` in `auth.ts`; only sending (`dm:send`) and the
challenge handshake are socket events.

**Game Room** (`gameRoom.ts`) is a second way to pair two players, alongside
the venue-tier queue above -- one player calls `room:create` and gets back
a 6-character code (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` alphabet, excludes
visually ambiguous characters), shares it out-of-band, and the other player
calls `room:join { code }`. Both paths bottom out in the same
`createMatch()` + `queue:matched` broadcast (factored into `index.ts`'s
`notifyMatched` helper) -- everything downstream (moves, resign, chat,
disconnect/reconnect grace) is identical regardless of how the pairing
happened. Unclaimed codes expire after 10 minutes, and a creator
disconnecting before anyone joins releases the code immediately rather than
waiting out the full TTL.

In-match chat (`chat.ts`) is scoped to the two seated players -- `match:chat:send`
is only accepted from a socket that `colorOf` resolves as one of the match's
own seats, mirroring the same guestId-based trust check `move:make`/
`match:resign` already use. Messages are sanitized (trimmed, capped at 200
chars) and rate-limited per socket (8 messages / 10s sliding window), then
broadcast to the whole match room. Deliberately **not persisted** to
Postgres -- like the live match state itself, it's ephemeral realtime data,
not part of the async-vs-realtime split described above.

Every move is re-validated server-side via `chess.js` before being
broadcast -- this is the anti-cheat boundary. The client also validates
locally (for instant UI feedback), but the server never trusts that alone.

## Running locally

```bash
cd server
npm install
npm run dev        # tsx watch src/index.ts, listens on :4000 by default
```

Point the Expo app at it via `EXPO_PUBLIC_SERVER_URL=http://<your-lan-ip>:4000`
(see the root `.env`/`app.config` notes) when testing on a physical device
over Expo Go -- `localhost` from the phone's perspective is the phone itself,
not your dev machine.

This directory is on the same exFAT-formatted drive as the rest of the repo,
which doesn't support the symlinks `npm` normally creates for package
`bin/` entries -- hence `server/.npmrc`'s `bin-links=false`, same fix as the
repo root.

## Deploying the database to Neon

The database lives on [Neon](https://neon.com), not a Railway Postgres
plugin -- Neon's free tier is permanent (not a trial) and covers this app's
usage at its current scale, keeping the whole deploy near Railway's $5/mo
Hobby floor instead of $5-12/mo for compute + DB bundled on Railway.

1. Create a Neon project (or use one already provisioned for this app).
2. Generate a **project-scoped API key** (Project Settings -> API Keys) --
   scoped to just this project, can't create/delete projects or see anything
   else in the account, safe to hand to a collaborator or an agent.
3. `neonctl connection-string` (with `NEON_API_KEY` set to that key) returns
   the Postgres connection string -- this is `DATABASE_URL` below. Neon
   projects come with a default branch + database already provisioned, so
   no separate "create database" step is needed.

## Deploying the server to Railway

Railway supports deploying from a subdirectory of a monorepo:

1. New Railway project, pointed at this git repo.
2. Set the service's **root directory** to `server/`.
3. Build command: `npm run build` (compiles `src/` -> `dist/` via `tsc`).
4. Start command: `npm start` (runs `dist/index.js`).
5. Railway injects `PORT` automatically -- the server already reads
   `process.env.PORT`.
6. Set service variables: `DATABASE_URL` (the Neon connection string above),
   `BETTER_AUTH_SECRET` (a long random string), `BETTER_AUTH_URL` (the
   Railway public URL from step 8, once generated), `WEB_CLIENT_ORIGINS`,
   and `MOBILE_APP_SCHEME` (must match `app.json`'s `"scheme"`).
7. Run `npm run db:migrate:remote` once (with `server/.env.production` set
   to this same Neon `DATABASE_URL` -- see "Local development vs.
   production" above) to create the tables before the first real request
   hits `/auth/signup`. Also run `npm run seed:spin:remote` and
   `npm run seed:cosmetics:remote` once, same target, before the daily spin
   wheel or the Forge shop are used for the first time. Every later schema/
   catalog change follows the same `:remote` pattern once it's been tested
   locally, instead of re-running this step manually.
8. Copy the generated public URL (`https://<app>.up.railway.app`) into the
   client's `EXPO_PUBLIC_SERVER_URL`, using `wss://` for the Socket.IO
   client (Railway terminates TLS at the edge).
