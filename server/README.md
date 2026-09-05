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
granted, used by both match-reward paths (`db/persistMatchResult.ts` for
online matches, `POST /me/match-reward` for bot/local) so `level` can never
drift from what the current `xp` implies. Reward amounts live next to the
chips ones in `matchRewards.ts` (`MATCH_XP_REWARDS`). The curve itself is
mirrored read-only in `src/lib/leveling.ts` on the client (display math
only, no mutation helper) -- keep both files in sync if it changes.

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
- `match:rejoin { matchId, guestId }`
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
- `move:rejected { reason }`
- `match:opponentDisconnected { color }`
- `match:opponentReconnected { color }`
- `match:ended { result }` -- resignation / forfeit / timeout / **agreed draw**
  (`{ type: 'draw', winner: null }`). Checkmate / stalemate / *natural* draw
  (repetition, 50-move, insufficient material) are still derived independently
  by both clients from the move itself (`move:applied`'s `isGameOver`) -- only
  a *negotiated* draw is broadcast, since a move can't imply it.
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
