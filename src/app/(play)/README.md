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
  entry point from the "Iron Duel" tile and the `(tabs)/play.tsx` mode picker.
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
  locally. Mounts `StockfishEngine` when `difficulty` is one of the two Stockfish
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
- `result-placeholder.tsx` — stub destination for Resign until the real Win/Loss
  screen is built.
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
- `tournaments.tsx` — built from `tournaments_pro_stage_animated`.
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
  persistence of puzzle attempts still does not exist.
