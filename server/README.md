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

**Auth is self-hosted with better-auth** (`src/betterAuth.ts`): Drizzle
adapter over the `schema/auth.ts` tables, email + password (min 8 chars,
sign-in/sign-up rate limited to 5/min), the `bearer()` plugin so the app can
send `Authorization: Bearer <session token>`, and the `expo()` plugin. It is
mounted at `/api/auth/*` (e.g. `POST /api/auth/sign-up/email`,
`POST /api/auth/sign-in/email`); the app calls it through
`src/lib/authClient.ts`. A `databaseHooks` user-create hook creates the
`player_profiles` row and its friend code. Sessions are verified by
`authMiddleware.ts` for both REST (`requireAuth`) and Socket.IO connections
(`socketAuth`, via `socket.handshake.auth.token`). **Google sign-in** is a second route in
(`socialProviders.google`, present only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; the app signs in natively and posts a Google ID token to `/sign-in/social` (audience = the Web client ID);
the browser flow with redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google`, `/sign-in/social` limited to 10/min): same
`users`/`account` tables (no migration), same create hook, same bearer session. Existing email/password users are
deliberately not auto-linked (better-auth refuses while their email is unverified); a signed-in user links Google
through `/link-social`. `GET /me/profile` also returns `email` and `signInMethods` for Account Security. Email verification and password reset are described in "Email verification" below. A socket
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
welcome bonus 4,000 (one Common); analysis 200 chips or 5 gems (or 10 at once, see "Review Packs" below). After a price change
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

**Backstage: Crowd Energy and the Roadie Kit** (`economy.config.json` -> `tour.backstage`;
`db/tour.ts`: `recordBossLoss`, `claimBossKit`, `refundBossKit`). The help for a player who is
stuck on a chapter boss, built so it cannot be a shortcut and doubles as a chip sink.
- *Crowd Energy* grows with every **real** loss to a chapter's boss (`tour_boss_attempts.losses`,
  counted in `applyTour`; a loss only counts past `minAttemptPlies` = 20 plies, so resigning early
  earns nothing). It is free and cannot be bought.
- After `kitUnlockLosses` (2) real losses the **Roadie Kit** can be bought: price =
  `kitPriceFraction` (12%) of that boss's chip reward, to the nearest 10 (60 / 120 / 180 / 300 /
  480 / 960). Every `crowdFreeEvery` (4) losses the crowd hands over one **free** kit, so a
  broke-but-persistent player is never locked out.
- The kit = **Take Two** (rewind your last turn; the clock keeps running) + **Roadie's Tip**
  (selects the piece worth moving, not where; a medium-strength search, not the best move).
  Both live on the device (`useChessGame` `takeBack` / `suggestTip`, buttons in `match.tsx`); the
  server only sells the kit and records it on the bot session (`bot_sessions.kit_paid`).
- It buys help, never the win: the game must still be played and is verified like any other
  (`finishBotSession`); a kit game **advances no gigs** (`assisted` on the Tour event); a kit
  cannot be bought once the boss is beaten (so it can't be used to farm Fame/chips); a kit game
  that can't be verified (too short, illegal PGN) or whose session is evicted/expired is
  **refunded**.
- Purchase: `POST /me/bot-matches {botId, color, kit: true}` takes the chips (or the free kit)
  and opens the session in ONE transaction (`startBotSession` -> `claimBossKit`); it answers
  `kit-locked` / `not-a-boss` / `insufficient-chips` otherwise. `GET /me/tour` carries
  `chapters[].backstage` (losses, kitOpen, price, freeKit, ...) and the Show Report carries
  `tour.bossAttempt` after a real boss loss. Migration `0017`.
- Tuning is in `check-economy.mjs` (kit is 5-15% of its boss reward, opens before the free one,
  small contents); re-run `gen-economy.mjs` + `check-economy.mjs` after editing the config.

**Weekly quests ("Tour Dates")**: three quests (win 10, play 5 online, solve 20 puzzles)
that unlock at level 5 and reset Monday 00:00 UTC (`questPeriodStart` in `db/quests.ts`);
`GET /me/quests?type=weekly`. Seed with `npm run seed:quests`. Migration `0015`.

## Time-control pools (matchmaking)

The picker's time control is the one that is played. `matchmaking.ts` keeps one FIFO queue per venue, but a
pairing is only made between players who picked the SAME time control (the longest-waiting match on the same
clock is always preferred), so a player who picks 3m is never put into a 10m game. Thin pools are handled by
an opt-in, never by default: after ~25 s the search screen offers "Also search other time controls" (`queue:widen`;
`queue:join {widen: true}` on a reconnect); a widened player (`QueuedPlayer.flex`) accepts anyone, and the game is
played at the clock the OTHER, non-widened player picked (`agreedDuration`). `startPairedMatch` takes the
agreed clock in `opts.duration`. `GET /queue/stats?venueTier=` (public, display only) returns the number
waiting per time control; Match Setup shows "N searching" under each clock and refreshes it every 6 s. Friend
challenges carry their own chosen clock; private rooms are always 5m; bot and local games use the client clock.

## Public player profiles

`GET /users/:userId/profile` (`db/publicProfile.ts`, sign-in required): name, avatar, country, rating and tier,
level, title, record and win rate, online presence, your relation (self / friends / outgoing / incoming /
none) and your head-to-head over every finished online game between you (rated, wagered or friendly). Public
fields only: no chips, gems, friend code or e-mail. A blocked pair (either direction), an unknown id and a
malformed id are all a plain 404, so blocking cannot be probed. The app opens it as a sheet
(`components/social/PlayerProfileSheet`): tap the opponent in the match header (look-only, the clock keeps
running), on the result screen, or a row in the Friends list / rankings (podium, ranked rows, friends tab).

## Rematch (play again)

A finished online match is deleted from memory at once, so `src/rematch.ts` keeps a short-lived **rematch window**
(modelled on `challenge.ts`): `snapshotForRematch(match)` is taken synchronously in `finishMatch` (both seats,
venue, stake, `friendly`, `baseMs`, each seat's Safety Net choice) and `openRematch` opens it once any wager is
settled (so winnings are credited before anyone re-escrows), keyed by the finished match id, 45 s TTL. No window for
Festival sets or server-bot matches. Events (`index.ts`, next to `draw:*`): `rematch:offer {matchId}` ->
the other seat gets `rematch:offered {from, buyIn, prize, insured, friendly}`; `rematch:respond {matchId, accept}`
(only the asked player; two simultaneous offers count as an accept); `rematch:cancel`; `rematch:leave` (the player left
the result screen, so nobody waits on them). Replies: `rematch:declined {reason: declined|left}`, `rematch:cancelled`,
`rematch:expired`, `rematch:error {reason: unavailable|opponent-left|already-in-match|insufficient-chips|opponent-short|
rating-too-low|opponent-ineligible|auth-required}`. Seat identity is the guestId, plus the signed-in account for wagered
and friendly matches (`rematchSeatColor`, like `seatColor`). A socket disconnect closes its windows.

On agreement `startRematch` re-checks everything as for a fresh pairing (both sockets live, neither in a live match,
fresh rating/title), swaps the colours (new White = previous Black) and answers both players with the ordinary
`queue:matched`, so the app's `/match` needs no changes: **friendly** and **Garage** matches go straight to `createMatch`
(same base time, same `friendly` flag); **wagered** venues re-check the rating gate and go through `startPairedMatch`
(`opts.whiteFirst`, `opts.rematch`) and the same atomic `escrowWager`, with each player's Safety Net choice carried
over. A refused wagered rematch (`insufficient-chips`, `opponent-short`, ...) charges nobody and does NOT put anyone
back in the matchmaking queue. Bot rematches are client-only (`result-placeholder.tsx` starts the same bot with the
colour swapped; `match.tsx` opens a fresh verified session).

## Friendly matches (friend challenges and private rooms)

A match started from a friend challenge or a room code is created with `friendly: true`
(`createMatch`), announced to the app as `queue:matched.friendly`, and ended through the normal
`finishMatch`. `persistMatchResult` keeps the game for history and replays (participant rows,
rating delta 0, the match-ended notification) and then returns: **no rating, flat chips, Fame,
quests, Tour or achievements**, so two accounts cannot farm each other. The result screen says
"Friendly match - no rating or rewards" and does not wait for a Show Report.

## Backstage Gear (consumables)

Chip sinks that cost nothing in fairness: none of it touches chess strength or rating. Rules and
numbers are in `economy.config.json` -> `gear`; `src/gear.ts` is the pure catalog + Safety Net
terms, `src/db/boosts.ts` the bag (`player_items`: `quantity` in the bag, `charges` left on the
ONE activated copy). Routes: `GET /me/gear`, `POST /me/gear/:itemId/buy`,
`POST /me/gear/:itemId/activate`. Migration `0018`.

- **Amp Boost** (150 chips, bag cap 5): activate it and the next 3 Fame-paying wins add
  +50% of BASE Fame. The bonus is *added to* Opening Night / Hot Streak (never multiplied by them),
  a charge is spent only by a win that actually paid Fame (a loss, or a win with 0 Fame left under
  the daily bot cap, spends nothing), and it is spent inside `grantFame`'s transaction by a
  conditional `charges > 0` UPDATE so two matches ending together can't share a charge. It is
  Fame (level progress) only; `check-economy.mjs` asserts the price stays above the most
  chips-equivalent its extra Fame can ever return in level rewards.
- **Lucky Pick** (100 chips): armed, it forgives ONE loss on a Hot Streak of 3+ (`updateProfileStats`
  in `persistMatchResult.ts`, one transaction, spent only when it saves something). `winStreak`
  (Hot Streak) is kept; `win_run` is the honest consecutive-win count and is what the "N in a row"
  achievements read, so a Lucky Pick can't be used to farm them.
- **Safety Net** (not stocked; an add-on at a wagered venue): `queue:join {insured: true}` adds a
  premium (25% of the buy-in) to that seat's escrow debit, in the same transaction, and a LOSS
  pays 35% of the buy-in back (`wagers.white_/black_premium` + `_cover`, fixed at escrow so a
  config change can't re-price a held wager). A win or a real draw keeps the premium; a voided
  match (left in the first 3 moves) returns it. It is the one place `wagers.ts` pays chips that
  were not in the pot, and is a net sink for any player below a 71% loss rate; a pair of colluding
  accounts always loses (2 x rake + premium > cover). Both are asserted by `check-economy.mjs`.
  An insured player needs buy-in + premium to enter; `queue:error insufficient-chips` carries that
  total. `wager:settled` carries `insurance: {premium, refund} | null`.
- Show Report: `fame.ampBonus / ampWinsLeft / luckyPickSaved`. App: the Shop's **Gear** tab
  (`components/shop/GearPanel.tsx`) and the Safety Net card + active-gear pills on Match Setup.

## Chip-priced extra spins

After the free daily spin (and alongside the one ad spin) a player can buy up to three more spins, at 300,
then 450, then 600 chips (`economy.config.json` -> `spinExtra.prices`; the cap is the number of prices).
`POST /me/spin {withChips: true}` (`db/spin.ts`): refused with `free-spin-available` until the free spin is
used, `paid-spins-used` past the cap, `insufficient-funds` (with the price) when short. The debit, the prize
and the log row (`user_spin_log.paid_chips`, migration `0020`) are ONE transaction behind a per-user advisory
lock, so a failed spin never costs chips and two quick taps can't share a price. **The wheel's expected value
is ~197 chips-equivalent per spin (chips plus gems at 40:1), so every price is far above it** (66% / 44% / 33%
of the price): `check-economy.mjs` fails if any price is not at least 1/0.75 of the EV. The ad spin and the
paid spins are independent. `GET /me/spin/status` carries `paid: {used, cap, nextPrice}`; the Daily Spin screen
shows "Spin again - N chips" under the free/ad buttons. If the wheel table is ever re-seeded with richer
prizes, re-run the checker: it reads the config wheel, which `seed:spin` writes to the DB.

## Out-of-chips refill (rewarded ad)

A player below the CHEAPEST paid buy-in (300, the Club) can enter no paid venue, so the "Not enough chips"
prompt on Home / Match Setup offers "Watch ad · +N chips". It is the `venue-refill` ad placement
(`economy.config.json` -> `ads`, `adRewards.ts` `refillAmount`, `db/venueRefill.ts`,
`POST /me/ads/redeem {placement: 'venue-refill'}`): each ad pays the shortfall to that buy-in, at most 100,
two a day (200, under one online win; `check-economy.mjs` asserts it, and that refill + free-chips ads can
cover the cheapest buy-in from zero). Someone who can already afford the Club gets `refill-not-needed` (and the
ad is not used up), so it is a way back in, not a faucet; a player who wants a pricier venue they are merely
short for is not offered it. One transaction locks the profile, computes the shortfall from the LIVE balance,
redeems the ad (daily cap, and the signed SSV view when `ADS_REQUIRE_SSV`), and credits. No ads on
`/matchmaking` (house rule), so its queue error screen still only offers the shop.

## Review Packs (Game Analysis in bulk)

A single Game Review is still 200 chips or 5 gems (`POST /me/analysis/charge {currency}`). A
**Review Pack** is 10 reviews at once for 1,600 chips or 40 gems (20% off, 160 / 4 each;
`economy.config.json` -> `analysis.pack`), `POST /me/analysis/packs/buy {currency}`. The reviews are
stored as `player_profiles.analysis_credits` (migration `0019`, returned with `GET /me/profile`) and the
Analyze Game button spends one with `currency: 'credit'` (price 0) before any chips/gems; they never
expire, never convert back, and are capped at `maxCredits` (30) so a pack can't be hoarded without
limit. `db/analysisCharge.ts` does both in single conditional UPDATEs (the balance guard AND the cap
guard are in the WHERE), so a double-tap or two devices can neither overspend nor pass the cap, and a
refused purchase (`insufficient-funds` / `stock-full`) charges nothing. `check-economy.mjs` asserts the
discount is real but modest (10-25%), the chip and gem prices keep the 40:1 rate, and the cap leaves
room for more than one pack. App: the Review Pack card on the Shop's Gear tab, and the Analyze Game
prompt on the result screen (uses a stored review first; offers the pack when the player can afford it).

## Festival Run (the repeatable chip sink)

A paid ladder of bot sets: pay an entry, beat the house band one set at a time, and bank the
purse between sets or push on to a stronger bot. Lose a set and the purse is gone; a draw
replays the set once. Tiers, entries, bots, purses, daily caps and titles are all in
`economy.config.json` (`festival`); `src/festival.ts` is the pure rule set and
`src/db/festival.ts` persists and pays it (`festival_runs`, `festival_clears`, migration 0016).

- **The bot runs on the SERVER.** Device-played bot games are verified by replaying the PGN,
  but the server cannot prove the opponent was the engine, so a purse several times the entry
  cannot rest on a client-reported game. In a Festival set the human is one seat of an
  ordinary `MatchState` and the other is a **bot seat** (`match.bot`, `userId: null`); the
  server computes the bot's replies itself (`src/serverBot.ts`: the heuristic bot for
  easy/medium, Stockfish 18 lite WASM for the rest, the same presets as the app). Only the
  human is clocked (15 minutes a set). Move validation, reconnect grace, resign, flag-fall
  and `finishMatch` are the online match code, unchanged.
  `scripts/gen-server-bots.mjs` copies the app's `heuristicBot.ts`, the Stockfish presets and
  the lite-single engine files (`server/vendor/stockfish`, GPL, with its licence) so the two
  cannot drift; re-run it after editing the app's bots.
- **Money.** The entry is debited in the transaction that inserts the run (conditional
  `chips >= fee`; one active run per player via a partial unique index; the player's profile
  row is locked so concurrent taps cannot double-enter). Every payout sits behind a locked,
  conditional status flip out of `active` (`settleSet`, `cashOut`, `resolveInterrupted`), so
  retries and races pay once. A set win pays no chips by itself; the purse is the only
  payout. Flat bot chips are skipped for set matches; Fame, daily goals, achievements and the
  Tour still count through `applyVerifiedBotResult` (shared with `finishBotSession`), and a
  boss beaten in a set counts as beating that boss.
- **Faults.** `SIGTERM` ends live sets through `finishMatch(forceRefund)`, which calls
  `resolveInterrupted`: a run that had banked something is paid that purse, one that had not is
  refunded. The stale sweeper does the same for sets with no live match behind them (30 minutes)
  and runs left between sets for hours (`staleRunMinutes`); `POST /me/festival/runs/:id/recover`
  lets the app resolve a dead set immediately. A disconnect past the 60 s grace, resigning or
  flagging loses the run.
- **Balance.** `scripts/check-economy.mjs` solves the best bank/push-on strategy per tier for
  three ESTIMATED skill profiles (`incomeModel.festivalSkill`) and asserts: Open Mic returns
  0.65-0.90 of the stake to a casual player, Main Set 0.55-0.95 to a good player, Headliner about
  fair to a strong one, nobody above 2.5x anywhere, banking after set 1 never beats the entry, and
  the daily caps (2 / 1 / 1 runs, +50% for a repeat) bound farming. These are estimates, not
  measurements: re-tune from `festival_runs` once there is data.
- **Scale.** The heuristic bot is a synchronous search of up to 450 ms and Stockfish moves are
  serialised through one in-process engine (a promise queue). Fine for low volume; move the
  heuristic search to a worker thread before many runs are played at once.

REST: `GET /me/festival`, `POST /me/festival/:tierId/enter`, `POST /me/festival/runs/:id/cash-out`,
`POST /me/festival/runs/:id/recover`. Socket: client `festival:start-set { guestId, runId }`
(then the usual `queue:matched`, extended with a `festival` block, and `move:*`); server
`festival:update` after every set (`advance | replay | cleared | lost | interrupted`) and
`festival:error { reason }`. Festival matches are never listed for spectating.

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

## Push notifications (Expo Push Service)

Phones that are not looking at the app are reached through the Expo Push Service (no extra dependency: `push.ts`
POSTs to `https://exp.host/--/api/v2/push/send` with Node's `fetch`). The app registers its Expo token on every
launch (`POST /me/push/devices {token, platform, tzOffsetMin}`; `DELETE` on logout; table `push_devices`, token is
the primary key so a shared phone follows whoever is signed in) and keeps four switches per account
(`GET|PUT /me/push/preferences`, table `push_preferences`, no row = all on): `social`, `invites`, `results`, `daily`.

- **One choke point**: `insertNotification` (`db/notifications.ts`) also pushes, mapping `friend_request_*` -> social,
  `friend_challenge_received` -> invites (30 s ttl, it expires with the challenge), `match_ended` -> results. Direct
  messages call `pushDirectMessage` from the `dm:send` handler (sender name + 80-character preview, one push per
  sender/recipient per 30 s, never for blocked pairs).
- **Foreground**: the client emits `app:state {foreground}`; `realtime.ts` tracks foreground sockets per account and
  `pushToUser` sends nothing while one is set. A live socket alone does not count (a backgrounded Android app keeps it).
- **Daily reminder** (`pushScheduler.ts`): every 10 minutes, accounts whose local hour (from the device's
  `tzOffsetMin`) is 17-20, with `daily` on and the daily bonus and/or free spin unclaimed this UTC day, get one push.
  The once-a-day claim is an atomic upsert on `push_preferences.last_daily_push_day`, so several instances cannot
  double-send. Game resets stay on the UTC day; the copy only mentions a streak when claiming today is what keeps it.
- **Dead tokens**: a `DeviceNotRegistered` ticket deletes the token at once; accepted tickets are re-checked as
  receipts ~15 minutes later (in memory, lost on restart, harmless).
- **Env**: `EXPO_PUSH_DISABLED=1` sends nothing, `EXPO_ACCESS_TOKEN` is only for projects with enhanced push security,
  `EXPO_PUSH_URL` / `EXPO_PUSH_RECEIPTS_URL` redirect to a stub for tests. The FCM service-account key is uploaded to
  Expo (Project -> Credentials), never to this server.
- Gotcha fixed along the way: the vendored Stockfish build ran `fetch=null` as a global; `bots/stockfishNode.ts` now
  restores it (it would otherwise have broken every `fetch` in the process, AdMob SSV included).

## Email verification, codes and the soft gate

Email/password sign-up used to store whatever string was typed. Now:

- **Always on** (`emailPolicy.ts`, run from a better-auth `hooks.before` on `/sign-up/email`): syntax and length,
  a typo list for the big providers (`email-typo` + suggestion), the `disposable-email-domains` blocklist,
  and an MX lookup (`email-undeliverable`; DNS trouble fails open). Google sign-ups arrive verified and skip it.
- **Codes** (`EMAIL_GATE=1`; better-auth `emailOTP`, 6 digits, 10 minutes, hashed in `verification`, 5 tries, 5 requests a
  minute per IP, plus our own pacing in `mailer.ts`: one mail per address per minute, 10 a day): the sign-up mails a code,
  `/api/auth/email-otp/verify-email` verifies it, `/email-otp/request-password-reset` + `/reset-password` reset a
  password (sessions revoked). Passwordless sign-in and email change are disabled on purpose. With the flag off every
  `/email-otp/*` route is a 404.
- **Mail** (`mailer.ts`): Resend over `fetch` (`RESEND_API_KEY`, `MAIL_FROM`). On the LOCAL database with no key it prints the
  message to the console; on any other database it never prints and fails loudly instead.
- **Soft gate** (`db/emailGate.ts`, `blockedByEmailGate` in `index.ts`, `requireVerifiedEmail`): a new email/password account that
  has not verified cannot use online matchmaking/rooms, festival, friend requests/challenges, DMs (socket: `account:gate`,
  REST: 403 `email-not-verified`); bots, puzzles, Tour, shop, daily bonus/spin and purchases are never gated. Existing accounts are
  `users.email_grandfathered` (migration 0022 backfill) and Google/test accounts are verified, so none of them is gated. The 4,000-chip
  welcome bonus of a new email account is held (`player_profiles.welcome_bonus_pending`, chips 0) and paid by `grantWelcomeBonus`
  (one conditional UPDATE) when the email is verified; `/me/profile` heals it if the hook ever failed.
- **Local test accounts**: `TEST_EMAIL_DOMAIN` (only in a developer's local `server/.env`) names a fake domain that skips every
  rule above and gets dev chips/gems. `isTestEmail` is always false unless the database is local, so it does nothing in production.
- Deploy order: `db:migrate:remote` (0022) -> server with `EMAIL_GATE` unset -> sending domain + `RESEND_API_KEY` + `MAIL_FROM` -> `EMAIL_GATE=1`.

## Crash reporting (Sentry)

`src/monitoring.ts` initialises `@sentry/node` when `SENTRY_DSN` is set (Railway variable; unset
locally = no-op) and exposes `reportError(err, { area, matchId, tier })`, which always
`console.error`s as well. It is anonymous by policy (`docs/privacy-policy.html` Section 2j): Sentry 11
collects headers, cookies, bodies and user info by default, so `dataCollection` switches all of it off
and `beforeSend` strips anything left. Never put a player id or email in a tag. The Express error handler is
registered (`setupExpressMonitoring`) before the last-resort handler in `index.ts`; the money paths
(settlement, escrow, bot engine, Festival, fame grant, sweepers) call `reportError`; SIGTERM awaits
`flushMonitoring` before exiting. The server is ESM, so there is no auto-instrumentation or tracing, only
errors. Stack traces map to TypeScript through `sourceMap: true` + `node --enable-source-maps` (no upload
needed). Variables: `SENTRY_DSN`, optional `SENTRY_ENVIRONMENT` (default production), optional
`SENTRY_RELEASE` (default `RAILWAY_GIT_COMMIT_SHA`, else `rockstyle-server@<version>`). `@sentry/node` 11
needs Node >= 20.19 or >= 22.12: check the Railway Node version after deploying.

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
- `festival:start-set { guestId, runId }` -- authed only; claims the run's next set and seats the player against the server-run bot (see "Festival Run")
- `friend:challenge { guestId, toUserId, duration }` -- authed only
- `friend:challenge:respond { guestId, challengeId, accept }` -- authed only
- `friend:challenge:cancel { challengeId }` -- authed only
- `app:state { foreground }` -- authed only; lets the server hold back pushes while the app is on screen
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
   and `MOBILE_APP_SCHEME` (must match `app.json`'s `"scheme"`). Optional for push:
   `EXPO_ACCESS_TOKEN` (only with enhanced push security), `EXPO_PUSH_DISABLED`. For "Continue with Google": `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. For email codes: `RESEND_API_KEY`, `MAIL_FROM`, `EMAIL_GATE` (see the root README).
7. Run `npm run db:migrate:remote` once (with `server/.env.production` set
   to this same Neon `DATABASE_URL` -- see "Local development vs.
   production" above) to create the tables before the first real request
   hits `/api/auth/sign-up/email`. Also run `npm run seed:spin:remote`,
   `seed:cosmetics:remote`, `seed:quests:remote` and
   `seed:achievements:remote` once, same target, before the spin wheel, the
   Forge, quests or achievements are used for the first time. Every later schema/
   catalog change follows the same `:remote` pattern once it's been tested
   locally, instead of re-running this step manually.
8. Copy the generated public URL (`https://<app>.up.railway.app`) into the
   client's `EXPO_PUBLIC_SERVER_URL`, using `wss://` for the Socket.IO
   client (Railway terminates TLS at the edge).
