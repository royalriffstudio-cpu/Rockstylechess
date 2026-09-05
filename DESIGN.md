# RockStyle Chess — Design System

Extracted from the live source of truth: [`src/constants/theme.ts`](src/constants/theme.ts)
and the shared primitives in [`src/components/ui/`](src/components/ui/). This is
**not** a Tailwind/CSS project — it's a React Native (Expo) app styled with
`StyleSheet` + `expo-linear-gradient`, built around a single fixed **dark**
theme (no light mode). A rock-concert / casino-game aesthetic: chrome metal,
neon accents, deep stage-black backgrounds.

> Source of truth: always pull from `@/constants/theme`. Never hardcode hex
> values or font names in a screen/component. If you change a token, edit
> `theme.ts` — don't let this file and the code drift.

---

## Color Palette

### Accents
| Token | Hex | Usage |
|---|---|---|
| `ember` | `#FF5A1F` | Primary warm accent — CTAs, "Play" button, energy/urgency |
| `emberLight` | `#FF9248` | Ember gradient highlight stop |
| `gold` | `#FFC23A` | Rewards, currency (chips), highlighted/active card glow |
| `cyan` | `#2FE6FF` | Primary interactive accent, active nav state, gems currency |
| `crimson` | `#E11D2A` | Danger/destructive actions |

### Chrome / Metal Neutrals
| Token | Hex | Usage |
|---|---|---|
| `chrome` | `#F1F3F7` | Specular highlights, gloss overlays, borders |
| `chromeMid` | `#A6ACB8` | Inactive nav icon/label color |
| `chromeDark` | `#5C6069` | Track/well backgrounds (e.g. progress bar track) |

### Board Surface
| Token | Hex | Usage |
|---|---|---|
| `boardLight` | `#DEDBD6` | Light square base (mid-board reference) |
| `boardDark` | `#373D47` | Dark square base (mid-board reference) |
| `boardEdge` | `#20242C` | Board frame edge |

Per-rank square colors are measured off a reference render (not one flat
pair — brightness peaks around ranks 5–6, falls off toward the player). See
`BoardSquares.light[8]` / `BoardSquares.dark[8]` in `theme.ts`, indexed rank 8
(top) → rank 1 (bottom).

### Piece Tones (sculpted gradient body: Hi → Mid → Lo, lit top-left)
| Token | Hex |
|---|---|
| `pieceWhiteHi` | `#FFFFFF` |
| `pieceWhiteMid` | `#DEE2E8` |
| `pieceWhiteLo` | `#98A0AC` |
| `pieceBlackHi` | `#5B616C` |
| `pieceBlackMid` | `#2C3037` |
| `pieceBlackLo` | `#101216` |

White set gets cool chrome-shaded rim trim; black set gets gold rim trim.

### Text
| Token | Hex | Usage |
|---|---|---|
| `textPrimary` | `#F5EFF1` | Primary text on dark surfaces |
| `textMuted` | `#A294A0` | Secondary/caption text, section labels |

### Backgrounds
| Token | Hex | Usage |
|---|---|---|
| `bgBase` | `#0B0709` | App root background (near-black, warm) |
| `bgPanel` | `#17101A` | Elevated surfaces — cards, panels, bottom nav |

### Deriving translucent colors
No separate alpha tokens — `withOpacity(hex, alpha)` converts any theme hex
into an `rgba()` string on demand, used everywhere for borders, glows, and
scrims instead of one-off literals.

```ts
withOpacity(Colors.gold, 0.45) // → 'rgba(255, 194, 58, 0.45)'
```

---

## Typography

Three font families, loaded via `expo-font` / `@expo-google-fonts/*` in
`src/app/_layout.tsx`:

| Token | Font | Weight | Usage |
|---|---|---|---|
| `Fonts.display` | Anton | 400 (only weight shipped) | Big hero/display numerals & headlines |
| `Fonts.heading` | Oswald | 600 (SemiBold) | Buttons, section labels, currency values, nav — condensed, uppercase-leaning |
| `Fonts.body` | Inter | 400 | Body copy, captions, nav labels |

Observed conventions (from components, not separate tokens — set per
component as needed):
- Buttons (`RockButton`): `Fonts.heading`, 16px, `letterSpacing: 0.5`, uppercase.
- Section labels (`SectionLabel`): `Fonts.heading`, 13px, `letterSpacing: 2`, uppercase, `textMuted`.
- Currency values (`CurrencyPill`): `Fonts.heading`, 14px.
- Nav labels (`BottomNav`): `Fonts.body`, 11px.
- Progress bar caption (`ProgressBar`): `Fonts.body`, 12px, `textMuted`.

Font family keys map to exact PostScript names registered by `useFonts()`
(e.g. `'Anton_400Regular'`) — always import via `Fonts.*`, never hardcode the
PostScript string in a screen.

---

## Spacing Scale

`Spacing` in `theme.ts` — shared across padding/gaps for every component:

| Token | Value |
|---|---|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 24 |

---

## Border Radius

`Radius` in `theme.ts`:

| Token | Value | Usage |
|---|---|---|
| `sm` | 8 | Small chips/tags |
| `md` | 14 | Buttons (`RockButton`) |
| `lg` | 15 | Cards (`RockCard`) |
| `full` | 999 | Pills (`CurrencyPill`), circular buttons |

Other radii appear inline where they're structural rather than tokens (e.g.
`BottomNav`'s `borderTopLeftRadius/Right: 20` for the bar's top corners,
`PLAY_SIZE / 2` for its circular play button) — kept local since they're
derived from a component's own dimensions rather than reused elsewhere.

---

## Shadows & Glow

No shadow token scale — every glow is built live from `withOpacity()` against
the accent color in play, layered as CSS-style `boxShadow` strings (this repo
targets New Architecture / web-style shadow props) with multiple comma-
separated layers: an ambient drop shadow + a colored glow. Pattern:

```ts
boxShadow: `0px 4px 10px ${withOpacity(Colors.bgBase, 0.7)}, 0px 0px 18px ${withOpacity(accent, 0.5)}`
```

Observed shadow "recipes" by component:
- **RockButton** (rest): `0px 4px 10px bgBase@0.7, 0px 0px 18px accent@0.5`
- **RockButton** (pressed): `0px 2px 4px bgBase@0.6, 0px 0px 8px accent@0.35` (shadow shrinks, button also scales to 0.97 + translateY 1)
- **RockCard**: `0px 15px 30px bgBase@0.85` ambient, plus `0px 0px 24px glowColor@0.45` when a `glowColor` prop is set (highlighted card)
- **CurrencyPill**: `0px 2px 8px bgBase@0.5`; its `+` add-button glows `0px 0px 8px accent@0.6`
- **ProgressBar** fill: `0px 0px 6px gold@0.6`
- **BottomNav** bar: `0px -4px 16px bgBase@0.6` (casts upward, it's pinned to the bottom); play button glows `0px 0px 18px ember@0.7`
- **PlayerAvatar** ring: `0px 0px (outer*0.35)px glowColor@0.55` — `glowColor` is `ember` by default, `cyan` when `selected`; level badge glows `0px 0px 6px gold@0.6`

**Depth is never a flat fill/elevation** — every "glossy" surface is built
from real layered `LinearGradient`s, per the Component Depth Standard in
`CLAUDE.md`:
1. Base gradient fill (e.g. light→accent→dark on buttons, diagonal panel→base on cards).
2. A separate top-aligned gloss/highlight gradient (white-ish → transparent).
3. Optional inner accent glow (radial-ish, top-aligned) on cards.
4. A 1px top highlight line gradient on cards ("chrome edge catching light").

---

## Layout Patterns

- **Router**: Expo Router file-based routes under `src/app/`, grouped by
  domain: `(auth)`, `(tabs)`, `(play)`, `(rewards)`, `(settings)`, `(shop)`,
  `(social)`, `(modals)`. Root `_layout.tsx` sets a single `Stack` with
  `headerShown: false` and `contentStyle.backgroundColor: Colors.bgBase`.
- **Safe area**: `SafeAreaProvider` at the root; individual screens/components
  pull `useSafeAreaInsets()` directly rather than a wrapper (see `BottomNav`,
  `home.tsx` top bar) and add insets into padding/height manually.
- **Status bar**: always `style="light"` (dark theme only, no variant).
- **Screen shell convention** (e.g. `home.tsx`): a root `View` with ambient
  radial glow `View`s (`ambientGlowCyan`, `ambientGlowEmber`) plus an
  `EmberParticles` layer behind the content for atmosphere, `ScrollView` for
  content, `BottomNav` docked at the bottom.
- **Bento-style tile grids**: home screen composes `BentoTile[]` entries with
  `size: 'lg' | 'sm'` for an irregular grid of action cards.
- **Bottom nav**: fixed 4-tab bar (`home`, `ranks`, `shop`, `profile`) with a
  5th floating circular "play" action button overlapping the top edge,
  offset by `-PLAY_SIZE * 0.4`.
- **Cards vs. Buttons**: `RockCard` is the general panel/container primitive
  (optional `glowColor` for emphasis, optional `backgroundImageUri` for hero
  photo cards with a bottom scrim); `RockButton` is the only interactive CTA
  primitive, with `variant: 'primary' | 'reward' | 'danger'` mapping to
  `cyan | gold | crimson`.
- **Chess board**: laid out at an integer pixel grid (not `flex: 1`) so all
  eight squares stay exactly equal — see `src/components/README.md` for why.

---

## Component Inventory

All in [`src/components/ui/`](src/components/ui/), imported via
`@/components/ui`:

| Component | Purpose |
|---|---|
| `RockButton` | Primary CTA — 3 variants (primary/reward/danger), gradient fill + gloss + glow, press feedback |
| `RockCard` | General panel/container — gradient fill, optional accent glow, optional hero background image with scrim |
| `CurrencyPill` | Chips/gems balance chip with optional inline "+" add action |
| `PlayerAvatar` | Circular avatar — gradient "fire" ring (swaps to cyan when `selected`), optional level badge, image or emoji fallback (see [Avatars](#avatars)) |
| `SectionLabel` | Uppercase label + fading gold rule line, for section headers |
| `ProgressBar` | Gradient (ember→gold) fill bar with glow, optional caption |
| `BottomNav` | 4-tab bottom bar + floating circular play button |
| `ChessBoard` | Self-contained board primitive (interactive or read-only), integer-pixel grid, per-rank square coloring, two-ellipse piece contact shadows, swappable piece-set art via its `pieceSprites` prop |
| `ChatPanel` / `ChatToast` | In-match chat UI |
| `EmberParticles` | Decorative ambient particle layer |

Non-UI: `StockfishEngine.tsx` (headless WASM engine host, no themed visual
surface — lives in `components/` directly, not `ui/`).

---

## Avatars

`PlayerAvatar` ([`src/components/ui/PlayerAvatar.tsx`](src/components/ui/PlayerAvatar.tsx))
renders every player/character portrait in the app — a circular image or
emoji, wrapped in a glowing gradient ring, with an optional level badge.
The ring's ember→gold→crimson sweep and heavy outer glow are a deliberate
callback to the app's rock-concert theme — it reads like a stage light or
guitar-pickup halo around the player's portrait, reinforcing the same
chrome-metal / neon-stage aesthetic the rest of the design system leans on,
rather than a generic profile-picture border.

### Sizes

Three fixed sizes (`AvatarSize`), each driving ring thickness, emoji scale,
and badge scale together — never set these dimensions ad hoc in a screen:

| Size | Outer Ø | Ring width | Emoji size | Badge Ø |
|---|---|---|---|---|
| `tiny` | 32 | 2 | 14 | 12 |
| `small` | 44 | 3 | 18 | 16 |
| `medium` (default) | 68 | 4 | 28 | 20 |
| `large` | 100 | 5 | 42 | 26 |

`tiny` exists for spots too tight for `small`'s footprint (e.g. the in-match
player-row card in `(play)/match.tsx`, swapped in for a static accent icon
without growing the card) — no level badge is ever shown at this size in
practice.

The inner content circle is always `outer - ring * 2`.

### The "fire" ring

`expo-linear-gradient` only renders linear gradients, not conic ones, so the
ring's 360° fire effect is **approximated**: a diagonal (top-left → bottom-
right) multi-stop `LinearGradient` sweep — `ember → gold → crimson → ember` —
plus a matching colored `boxShadow` glow (`0px 0px (outer*0.35)px ember@0.55`)
sitting behind it. This is an intentional, documented simplification of a
conic gradient per the Stitch-fidelity rule, not a dropped effect.

When `selected` is true (e.g. character-select screens), the ring swaps to a
`cyan → cyan@0.6 → cyan` sweep with a cyan glow instead — used to mark the
currently-chosen avatar rather than layering a separate selection outline.

### Content

Priority: `source` → `imageUri` → `emoji` → `♟️`.

- `source` renders a bundled avatar image (`ImageSourcePropType`) covering
  the inner circle — used for the **player avatar badge set**
  ([`src/constants/avatars.ts`](src/constants/avatars.ts)): 12 neon rock
  badges sliced from `assets/avatar/avatar_rock_12pcs_set.png` by
  `scripts/split-avatars.mjs`, one committed PNG per `id`. Resolve a
  profile's `avatarId` through `getAvatarImage(avatarId)` (returns the
  `riff` badge as the default).
- `imageUri` renders a remote/URI `Image` filling the inner circle.
- `emoji` renders centered as `Text` — kept for non-avatar-set glyphs
  (bots' roster faces, mock friends/conversations, `❓` "searching…"
  states). Falls back to `♟️` if nothing is passed — an avatar should
  never render as an empty ring.
- Inner circle background is `Colors.bgPanel`, so partially-transparent
  glyphs/images never show the screen behind them.

### Level badge

- Passing `level` renders a small solid-gold circular badge overlapping the
  bottom edge of the ring, with the level number in `Fonts.heading` at
  `badge * 0.55`px, colored `bgBase` (dark-on-gold for contrast), glow
  `0px 0px 6px gold@0.6`, and a 1.5px `bgBase` border to separate it from the
  ring beneath it.
- Omitting `level` (e.g. character-select grids where rank isn't relevant)
  renders the avatar with no badge at all — this is the expected way to hide
  it, not a loading/empty state.

---

## Conventions Worth Preserving

- **Theme-first, always.** Every color/font/radius/spacing value in a
  screen or component should resolve back to a `theme.ts` export.
- **No flat fills on "glossy" surfaces.** Per `CLAUDE.md`'s Component Depth
  Standard: gradients, glow, and highlight layers are required, not optional
  polish, for any shared component with a glossy/glowing treatment.
- **Stitch fidelity.** When translating a `stitch-export/*/code.html` mockup,
  external/unstable image URLs and CSS-only effects must be rebuilt natively
  (gradients, layered views, shadows) rather than silently dropped — flag it
  explicitly if something truly can't be replicated.
