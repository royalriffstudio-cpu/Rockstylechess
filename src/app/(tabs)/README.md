# (tabs) route group

The two hub screens of the main app shell. There is **no `Tabs` navigator**: the root
`_layout.tsx` has one `Stack`, and the bottom bar is the `BottomNav` component
(`src/components/ui/BottomNav.tsx`), rendered once from the root layout and driven by
the current route (`bottomNavTabForRoute`). Its five destinations are Home, Ranks
(`world-rankings`), Play (the raised center button), Shop and Profile (`iron-id`); it
navigates with `router.dismissTo` so switching sections doesn't stack history.

- `home.tsx` — the Lobby. Named `home` (not `index`) because the root
  `src/app/index.tsx` already owns the `/` route as the entry redirect; both can't
  claim `/`. Venue picker hero card ("Play Now" -> `matchmaking.tsx`, shared venue-entry
  rules in `useVenueEntry`), a 2x2 bento grid (Iron Duel, The Tour, Bots, Puzzles) and
  the daily row (Daily Bonus, Spin).
- `play.tsx` — the mode picker (center tab). A Quick Match card with time-format chips
  (Bullet / Blitz / Rapid / Classical) and "Find Match", then "Competitive" (Iron Duel,
  Play a Friend, The Tour, Festival Run) and "Casual & Training" (Vs Bots, Puzzles,
  Analysis Board) rows. **Known issue:** the chip labels (1+0, 3+2, 10+0, 30+0) don't
  match what is played — they map to the 3m / 3m / 10m / 10m queues with no increment
  (see `ROADMAP.md`).
