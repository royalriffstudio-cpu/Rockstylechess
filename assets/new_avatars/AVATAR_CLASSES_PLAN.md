# Avatar Classes — Implementation Plan

> **Status (2026-10-23): implemented.** Garage Band (12 free), Main Stage (41) and Hall
> of Fame (24) are live. The current source of truth is `scripts/gen-avatar-catalog.mjs`
> (generates `src/constants/avatarImages.generated.ts` and
> `server/src/avatarCatalog.generated.ts`) and `server/README.md` -> "Avatar classes".
> This file is kept as the original design brief.

Hand this file to the agent working in the game repo. It explains what the avatar assets are, why they are split into classes, and how to wire them into the game.

## 1. Context

- The game is a **chess game with a rock-style theme**.
- The game already has **12 PNG rock-badge avatars** (`assets/avatar/`, not emoji). They are staying. Do not remove or replace them. (Updated: the original brief called them emoji.)
- New avatar art was generated with two different AI image models, so there are **two distinct art styles**:
  - **Painted illustrated style** (Google "nano-banana" set).
  - **Photoreal neon style** (GPT image set).
- Mixing these in one grid would look random and inconsistent. The solution is to turn the style difference into **a deliberate progression of collectible classes**, each with its own tab, frame and price tier. Players should read the styles as "ranks", not as mismatched sources.

## 2. The class hierarchy

| Tier | Class name | Art style | Source | Count |
|---|---|---|---|---|
| 1 | **Garage Band** | Emoji | Already in the game | existing |
| 2 | **Main Stage** | Painted illustrated | `02-main-stage/` | 41 |
| 3 | **Hall of Fame** | Photoreal neon | `03-hall-of-fame/` | 24 |

The names follow a band's career: start in the garage, play the main stage, end in the Hall of Fame.

- **Garage Band**: beginner tier. Free or very cheap, so new players can start immediately.
- **Main Stage**: mid tier. Players save coins to unlock it.
- **Hall of Fame**: top tier. It is the smallest class and the most expensive, so it feels rare. It could also be earned through rating, wins or a season pass instead of coins only.

## 3. Asset facts

- Folder: `avatars/` (this folder).
  - `02-main-stage/`: 41 PNGs.
  - `03-hall-of-fame/`: 24 PNGs.
  - There is no `01-garage-band/` folder because those are the existing emoji.
- Every PNG is a **square cut tightly around one circular avatar, with a transparent background outside the circle** (RGBA). The circle fills the square. Never add a second circle crop that clips the ring.
- Sizes are about 207–242 px per side. They are fine for list and grid thumbnails. If shown large (profile screen, big cards) they will look soft, so upscale or regenerate them first.
- File names are lowercase and hyphenated, for example `steel-stubble.png`. **Use the file name without `.png` as the avatar `id`.**
- Duplicates were already removed. Do not re-add near-duplicate characters.

### Main Stage files (`02-main-stage/`)
backbeat-brat, bass-braids, blue-spike, chain-ghoul, chrome-skull, cobalt-cowl, crimson-riff, crypt-crooner, cyber-reaper, cyber-shades, dark-majesty, drum-fury, dusty-outlaw, ember-dreads, faded-legend, glam-star, glitch-punk, grave-mane, grizzly-biker, hellfire-skull, hooded-tactician, iron-mane, neon-visor, pink-scream, road-dog, screamer, shred-siren, silver-fox-frontman, silver-phantom, spiked-duchess, spike-havoc, steel-stubble, synth-rebel, teal-banshee, thorn-queen, thunder-drummer, toxic-bassist, velvet-widow, violet-riot, violet-specter, warlord-beard

### Hall of Fame files (`03-hall-of-fame/`)
afro-mixmaster, aviator-frontman, bandana-legend, chain-gang, chrome-visor, cobalt-mohawk, crimson-bandana, golden-mane-king, ice-punk, lavender-keys, lightning-scar, midnight-raven, neon-beats, neon-werewolf, platinum-siren, pulse-dj, scarlet-bass, scarlet-scarf, shadow-cloak, skeleton-king, stickman-storm, top-hat-maverick, violet-shredder, wildfire-curls

## 4. Implementation plan

### 4.1 Copy the assets into the game
Copy the two class folders into the game's asset directory, for example `assets/avatars/main-stage/` and `assets/avatars/hall-of-fame/`. Keep the file names unchanged.

### 4.2 Single avatar catalog
Create one catalog as the only source of truth, for example `avatars.ts` or `avatars.json`. Put the emoji avatars in the same catalog, so the picker has one data source.

Fields per avatar:
- `id`: unique string. For the new art, the file name without `.png`.
- `class`: one of `garage_band`, `main_stage`, `hall_of_fame`.
- `kind`: `emoji` or `image`.
- `source`: the emoji character, or the image asset.
- `name`: display name, for example "Steel Stubble".
- `price`: coin cost. `0` for free ones.

For React Native, image assets need static `require()` calls. Generate the catalog with a script, or write the requires out by hand. Do not build the path dynamically at runtime.

Store only this per player:
- `ownedAvatarIds`
- `selectedAvatarId`

### 4.3 Pricing
These numbers are placeholders to tune against the game's real coin income:
- Garage Band: free or very cheap.
- Main Stage: about 5× the cheapest tier.
- Hall of Fame: about 4–5× Main Stage, or earned by rating, wins or a season pass.

Optional: rarity labels inside a class (common, rare, legendary) for price variation.

### 4.4 Avatar picker UI
- Add **three tabs**, one per class, each showing owned and total counts (for example "12/41").
- Never mix classes in one grid. Mixing is what makes the art look random.
- Locked avatars are shown greyed out with a price tag. Tapping one opens a purchase confirmation.
- Tapping a locked tier shows a teaser such as "Unlock at X coins", so players have something to save toward.
- The currently selected avatar is clearly marked.

### 4.5 Making the mixed styles look intentional
- **Class frame:** draw a consistent frame around every avatar, chosen by class:
  - Garage Band: plain steel ring.
  - Main Stage: glowing neon ring.
  - Hall of Fame: gold ring with a particle or glow effect.
- **Same circle crop everywhere.** The PNGs are already circular, so use a square container and do not re-clip them.
- **Per-class identity:** give each tab its own header art and accent colour. This makes each class read as its own collection.
- **Optional:** show the class as a rank badge next to the player's name in matches and on the profile.

## 5. Rules for the implementing agent

- Follow the design system in `DESIGN.md` for all UI.
- Follow the project's Visual Fidelity Rule and Component Depth Standard. Class frames, glows and highlights need real layered depth (gradients, coloured shadows), not flat fills. Flag anything you simplify.
- Do not remove or alter the existing emoji avatars. They become the Garage Band class.
- Keep the avatar logic in one catalog. Do not hard-code avatar lists in screens.

## 6. Open items to confirm with the user
- Final coin prices and whether Hall of Fame is bought, earned, or both.
- Whether avatars should be upscaled before use on large screens.
- Whether to add rarity labels inside classes.
