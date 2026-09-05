# components/

Shared, reusable UI building blocks — not full screens.

- `ui/` — design-system primitives every screen pulls from `@/constants/theme`
  instead of hardcoding colors/fonts: `RockButton`, `RockCard`, `CurrencyPill`,
  `PlayerAvatar`, `SectionLabel`, `ProgressBar`, `BottomNav`, `ChessBoard`.
  Import from `@/components/ui`.
- `layout/` — headers, modal chrome (not built yet — `BottomNav` lives in
  `ui/` since it's a reusable primitive on its own, not page layout)
- `StockfishEngine.tsx` — headless, no themed visual surface, so it lives
  directly in `components/` rather than `ui/`. Hosts the Stockfish WASM
  engine (see `src/lib/stockfishProtocol.ts`) inside a hidden WebView for
  the two Stockfish-tier bots. Mounted by `(play)/match.tsx`.

## ChessBoard

Lives in `ui/` rather than a `chess/` folder — it's a self-contained primitive
used by both Match (interactive) and Front Row (static spectate). Omit
`onSquarePress` and it renders read-only.

Three things about it are easy to break:

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
