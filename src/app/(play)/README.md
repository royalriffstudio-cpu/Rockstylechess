# (play) route group

Everything that happens once a player taps a "play" entry point on Home: choosing a
venue, matchmaking, the live match itself, and the game-mode galleries (bots,
tournaments). Grouped together since they're all reachable from Home's bento grid
and form one connected flow, distinct from `(auth)`'s onboarding sequence.

The parentheses make this a *route group* — Expo Router uses the folder to organize
files without adding `/play` to the URL/deep-link path.

- `setup.tsx` — venue ladder + venue detail hero. The venue/stakes ladder itself
  (`src/constants/venues.ts`, shared with the Home lobby's venue picker) is the
  source of `buyIn`/`prize`/`image` per tier; the selected venue's id is forwarded
  to `matchmaking.tsx` as `venueTier`. Home's hero card is now the same picker, so
  its "Play Now" also goes straight to `matchmaking.tsx` — `setup.tsx` stays the
  entry point from the "Iron Duel" tile and the `(tabs)/play.tsx` mode picker. At a venue
  with a buy-in it also offers the optional **Safety Net** (premium up front, a loss pays part of
  the buy-in back; forwarded to `matchmaking.tsx` as `insured=1` and sent as `queue:join
  {insured: true}`) and shows which Backstage Gear is switched on (`useGear`).
- **Time controls:** what the picker shows is what is played. Queues pair only players on the same clock (`server/README.md` -> "Time-control pools"); `setup.tsx` shows "N searching" per clock, and after ~25 s `matchmaking.tsx` offers an opt-in "Also search other time controls".
- `matchmaking.tsx` — joins the companion `server/`'s real matchmaking queue over
  Socket.IO (`queue:join` with the venue tier, `queue:matched` to advance) — no
  longer simulated. Re-joins on every socket `connect` (including automatic
  reconnects) so a network blip while still queued doesn't strand the player.
  Leaving the screen emits `queue:leave`.
- `match.tsx` — the chess board itself, built from `the_match_pro_stage_production_ready`.
  Reads `mode`/`difficulty` (+ optional `color`/`duration`/`venueTier`) route params for
  bot matches, or `mode=online` + `matchId`/`color`/`fen`/`opponentName` +
  server-provided `clockW`/`clockB` (real multiplayer, passed by `matchmaking.tsx`
  once the server pairs an opponent) and passes them into `useChessGame`, which
  routes online moves through `src/lib/socket.ts` instead of applying them
  locally. Mounts `StockfishEngine` when `difficulty` is one of the three Stockfish
  tiers. Bot/local clock time = `DURATION_MS[duration]` (from `src/lib/onlineMatch.ts`)
  when a `duration` param is present, else `DEFAULT_CLOCK_MS` (5 min). `venueTier`
  (falls back to `garage` when absent) resolves to a `Venue` from
  `src/constants/venues.ts` and drives purely atmospheric HUD chrome: a
  `VenueBackdrop` (photo + scrim + accent color wash, `src/components/ui/VenueBackdrop.tsx`)
  behind the board, a venue name/icon badge in the header, and venue-accent-tinted
  borders/glow on the menu button and action bar — intensity scales with the
  venue's ladder position (`getVenueIntensity`), so Garage stays minimal and
  World Tour gets the richest treatment (including an animated shimmer sweep).
  This never touches `ChessBoard`'s own `theme`/`pieceSprites`, which stay
  driven solely by the player's equipped Forge cosmetic regardless of venue.
  When `color=b` (online
  Black seat, or the bots screen's "Play As: Black") `ChessBoard` renders
  `flipped` — a 180° coordinate transform so the local player's pieces sit at
  the bottom, pieces/labels upright — and the player/opponent rows + clocks bind
  to the right side. Bot matches also pass `botColor` (the non-picked side) into
  `useChessGame` so the bot plays the other color and opens the game when it has
  White. Local pass-and-play stays White-oriented.
  Promoting a pawn (any mode) holds the move as `useChessGame`'s `pendingPromotion`
  and shows `PromotionPicker` (`src/components/ui/PromotionPicker.tsx`) — Q/R/B/N in
  the equipped piece set; a non-promotion move never sees it. For online, a
  disconnect auto-reconnect re-emits `match:rejoin` and the position/clocks resync
  from the server's `queue:matched` reply; a rejected move snaps the local board
  back to the FEN carried on `move:rejected`.
  A flag-fall where the side still on the clock has only K / K+N / K+B is scored a
  **draw**, not a win (FIDE 6.9 — `src/lib/chessEndgame.ts`, mirrored server-side);
  repetition / 50-move / insufficient-material draws each show their specific reason
  on the result screen.
  **Board fit.** The board uses `ChessBoard`'s `variant="large"` and bleeds 4px
  into the column's side padding (`BOARD_SIDE_BLEED`), so its outermost files sit
  ~15dp from the screen edge — deliberately not flush, to stay clear of most of
  Android's edge-swipe "back" zone (which would swallow a piece dragged inward
  from the a/h files and surface the resign prompt). Width alone sizes it, so the
  strip between the two player rows (`boardArea`, `flex: 1`) is measured and the
  board is capped to it minus the peek strip and a small gap — before this, a
  short phone (~640dp) pushed the player's own row/clock under the action bar. The
  strip's height never depends on the board inside it, so there is no feedback
  loop; the board stays invisible until that first measurement (no flash at an
  uncapped size), measurements are ignored while the chat sheet is open (its
  keyboard can squeeze the screen), and the cap has a floor (`MIN_BOARD_SIZE`)
  so one odd layout pass can't collapse it.
  **Piece values.** The side ahead on material shows a gold `+N` after its captured
  pieces (P1 N3 B3 R5 Q9, `src/lib/pieceValues.ts`). The lead is measured on the
  live *board*, not from the capture lists, so a promotion counts (pawn to queen is
  +8) like chess.com; it is hidden when level or behind. It sits inside the tray
  row, which is already a fixed height, so it can't move the board; if the tray is
  overlong the pieces clip, never the number. The result screen gets
  `myPoints`/`oppPoints` (total value each side captured) as route params and shows
  "Captured N pts · Lost M pts" when they are present.
  **Captured pieces** are the real piece-set sprites on a grey chip under the
  player's name (where chess.com puts them), repeats stacked tighter than a change
  of piece type. The slot is *always* rendered at its full height, even empty: if
  it only appeared with the first capture, the row would grow then and the board
  would jump (and, when height-capped, resize) mid-game.
- `tour.tsx` — **The Tour** (campaign): one painted road (`assets/progression/map`) with a
  badge at each chapter's stop (`TOUR_MAP_NODES` in `src/constants/emblems.ts`, measured from
  the markers painted into the art); tapping a stop shows its five gigs and boss bot below; everything shown is the server's `GET /me/tour` (`useTour`, refetched on
  focus). "Challenge" starts an ordinary bot match against the boss (`botId` param); the
  server recognises the boss when the finished game is verified. World Tour is the Encore
  gauntlet (five bosses in a row). Bot matches now start a **server-issued session**
  (`match.tsx` → `POST /me/bot-matches`) and finish by submitting the PGN; guests and
  failed calls simply play unrewarded (the result screen says why). Once a boss has beaten you
  for real (`backstage` in the Tour payload) the boss card shows **Crowd Energy**; after 2 real
  losses it offers the optional **Roadie Kit** (Take Two + Roadie's Tip for one boss game, bought
  with chips or free from the crowd). The Tour screen buys it itself (`startBotMatch(..., kit)`)
  and hands the session to `match.tsx` (`sessionId`, `kitTakeTwos`, `kitTips` params), which shows
  the two kit pills in the action bar in place of Chat. See `server/README.md` -> "Backstage".
- `festival.tsx` — **Festival Run**: three tier cards (Open Mic / Main Set / Headliner) showing
  entry, the bot ladder with the purse under each set, unlock text (a Tour boss), runs today
  and the repeat surcharge; an "active run" card above them (play the next set, cash out, or
  rejoin a live one). Everything is the server's `GET /me/festival` (`useFestival`). Entering
  pays the entry and drops straight into set 1. A set is an *online* match (`mode=online`,
  extra `festival` JSON param) against a bot the **server** plays, so `match.tsx` shows the
  bot's portrait and `SET k/N · WIN BANKS n` pills, hides the bot's timer, chat and draw, and
  its resign copy warns the run ends. After the set, `result-placeholder.tsx` renders
  `src/components/festival/FestivalSetPanel` (the Set Break: bank the purse or play the next
  set) from the cached `festival:update` (`src/lib/festival.ts`).
- **Rematch** (`result-placeholder.tsx`): the result screen's first button. Bot games start the same bot again
  with the colours swapped and the same time control (`match.tsx` forwards `rematchBot`, a fresh verified session
  opens in `/match`; not offered after a Roadie Kit game or a Festival set, and with no interstitial). Online games
  (friend/room, Garage, wagered venues) use `components/match/RematchPanel` + `hooks/useRematch` against the server's
  rematch window (`server/README.md` -> "Rematch"): one player offers, the other accepts or declines, colours swap,
  a wagered rematch re-escrows the stake (each player's Safety Net choice carries over) and is disabled with a
  reason when chips or rating fall short.
- **Push primer** (`result-placeholder.tsx` -> `components/match/PushPrimer.tsx`): under the buttons, once per install, a signed-in
  player with undecided notification permission is offered "Turn on notifications" / "Not now". Either answer retires it.
- **Show Report** (`result-placeholder.tsx` + `src/components/progression/ShowReport.tsx`):
  after every match the result card shows the server's progression report instead of the old
  hardcoded "710 -> 726": Fame earned (with Opening Night / Hot Streak / daily-cap pills), the
  level bar visibly filling (and wrapping on a level-up), the REAL rating change and tier,
  the daily goals the match moved, and the next goal. Online reports arrive as the socket
  event `progression:update` (cached in `src/lib/progression.ts`), bot reports from the
  `/me/match-reward` reply; the match header's rank lines are real (title + rating, bot
  strength label). Level up / new title take over the screen via the global
  `ProgressionOverlay` (mounted in `_layout.tsx`), 2.8 s after the report on this route and
  never during `/match` or `/puzzle-match`.
- **Wagers:** `home.tsx` and `setup.tsx` share `useVenueEntry` (`src/hooks/`): locked venues
  explain themselves (sign in / rating / chips) and "Play Now" on a venue with a buy-in asks
  for confirmation first; the default venue is Garage. `matchmaking.tsx` handles the server's
  `queue:error` (its own error state) and forwards the venue/stake the *server* matched
  (`queue:matched` carries `venueTier`, `buyIn`, `prize`). `match.tsx` shows a "WIN N" pill
  next to the venue pill in the header row (replacing the wordmark, so the fixed player-row
  heights and board sizing are untouched). `result-placeholder.tsx` shows the server's
  `wager:settled` (cached by `src/lib/wagerResult.ts`) as a signed net, "Settling…" until it
  arrives, and "No Contest" for a voided early exit. Rules: `server/README.md` → "Wagers".
- `result-placeholder.tsx` — the real post-match result screen (the name is
  historical): outcome banner + reason, rewards, Show Report, wager settlement,
  Rematch, Replay / Analyze Game and Home. Its single exit (`goHome`, used by the Home button *and* hardware
  back) is where the post-match **interstitial ad** may appear — every 3rd finished
  match, never the first two, min 4 minutes apart, only if an ad is already loaded,
  and never for a Remove Ads buyer. Navigation always follows whether or not an ad
  showed. (`puzzle-match.tsx`'s "Next Puzzle" does the same every 5th solve.)
  No ads ever appear on `/match`, `/puzzle-match` or `/matchmaking`.
- `bots.tsx` — AI opponent gallery, built from `bots_pro_stage_animated`. Each
  bot has a fixed `difficulty` (`src/lib/botEngine.ts`'s `BotDifficulty`):
  Roadie Rick=easy (1-ply heuristic), Valkyrie Riff/Old School Roy=medium
  (heuristic minimax, iteratively deepened up to 3-ply), Metal Head=
  stockfish-basic (~1600 Elo), The Reaper=stockfish-lite (~2000 Elo), King
  Axl=stockfish-strong (~2800 Elo) — forwarded to `/match` as a route param.
  A "Match Options" row below the intro opens `MatchOptionsModal`
  (`src/components/ui/MatchOptionsModal.tsx`) to pick a **side** ("Play As"
  White/Black — the bot takes the other side and the board flips for Black), a
  **time control** (3m/5m/10m — drives the match clock) and a **venue**
  (recorded + passed as `venueTier` — see `match.tsx`'s entry above for its
  in-match atmosphere effect); the row also shows
  the current `color · duration · venue` selection. All ride along on the
  `/match` push; session state only, resets to White / `5m` / `arena` on each
  visit.
- `tournaments.tsx` — built from `tournaments_pro_stage_animated`. Honestly
  "Coming Soon": no brackets, scheduling or prizes exist; actions show a notice.
- `game-room.tsx` — private room: create a room and share its 6-character code
  (copy to clipboard), or join by code (`room:*` socket events, server
  `server/src/gameRoom.ts`). Pairing ends in the same `queue:matched` as
  matchmaking, so `/match` is identical. Rooms are always 5m and **friendly**
  (unrated, no rewards; `server/README.md` -> "Friendly matches").
- `replay.tsx` — move-by-move replay with transport controls. Sources: a just-finished
  bot/local/online game (`localMatchReplayStore.ts`) or a saved online match
  (`getMatchReplay`, from Iron ID's match history). Reached with `mode=analysis` only
  from the paid "Analyze Game" entry point on the result screen, which adds the
  Stockfish analysis (eval bar, move-quality labels, accuracy). It cannot explore
  side lines (no board input), despite the Play tab's "explore lines" copy.
- `puzzles.tsx` — puzzle training hub over `src/lib/puzzleCatalog.ts` (~250
  puzzles curated by `scripts/curate-puzzles.mjs` from the Lichess CC0 DB, no
  title/difficulty fields). All presentation metadata — friendly titles,
  motif icons, humanized theme labels, the 5 difficulty tiers, the tactic
  filters — is derived in `src/lib/puzzleMeta.ts`. A difficulty segmented
  control + tactic filter chips narrow the (still virtualized `SectionList`,
  re-grouped into the raw 200-point bands) list; a progress strip shows
  `N / total solved` and a "Continue Training" button jumps to the next
  unsolved puzzle in the tier. Solved state is local-only
  (`src/lib/puzzleProgress.ts`, AsyncStorage + a `useSyncExternalStore` hook —
  no server). Each row forwards its `id` (plus the current `tier`/`tacticId`)
  to `/puzzle-match`.
- `puzzle-match.tsx` — single-player puzzle solving, a dedicated screen rather
  than a `match.tsx` mode (no opponent identity/Resign/Draw/Chat concepts apply,
  and puzzle completion never reaches `match.tsx`'s `handleGameOver`/
  `result-placeholder.tsx` routing). Uses `useChessGame`'s `mode: 'puzzle'`,
  which auto-plays the puzzle's setup move, validates each solver move against
  the expected solution, and auto-plays any scripted opponent replies in
  between. On a solve it records the id via `markPuzzleSolved`
  (`puzzleProgress.ts`) and still fires `reportPuzzleSolvedForQuests` for the
  daily quest; the solved-state action row offers "Next Puzzle"
  (`nextPuzzle(...)`, `router.replace` to keep the stack flat). Server
  persistence of puzzle attempts still does not exist. "Give Up"
  (`revealSolution`) plays the rest of the solution out move-by-move into a
  terminal `'revealed'` status — no interaction, and it never records a solve;
  the action row then offers Retry / Next Puzzle. "Hint" (`revealHint`) just
  selects the piece to move (never a move attempt).
