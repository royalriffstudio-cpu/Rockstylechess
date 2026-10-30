# components/

Shared, reusable UI building blocks — not full screens.

- `ui/` — design-system primitives every screen pulls from `@/constants/theme`
  instead of hardcoding colors/fonts: `RockButton`, `RockCard`, `CurrencyPill`,
  `PlayerAvatar`, `SectionLabel`, `ProgressBar`, `BottomNav`, `ChessBoard`,
  `RewardedAdButton` (one rewarded-ad reward: handles guest/sign-in, daily-cap and
  not-ready states and the redeem retry; built on `RockButton`).
  Import from `@/components/ui`.
- `progression/` — the Fame/level moments: `Emblem` (`TitleEmblem` / `TierEmblem`: painted badges from `assets/progression/emblems`, cut out of the generated green-screen originals by `scripts/cutout-green.py`), `ShowReport` (the post-match report card section)
  and `ProgressionOverlay` (global Level Up / New Title celebration, queued from
  `src/lib/progression.ts`, with sound + haptics via `src/lib/celebration.ts`).
- `layout/` — headers, modal chrome (not built yet — `BottomNav` lives in
  `ui/` since it's a reusable primitive on its own, not page layout)
- `StockfishEngine.tsx` — headless, no themed visual surface, so it lives
  directly in `components/` rather than `ui/`. Hosts the Stockfish WASM
  engine (see `src/lib/stockfishProtocol.ts`) inside a hidden WebView for
  the two Stockfish-tier bots. Mounted by `(play)/match.tsx`.

## PlayerAvatar / AvatarClassTabs

`PlayerAvatar`'s `avatarId` prop is the way to draw a real player avatar: it
resolves the image and the class frame (steel / neon / gold, see `DESIGN.md`)
together, so a frame can never disagree with the art. Classes, prices, rarity
bands and rating gates are generated into `src/constants/avatarImages.generated.ts`
and `server/src/avatarCatalog.generated.ts` by `scripts/gen-avatar-catalog.mjs` —
edit the script, not the generated files. `AvatarClassTabs` is the shared
3-tab (owned/total) picker header; a grid never mixes classes.

## ChessBoard

Lives in `ui/` rather than a `chess/` folder — it's a self-contained primitive
used by both Match (interactive) and Front Row (static spectate). Omit
`onSquarePress` and it renders read-only.

Four things about it are easy to break:

- **Two sizes: `variant="default" | "large"`, plus `maxSize`.** The board is
  square and sized from its container's *width*, never its height. `default`
  (98% width, 400 cap, 11px bezel, rivets, 12px glow) is what every screen but
  Match uses, unchanged. `large` is Match's roomier fit: 100% width up to a 440
  cap, a 7px bezel, a 6px glow, and **no rivets** (the slim bezel has no room
  for them). Everything inside the frame — squares, pieces, shadows, drag
  math, animations — is derived from the one measured `squareSize`, so it all
  scales together; only the frame chrome is variant-specific. `maxSize` caps the
  outer side for a caller that knows its vertical room (Match measures the strip
  between the player rows). It is applied as both `maxWidth` *and* `maxHeight`
  on the slot, because a width cap alone isn't guaranteed to keep the
  aspect-ratio-derived height in step on every layout engine.

- **Squares are laid out at an integer pixel size, not `flex: 1`.** Eight flex
  children of a fractional width round independently, so squares end up a pixel
  off their neighbours and the file boundaries drift down the board. The grid is
  floored to a whole number and sized to 8× that; leftover pixels go to the
  frame. The playfield sits in its own exactly-sized box so the drag ghost shares
  its coordinate space.
- **Piece art is vector, not raster.** `assets/pieces/*.svg` (12 files, one
  per piece/color) is the free "Classic Chrome" piece set. An earlier raster
  pipeline (`scripts/extract-pieces.js`, cutting sprites from a photographed
  reference board) is what `assets/reference/README.md` documents and is no
  longer what's live — a first vector attempt off that same reference was
  rejected as too soft, but a second pass off cleaner source renders,
  autotraced with `vtracer` and corrected against `DESIGN.md`'s
  `pieceWhite*`/`pieceBlack*` tones, is what's actually in `assets/pieces/`
  now.
- **Piece sets (piece skins).** `pieceSprites.ts` exports `getPieceSprites(id)`,
  resolving one of several variant sprite maps rather than a single flat
  export. Locked variants (Graphite Tour, Molten Gold, Crimson Reaper — see
  `constants/pieceSets.ts`) live under their own
  `assets/pieces/<variant-id>/` subdirectory, produced by one of two
  one-time authoring scripts (see each catalog entry's comment in
  `pieceSets.ts` for which): `scripts/vectorize-pieces.mjs` traces bespoke
  hand-sourced renders into genuinely new piece geometry (Molten Gold and
  Crimson Reaper are both this — real chess sets of their own, not a
  recolor); `scripts/recolor-pieces.mjs` mixHex-blends the *classic* SVGs'
  existing fills toward an accent (Graphite Tour — transitional, only used
  because bespoke source art doesn't exist for it yet). Nothing recolors or
  regenerates at runtime either way. `pieceSprites.ts` is hand-edited, not
  generated — safe to touch directly.
  `ChessBoard`'s `pieceSprites` prop (parallel to its `theme` prop) is what
  selects which set actually renders.
- **Square colours come from `BoardSquares` per rank**, not one flat pair. Both
  are measured off the reference; see the theme.
- **`flipped` is a coordinate transform, not a `rotate`.** Pass `flipped` (Match
  does, when the local player has Black) and the board renders from Black's side
  with pieces and coordinate labels still upright. Canonical space (row 0 = rank
  8, col 0 = file a) stays the source of truth for every square string; only the
  per-piece shared-value positions and the visual grid order (`flexDirection:
  *-reverse`) are in "display" space, bridged by `flipIndex`/`displayRowCol`.
  Every Reanimated worklet is untouched. `flipped` must be constant for the
  component's lifetime — mounted piece positions are not re-seeded if it changes.
  The per-rank square tint stays screen-fixed (top-lit, matching the frame).

Pieces get their contact shadow from `ChessBoard`, not from the sprite — the
extractor can only strip baked shadows from the pale set, so drawing one shadow
for all twelve is what keeps the lighting uniform. It's two stacked ellipses (a
wide faint pool plus a tighter core) with the piece raised a few percent, which
is what reads as height; a single flat ellipse looks like a decal.

## PromotionPicker

`ui/PromotionPicker.tsx` — the Q/R/B/N chooser shown while `useChessGame` holds a
`pendingPromotion` (a committed pawn move to the last rank, not yet applied).
`ChessBoard` has no game state and can't know a move is a promotion, so the
detection and the held move both live in the hook; `match.tsx` and
`puzzle-match.tsx` render this picker from `game.pendingPromotion` and call
`game.completePromotion(piece)` / `game.cancelPromotion()`. Renders the choices
with the same `pieceSprites` map `ChessBoard` uses.
