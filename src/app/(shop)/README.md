# (shop) route group

Economy and customization destinations reachable from Home — spending the chips/gems
won during play, not part of the `(play)` match flow itself.

The parentheses make this a *route group* — Expo Router uses the folder to organize
files without adding `/shop` to the URL/deep-link path.

- `shop.tsx` — the Rock Shop, built from the `rock_shop_pro_stage_animated` Stitch
  mockup (chosen over the `rock_shop_gear_gold` variant — see chat history for why).
  The Chips tab also holds two ad-related cards: **Remove Ads** (one-time
  non-consumable `remove_ads` purchase: verified server-side, acknowledged but never
  consumed, flips `player_profiles.ads_removed`; has a "Restore purchase" link) and
  **Free Chips** (a `RewardedAdButton`, +100 chips, 3/day — this replaced the old
  "Stadium Vault" Coming-Soon claim tile). See "Ads" in the root `README.md`.
  A **Gear** tab holds Backstage Gear (`components/shop/GearPanel.tsx`): Amp Boost and Lucky Pick,
  bought with chips and activated by the player, plus the **Review Pack** card (10 Game Reviews
  at 20% off, stored as credits). The Safety Net is not sold here; it is an add-on on
  `(play)/setup.tsx`.
- `forge.tsx` — board/piece/avatar customization. The Avatars tab is split into
  three **classes** (`AvatarClassTabs`: Garage Band free, Main Stage gems-or-chips,
  Hall of Fame gems-only + a rating gate); tapping an unowned premium avatar opens
  `UnlockModal` (Hall of Fame hides the chips button and shows the rating
  requirement). The server is the real enforcement (see `server/README.md`). No Stitch source; built from our
  own design system (RockCard, PlayerAvatar, locked-tile pattern from Pick-Rockstar).
