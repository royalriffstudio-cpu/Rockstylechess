# Reference art — chess board & pieces

> **Piece sprites in `assets/pieces/` are no longer generated from this
> pipeline.** They're now hand-picked render PNGs autotraced to SVG (see
> `src/components/README.md`). Running the regeneration command below will
> overwrite `assets/pieces/*.png` and rewrite `pieceSprites.ts` back to the
> old raster set — don't, unless that's actually what you're trying to undo.
> This file is kept for the **square colour** measurement, which is still
> current, and as a record of how the old sprite extractor worked.
>
> Not to be confused with `scripts/rasterize-pieces.mjs`, which renders the
> current SVG sets to `assets/pieces/png/<set>/` as a proposed fix for the
> Android match-screen crash (see `TEMP-match-crash-notes.md`).

`Board.jpeg` is the design render the in-app board is matched against. It is the
source of truth for two things: the **square colours** in `BoardSquares`
(`src/constants/theme.ts`), and, historically, the **piece sprites** in
`assets/pieces/` (see the warning above).

## Regenerating the pieces

```
node scripts/extract-pieces.js assets/reference/Board.jpeg --board 30,305,532,531
```

That writes 12 RGBA PNGs (266×266) into `assets/pieces/` and regenerates
`src/components/ui/pieceSprites.ts`, which `ChessBoard` imports. Nothing else
needs touching.

`--board` is the playfield rect — the 8×8 grid only, no bezel. For `Board.jpeg`
it is `30,305,532,531`, i.e. **66.5px per square**. If the reference is ever
replaced, re-measure it: scan a scanline across an empty rank and read off where
the light/dark runs start and their pitch. The script prints the cell size it
derived, so a wrong rect is obvious immediately.

## Choosing a replacement reference

This matters more than any tuning knob, and we learned it the hard way — an
earlier 294×375 crop cost several rounds of work before it became clear the
source, not the algorithm, was the limit.

1. **All 8 files visible.** Rooks, knights, bishops and pawns then each appear
   twice, so the extractor can cut each from whichever square contrasts more.
   With `Board.jpeg` it takes both knights from g8/g1 rather than being stuck
   with b8/b1. On the old cropped file the black knight scored 43 separation;
   here it scores 194.
2. **As many pixels per square as possible.** A square draws at roughly 150
   physical pixels on a phone. Below ~60px per square the pieces are blurry by
   arithmetic and no keying can recover it.
3. **Squares that contrast with both piece sets.** `Board.jpeg`'s navy-on-ivory
   separates far better than the old grey-on-grey, where a pale piece sat 12
   levels out of 255 from its square and could not be separated at all.

## How the extraction works

Each step exists because something specific broke without it. Full reasoning is
in the header of `scripts/extract-pieces.js`; the short version:

- **Flood fill inward from the cell border**, not a global colour threshold —
  the pale set's highlights *are* the square colour, and only background
  connected to the edge should go.
- **Square colour from the four corner patches**, not the whole border ring. A
  piece nearly fills its cell and touches the edges, dragging a ring median off
  by ~25 levels.
- **Cells ranked by separation measured on the raw crop.** Ranking by extraction
  quality is self-defeating: a piece the fill *ate* leaves a perfectly clean
  border and therefore scores best.
- **Results gated on gross geometry** (tall, centred). A half-eaten piece passes
  every intensity test while looking like a diagonal smear.
- **Central blob wins, not the largest** — that is what drops the baked rank and
  file labels sitting in the cell corners.
- **Supersample ×4 before keying.** Keying a 66px cell can only produce a 66px
  mask; resampling first puts the decision on smooth data so the alpha edge
  lands sub-pixel.
- **Decontaminate the whole blend ring**, not just the translucent rim. The
  render's piece/board blend is about a source pixel wide — four pixels at ×4,
  *most of them fully opaque*. Recolouring only the rim leaves a pale halo baked
  into the silhouette, which lights up when a piece cut from a light square is
  drawn on a dark one. Geometry is left alone: eroding far enough to cut past
  that ring shaves the queen's coronet spikes.
- **Contact shadows are stripped from the pale set only.** A white piece has
  nothing legitimately darker than its square, so anything darker is shadow. The
  mirror rule would shear the gold crowns off the dark set. `ChessBoard` draws
  one shadow for all twelve instead, so lighting is uniform.

## Reading the output

Every run prints per-piece `sep` / `fill` / `border` / `span`.

- `sep` — piece-vs-square separation on the raw crop. Below ~25 is flagged.
- `border` — share of the cell edge still opaque. **Should be 0.0%**; anything
  higher means background survived.
- `fill` — share of the cell the piece occupies, typically 20–45%.
- `span` — vertical extent, typically 75–90%.

Current state: all 12 extract at `border=0.0%`. Only `wp` flags low separation
(24) — the white pawn appears only on same-tone squares in this render. It still
cuts cleanly, but it has the least margin if something ever looks off.

Useful flags: `--debug` writes every candidate to `assets/pieces/debug/`;
`--only wq` isolates one piece (and skips rewriting the sprite map);
`--force wq=45:16:1` pins tolerance:edge:supersample for a stubborn piece.

## Square colours

Measured per rank off the same file rather than picked by eye, and stored in
`BoardSquares` in the theme. Painting all 64 squares one flat pair of tones made
the board read washed out next to the render, which is lit from above. Re-measure
whenever the reference changes.

Files here are source art for the extractor — nothing in this folder is bundled
into the app.
