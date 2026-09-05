# RockStyle Chess — UI/UX Overview

This is the companion document to [`DESIGN.md`](DESIGN.md). **DESIGN.md stays the
canonical source for design tokens** (exact hex values, spacing/radius scale, font
tokens) — pulled live from `src/constants/theme.ts`, so it won't drift. This file
covers everything DESIGN.md doesn't: **motion/animation, audio, navigation
structure, the full screen-by-screen UX, the customization system, and the
recurring UX conventions and current implementation state** across the app.

---

## 1. Identity & Aesthetic

RockStyle Chess presents itself as a **rock-concert / casino-game** experience
layered over real chess: chrome-metal surfaces, neon accents (ember/cyan/gold),
deep near-black stage backgrounds, guitar/stage/backstage motifs throughout copy
and iconography ("Rockstar" avatars, "The Forge", "Backstage Alerts", "Roadie
Support", "Grandmaster ID" reframed as "Iron ID"). It's a single fixed **dark
theme** — there is no light mode anywhere in the app.

Built with **React Native (Expo, Router-based navigation)**, styled entirely with
`StyleSheet` + `expo-linear-gradient` (not a web/CSS/Tailwind stack). Motion is
built on `react-native-reanimated` + `react-native-gesture-handler`. Audio runs
on `expo-audio`.

---

## 2. Design System Summary

Full canonical detail lives in [`DESIGN.md`](DESIGN.md). Summary for context:

- **Colors**: warm `ember`/`emberLight` (primary CTA/energy), `gold` (rewards/
  currency), `cyan` (primary interactive/active state), `crimson` (danger).
  Chrome/metal neutrals (`chrome`/`chromeMid`/`chromeDark`) for borders and
  inactive states. Near-black warm backgrounds (`bgBase`/`bgPanel`). No alpha
  tokens — `withOpacity(hex, alpha)` derives translucent variants everywhere.
- **Typography**: 3 fonts only — `Anton` (display/hero), `Oswald` SemiBold
  (headings, buttons, nav — condensed/uppercase-leaning), `Inter` (body/captions).
- **Spacing**: `xs/sm/md/lg/xl` = 4/8/12/16/24. **Radius**: `sm/md/lg/full` =
  8/14/15/999.
- **Depth is never a flat fill.** Every "glossy" shared component (buttons,
  cards, the avatar ring) is a real layered `LinearGradient` stack — base fill,
  top gloss highlight, sometimes an inner glow and a 1px top edge-light line —
  plus a colored `boxShadow` glow keyed to the component's accent. This is a
  hard rule (`CLAUDE.md`'s Component Depth Standard), not a style preference.
- **Component inventory**: `RockButton`, `RockCard`, `CurrencyPill`,
  `PlayerAvatar`, `SectionLabel`, `ProgressBar`, `BottomNav`, `ChessBoard`,
  `ChatPanel`/`ChatToast`, `EmberParticles` — all in `src/components/ui/`,
  imported via `@/components/ui`. See §6 for how they're actually used across
  screens, beyond DESIGN.md's prop-level reference.

---

## 3. Motion & Animation System

DESIGN.md documents zero motion tokens — there is no shared "duration/easing
scale" the way there's a spacing scale. Motion choices live close to where
they're used, per-component. This section is the first place they're
documented together.

### 3.1 The chessboard — the app's most elaborate animation system

`ChessBoard.tsx` (`src/components/ui/ChessBoard.tsx`) renders and animates every
match, puzzle, replay, and cosmetic-preview board in the app. Key mechanics:

- **Persistent piece identity.** Pieces are not re-derived from the board
  string each render. A `LivePiece{id, type, square}` list is reconciled
  incrementally per move (normal move, capture, en passant, castling — both
  king *and* rook, promotion), each piece hosted by exactly one `BoardPiece`
  component for its entire lifetime on the board. Moving a piece animates a
  transform on the same mounted `Image`; it's never unmounted and remounted.
  This also means dragging a piece *is* that same persistent piece following
  the gesture — no separate "ghost" swap.
- **Per-move-kind animation feel** (`ANIMATION_CONFIG`, all `Easing.out(Easing.
  cubic)`): move 360ms, capture 340ms (snappier — reads as landing with force),
  castle 420ms (shared by king+rook, reads as one coordinated gesture), check
  380ms, checkmate 400ms. A local tap-move (no drag) gets a quicker flat 180ms
  settle instead of the full travel duration; a drag gets a spring settle
  (`damping:16, stiffness:220, mass:0.9`) rather than a timed animation.
  Bot/opponent/replay moves get the full travel duration; the player's own
  gesture-driven moves are shortened since their tap/drag already implied
  motion.
- **Landing weight**: a companion `scale` animation dips to ~0.94 mid-travel
  and springs back to 1.0 on arrival — a "squash on landing" layered on top of
  the exact-arrival position tween (not a spring on position itself, which
  risks visibly overshooting into a neighboring square).
- **Captures**: the captured piece becomes a `DyingGhost` that fades, scales
  down (~0.4), and knocks back slightly over 260ms — timed to sit inside the
  capture sound's initial transient — instead of vanishing instantly.
- **Check**: the checked king's square gets a persistent crimson tint
  (`isCheck`), plus a one-shot `CheckPulse` overlay (glow opacity 0.25↔0.7,
  scale up to 1.12) pulsing for ~2s to bracket the check sound cue, triggered
  only on a genuinely new check event (not "check is still active").
- **Checkmate**: a `CheckmateFlourish` — an expanding gold ring, scale 0.3→1.7,
  fading over ~2s — deliberately short relative to the checkmate sound's ~8.8s
  decay; the sound keeps ringing as ambience after the visual settles rather
  than the animation trying to fill its whole length.
- **Promotion**: a scale pulse (1→1.3→1) instead of the normal landing squash.
- **Legal-move affordances**: a glowing cyan dot for plain targets, a hollow
  cyan ring for capturable targets.
- **Drag**: the grabbed piece scales to 2.1× and lifts a full square-height
  above the fingertip so the hand doesn't obscure the destination; on an
  illegal drop or a drop back on the origin square, it springs back home.

### 3.2 Other recurring animation motifs

| Pattern | Where | Mechanic |
|---|---|---|
| **Count-up numbers** | `welcome-reward.tsx` (10M chip reward), `result-placeholder.tsx` (`useCountUp` hook, cubic ease-out) | Animates a currency/number from 0 up to its target over ~1.2–2s rather than appearing instantly. |
| **Pulsing glow/opacity** | `LiveBadge` (front-row.tsx), waiting-opponent avatars (matchmaking.tsx, game-room.tsx), turn-active timer pill glow (match.tsx) | `withRepeat(withSequence/withTiming(...))` opacity (and sometimes scale) oscillation to signal "live"/"waiting"/"active turn". |
| **Horizontal marquee/ticker** | `MoveTicker` (match.tsx, currently decorative/sample data), `ChatTicker` (front-row.tsx spectator comments) | Measures text width via `onLayout`, then `withRepeat(withTiming(-textWidth, {duration, linear}))` to loop continuously leftward. |
| **Floating reaction burst** | front-row.tsx's 5 emoji buttons | Tapping spawns a `FloatingEmoji` at a randomized x-offset that animates `translateY -200`, scale to 1.5, opacity to 0 over 2000ms, self-removing after. |
| **Spin wheel** | spin.tsx | Hand-drawn SVG pie-slice wheel (not an image). Server decides the prize *first*; the client animates the wheel to land on that segment — 4000ms, custom bezier `(0.15,0,0.15,1)`, 5–9 extra full rotations for flourish, rotation accumulator never resets so consecutive spins keep spinning forward instead of snapping to 0. |
| **Ambient particles** | `EmberParticles` — sign-in, sign-up, home, control-core, game-room, tournaments, achievements/collections backdrops, match.tsx, front-row.tsx, spin.tsx | A decorative floating-ember layer establishing the recurring "stage atmosphere" motif; count varies 8–12 per screen. |
| **Press feedback** | `RockButton`, avatar-grid tiles, `ActionButton` in match.tsx | Scale down (0.92–0.97) + shadow shrink on press, spring back on release. |

---

## 4. Audio Integration

- **Sound effects** (`src/lib/soundEffects.ts`): five bundled WAVs — `move`,
  `capture`, `castle`, `check`, `checkmate` — plus `illegal`. Each has its own
  pre-instantiated `expo-audio` `AudioPlayer` (eager, one per cue — chess is
  turn-sequential, so no pooling/overlap handling is needed). `playSound(kind)`
  seeks to 0 then plays, gated by a persisted (`AsyncStorage`) on/off
  preference. All five gameplay files were trimmed, peak-normalized to a
  consistent -1 dBTP, and standardized to 44.1kHz/stereo/16-bit for a coherent
  feel across cues.
- **Move-to-sound classification**: `classifyMoveSound()` (`chessBoardSnapshot.
  ts`) inspects the post-move chess.js state and picks one of
  `move/capture/castle/check/checkmate` by priority (checkmate > check > castle
  > capture > move). This same classification also drives the ChessBoard
  animation config in §3.1 — sound and animation are driven by the same value,
  so they stay conceptually in sync.
- **Background music** (`src/lib/backgroundMusic.ts`): a single ~75s looping
  ambient track, lazily created (not eagerly like the SFX players, since it's
  a much larger file with no reason to pay its load cost before the menu is
  reached), loop-seamed (trimmed/faded so the loop point is inaudible).
- **Menu-music lifecycle**: the root layout starts menu music on every route
  *except* actual gameplay (`/match`, `/puzzle-match`) — checked by exact route,
  not by route group, since `(play)/` also contains non-gameplay lobby/setup
  screens (bots, setup, matchmaking, tournaments, etc.) where menu music should
  keep playing.
- **Settings**: both toggles ("Music" / "Sound FX") live in Control Core
  (`(settings)/control-core.tsx`), each a labeled `Switch` row.

---

## 5. App Structure & Navigation

### 5.1 Routing

Expo Router, file-based, grouped by domain under `src/app/`:
`(auth)`, `(tabs)`, `(play)`, `(rewards)`, `(settings)`, `(shop)`, `(social)`.
Root `_layout.tsx` sets one `Stack` (`headerShown: false`,
`contentStyle.backgroundColor: Colors.bgBase`, **`gestureEnabled: false`**).
There is no `Tabs` navigator — `(tabs)` holds `home.tsx`/`play.tsx`; the bottom
tab *look* is purely the cosmetic `BottomNav` component layered over stack
navigation.

**Back = up the hierarchy, not history-undo.** `src/lib/navigation.ts` holds a
`PARENT` map (every route → its canonical parent, root `/home`) and `goUp()`
(`router.dismissTo(parent)` — pops to the parent if it's in the stack, else
replaces the current screen with it). Every back affordance goes through it:
`SubPageHeader`'s button, the custom-header chevrons (shop / bands / front-row /
puzzle-match), and a single global Android hardware-back handler in
`_layout.tsx`. The iOS swipe-back gesture is disabled app-wide so it can't do a
plain pop. `BottomNav` / `TopAppBar` navigate with `router.dismissTo` (not
`push`) so switching sections doesn't stack. `/match` and `/result-placeholder`
register their own hardware-back handlers (resign prompt / straight-home) — a
started match can only be left via the result screen, Resign, or an agreed
Draw.

### 5.2 Entry / auth flow

```
index.tsx (checks stored auth token)
  ├─ no token  → sign-up ──→ pick-rockstar ──→ welcome-reward ──→ home
  │                  ↕ (link)
  │              sign-in ─────────────────────────────────────→ home
  └─ has token → home directly
```

- Sign-up funnels new accounts through the full onboarding chain (avatar pick →
  celebratory reward). Sign-in (returning players) skips straight to home.
- Logout and Delete Account both clear the stored token + socket auth and
  `router.replace('/sign-up')`, resetting back to the top of this chain.
- `index.tsx` renders nothing (a bare `bgBase` view, no spinner — deemed
  imperceptible) while resolving, then issues a `<Redirect>`.

### 5.3 Screen shell conventions

- **Global**: `SafeAreaProvider` at root; screens pull `useSafeAreaInsets()`
  directly (no wrapper) and fold insets into padding manually. Status bar is
  always `style="light"`.
- **Sub-page header pattern** (used identically across nearly every pushed
  screen — settings, shop, social, most of play/rewards): a 42×42 circular
  back button (chevron-left, translucent panel bg) + centered uppercase
  `Fonts.display` title + a `CurrencyPill` (gems or chips) on the right.
- **Primary-tab screen pattern** (home, iron-id, world-rankings — screens
  reachable via `BottomNav`): a fixed top bar (avatar/identity + currency
  pills) instead of a back button, `EmberParticles` + ambient glow blobs behind
  the content, a scrollable body, and `BottomNav` docked absolutely at the
  bottom.
- **Atmosphere layer**: many screens use a full-bleed remote background image
  (character art, arena/lounge/stage photography) with a `LinearGradient` scrim
  fading to `bgBase`, plus `EmberParticles` on top — see §9 for a caveat on
  these image sources.
- **Bottom nav**: fixed 4 tabs (`home`, `ranks`→world-rankings, `shop`,
  `profile`→iron-id) plus a 5th floating circular "play" button overlapping the
  bar's top edge. `BottomNav` navigates internally (via `router.dismissTo`) —
  callers just pass `activeTab`; `onTabPress` is an optional side-effect hook.

---

## 6. Component Library — Usage Patterns

Beyond DESIGN.md's prop-level reference, here's how the shared components
actually get used across real screens:

- **`RockButton`** — the only interactive CTA primitive app-wide.
  `variant="primary"` (cyan) for main actions, `"reward"` (gold) for
  claim/purchase actions, `"danger"` (crimson) for resign/logout/delete. Label
  swaps to a loading string ("Creating...", "Equipping...", "Spinning…") and
  the button disables itself during any in-flight async action — a consistent
  convention, not screen-specific.
- **`RockCard`** — the universal panel. `glowColor` is used semantically per
  screen (e.g. gold for reward/VIP content, crimson for danger sections, cyan
  for the "selected/primary" card on a screen with several). `backgroundImageUri`
  turns it into a hero photo card with a bottom scrim (venue cards, VIP banner).
- **`PlayerAvatar`** — every player/character portrait in the app, always
  through this component (never an ad hoc circular `Image`). `tiny` size exists
  specifically for the in-match player row where a `small` avatar wouldn't fit.
  `selected` swaps the ring to cyan (avatar-picker, cosmetic previews).
- **`CurrencyPill`** — appears in nearly every screen's header (gems or chips),
  plus inline wherever a price is shown (locked cosmetics, venue buy-ins,
  analysis-charge confirmations).
- **`SectionLabel`** — used inconsistently in practice: some screens use it as
  documented, several others (bands.tsx, tournaments.tsx section headers) hand-
  roll an equivalent-looking label instead of importing the shared component —
  worth normalizing if touching those screens.
- **`ProgressBar`** — XP bars, tournament fill %, quest/achievement progress,
  daily-bonus jackpot progress, and (repurposed) the replay/analysis eval bar
  and Stockfish-analysis progress meter.
- **`BottomNav`** — docked on every primary-tab-reachable screen; `activeTab`
  set per screen. A `dev-preview.tsx` route exists purely to visually catalog
  every shared component (including an interactive `BottomNav`) before wiring
  real screens on top — explicitly marked "safe to delete once approved."

---

## 7. Customization System (Forge / Shop)

Three independent cosmetic catalogs, all equip-and-preview through
`(shop)/forge.tsx`'s 3-tab (Boards / Pieces / Avatars) screen, purchased with
gems or chips (not real money — currency purchases happen separately in
`(shop)/shop.tsx`).

| Catalog | File | Count | Notes |
|---|---|---|---|
| **Board themes** | `src/constants/boardThemes.ts` | 5 | Classic Chrome (free) + Cyan Storm, Gold Rush, Crimson Stage, Obsidian Void. Colors are *derived programmatically* (`deriveSquares`/`mixHex` blending an accent into the base per-rank square arrays), not hand-authored per square. Accents are deliberately duller/"weathered" than the app's neon UI palette — a full board painted in arcade-bright neon reads poorly at board scale. |
| **Piece sets** | `src/constants/pieceSets.ts` | 4 | Classic Chrome (free) + Graphite Tour, Molten Gold, Crimson Reaper. Two art pipelines: bespoke vectorized geometry (real distinct sets — Molten Gold, Crimson Reaper) vs. recolor-derived (Graphite Tour, transitional). `accentColor` here is informational only — actual art is separate SVGs resolved via `pieceSprites.ts`. |
| **Avatars** | `src/constants/avatars.ts` | 12 | AXE 🎸, NOVA ⚡, RIFF 🤘, AXL 🕶️, BLAZE 🔥, BEATS 🥁, MIC DROP 🎤, SYNTH 🎹, REAPER 💀, KING 👑, REBEL ⛓️, LEGEND 🏆 — all currently unlocked/free. Shared by onboarding's avatar-picker and Forge. `id`s are permanent once shipped (persisted as the profile's `avatarId`); `king-axl` was deliberately avoided as an id since it's already a bot character's name. |

**Purchase flow** (Forge): tapping a locked item opens a native `Alert` with
Cancel / pay-in-gems / pay-in-chips options → server call → profile refresh →
the item auto-*selects* but does **not** auto-equip (equip is a separate
deliberate bottom-bar action, one per tab). `insufficient-funds` shows a
dedicated alert; `already-owned` silently re-selects.

Server mirrors of the board/piece catalogs exist at `server/src/boardThemes.ts`
/ `server/src/pieceSets.ts` for equip validation — kept in sync manually, not
generated from one source.

---

## 8. Screen Reference

Every screen's header uses the sub-page pattern from §5.3 unless noted.

### `(auth)` — Onboarding

| Screen | Purpose | Notable UX |
|---|---|---|
| `sign-up.tsx` | New account creation | Full-bleed arena background, `RockCard` form + a separate gold "Welcome Bonus" banner card, stubbed social-login row |
| `sign-in.tsx` | Returning-user login | Same visual scaffold minus the bonus card; success skips onboarding entirely |
| `pick-rockstar.tsx` | Choose avatar persona + stage name | 2-col avatar grid (locked/selected/starter states), non-fatal profile-update (never blocks onboarding on failure) |
| `welcome-reward.tsx` | Celebratory reward screen | Count-up chip animation (0→10M over 2s), no nav chrome — a dead-end celebration screen |

### `(tabs)` — Hub

| Screen | Purpose | Notable UX |
|---|---|---|
| `home.tsx` | Main lobby / mode selection | Venue selector row, hero "Play Now" card, 2-col bento grid to Iron Duel/Tournaments/Bots/Puzzles/Game Room, daily-engagement row (Spin/Daily Bonus/Quests). The one home-adjacent screen reading *live* profile data rather than placeholder copy. |

### `(play)` — Gameplay

| Screen | Purpose | Notable UX |
|---|---|---|
| `bots.tsx` | Pick a bot opponent | 6 named bots with decorative star ratings + a real `BotDifficulty` tier each |
| `game-room.tsx` | Private room create/join | 6-char room code, copy-to-clipboard, pulsing "waiting" state |
| `matchmaking.tsx` | Public queue wait | Pulsing `❓` opponent avatar, re-joins queue on socket reconnect |
| `setup.tsx` | Venue/stakes + duration picker | Horizontal-scroll stakes ladder (Garage→World Tour), selected tile *grows* |
| `match.tsx` | **Core live match screen** | See §3.1/§4 for the full animation+sound system; player rows with captured-piece trays, in-match `ActionBar` (Chat/Hint-stub/Resign/Draw-stub/Menu-stub), 900ms pause before routing to results so the final position is visible |
| `puzzle-match.tsx` | Solve one tactic | Status card reacts to solve state (Find/Solved/Try again), Hint/Give-Up vs. Back/Reset action rows |
| `puzzles.tsx` | Puzzle catalog | Virtualized `SectionList` grouped into rating bands (chosen over `ScrollView`+`.map` after ~4,000 native views became a perf problem) |
| `replay.tsx` | Post-game replay + paid analysis | Transport controls, eval bar, move-quality callouts (best/good/inaccuracy/mistake/blunder — blunder uses a skull icon, a nod to the "Reaper" bot), accuracy verdicts |
| `result-placeholder.tsx` | Win/Loss/Draw summary | Outcome-colored banner + glow, count-up reward chips, conditional Replay/Analyze-Game (paid, via Alert confirmation)/Home actions |
| `tournaments.tsx` | Browse tournaments | Live tournament card w/ fill-progress bar, ticket card, upcoming-events list (mostly stubbed) |

### `(rewards)` — Engagement loops

| Screen | Purpose | Notable UX |
|---|---|---|
| `achievements.tsx` | Badge hall of fame | 3-col badge grid (gold/chrome gradient fills when unlocked), one featured long-form challenge card |
| `collections.tsx` | Collectible character cards | Set-grouped 2-col card grid — the one screen using per-item character portrait images instead of emoji |
| `daily-bonus.tsx` | Daily login streak | Guest-gated; 6-day grid + a distinct Day-7 jackpot card; icon varies by actual reward type (chips/gems/both) |
| `quests.tsx` | Daily/weekly objectives | Claimed quests get strikethrough + cyan title; Weekly tab is a full locked-state placeholder |
| `spin.tsx` | Daily prize wheel | Guest-gated; hand-drawn SVG wheel, server-decided-then-animated-to outcome (see §3.2) |

### `(settings)`

| Screen | Purpose | Notable UX |
|---|---|---|
| `control-core.tsx` | Settings hub | Audio toggles, game-settings list, account summary, Logout (danger) |
| `backstage-alerts.tsx` | Notifications inbox | Accent-colored left border per item, unread/read state with distinct action-pill styling |
| `account-security.tsx` | Linked accounts + deletion | ID-badge-styled profile card (4 decorative corner rivets), real `Alert`-confirmed account deletion |
| `roadie-support.tsx` | Help center | 2×2 category grid (Report a Player flagged in danger styling), contact CTA |

### `(shop)`

| Screen | Purpose | Notable UX |
|---|---|---|
| `shop.tsx` | Currency purchases (Chips/Gems/VIP) | Cosmetics deliberately excluded — a persistent "Forge" entry card routes there instead of a 4th tab; one "HOT" ribbon-badged highlighted pack |
| `forge.tsx` | Cosmetic preview + equip | See §7 |

### `(social)`

| Screen | Purpose | Notable UX |
|---|---|---|
| `iron-id.tsx` | Full player profile (primary tab) | 4-state (guest/loading/error/ready), rating card with ghost trending-icon backdrop, trophy case (flavor-only, no backend), tappable match history → replay |
| `world-rankings.tsx` | Global leaderboard (primary tab) | Podium layout (2nd/1st/3rd visual order, gold pedestal for 1st), only "Global" filter tab implemented |
| `friends.tsx` | Friends list | Status-dot-coded avatars (online/offline/in-game), per-status action (Watch/Challenge/Chat-stub) |
| `front-row.tsx` | Spectate a live match | Pulsing `LiveBadge`, floating emoji reactions, scrolling chat ticker — the most animation-dense screen outside the board itself |
| `bands.tsx` | Guild/clan browser | Entirely mock/flavor — no backend band system exists yet |
| `messages.tsx` | DM inbox + chat thread | Bespoke speech-bubble UI (asymmetric corner radius per sender), local-only send (not persisted) |

---

## 9. Recurring UX Patterns & Conventions

- **Guest-gating**: `daily-bonus.tsx`, `spin.tsx`, and `iron-id.tsx` all check
  a `guest` profile state and swap the whole screen body for a sign-in prompt
  rather than showing empty/fake data to an unauthenticated user.
- **Locked-item treatment**: consistent across venues (setup.tsx), bots
  (bots.tsx), cosmetics (forge.tsx), tournaments, and quests — dim to reduced
  opacity, swap the icon/label to a muted color, overlay a small lock glyph,
  and (where purchasable) show a price pill instead of the normal action.
- **Loading/error/empty states**: iron-id.tsx and replay.tsx both follow the
  same discipline of not blanking already-loaded content on a background
  refresh error — loading/error UI only appears when there's nothing cached
  yet to show instead.
- **In-flight action locking**: buttons that trigger an async call disable
  themselves and swap their label to a present-participle state ("Creating...",
  "Equipping...", "Spinning…") for the duration — applied uniformly rather than
  per-screen.
- **Confirmation via native `Alert`**: destructive or paid actions (delete
  account, Forge purchases, paid game analysis) go through `Alert.alert(...)`
  rather than a custom in-app modal.
- **Stub/placeholder convention**: a large fraction of interactive elements
  across the app (social login, "Link Now", most Support/Tournament/Quest/
  Bands actions, several home bento tiles) are intentionally `console.log`-only
  stubs pending real backend wiring — this is a normal, current-in-progress
  state of the app, not a bug to "fix" reflexively if encountered while working
  on an unrelated screen.
- **Asset provenance caveat**: several screens' background/hero images are live
  Stitch-mockup preview URLs (`lh3.googleusercontent.com/aida-public/...`),
  explicitly commented in-code as having no permanence guarantee — worth
  swapping for bundled assets before shipping those screens for real.

---

## 10. Current Implementation State

For an honest snapshot of what's real vs. decorative as of this writing:

**Fully wired to real backend logic**: auth (sign-up/sign-in/logout/delete),
profile fetch/update, matchmaking + private rooms (sockets), live match play
(all modes: bot/online/local/puzzle), replay + paid Stockfish analysis, daily
bonus claim, daily spin, Forge purchase/equip.

**Presentational / flavor-only (no backend yet)**: Bands, most of Tournaments,
Quests' claim actions, Achievements, Collections, Messages (local-only),
in-match Hint/Draw/Menu buttons, most Settings sub-actions (language, ToS,
social account linking, support categories), the in-match player rating/clock
display (static placeholder numbers, not live), and `MoveTicker`'s move-history
text (a hardcoded sample, not the live game's actual moves).

This split is intentional and documented in-code screen-by-screen — treat it as
a map of "what's real" rather than a todo list to silently start fixing.
