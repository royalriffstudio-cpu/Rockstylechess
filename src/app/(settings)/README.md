# (settings) route group

System/account screens: app settings, notifications, account security, and support.
Grouped together since they're all reachable from Control Core or Iron ID rather than
from a single Home tile, distinct from `(social)`'s other-player screens.

The parentheses make this a *route group* — Expo Router uses the folder to organize
files without adding `/settings` to the URL/deep-link path.

- `control-core.tsx` — audio toggles, Push Notifications section (system permission row + four category switches, `usePushPreferences`; logout unregisters the device first), game settings rows, account ID, logout, built
  from `control_core_pro_stage_animated`. Real entry point: a gear icon on Iron ID's
  header. Logout clears the stored session token (`src/lib/authStorage.ts`), the guest
  latch and the socket's trusted identity (`src/lib/socket.ts`'s `clearSocketAuth`),
  then returns to `sign-in.tsx`. Shows "Privacy & Ad Choices" (Google UMP) only where
  consent rules require it. **Not wired yet:** the Language and Terms of Service rows
  only `console.log` (see `ROADMAP.md`).
- `backstage-alerts.tsx` — notification feed with claim/view actions, built from
  `backstage_alerts_pro_stage_animated`. Reached from Control Core's Notifications row.
  In-app only (no push notifications).
- `account-security.tsx` — sign-in methods + blocked players + delete-account danger
  zone, built from `account_security_pro_stage_animated`. Reached from Control Core's
  Account row. "Sign-in Methods" is real: `/me/profile` returns `signInMethods`
  (`password` and/or `google`) and the login email; an account without Google gets a
  **Link Now** button (`linkGoogleAccount` in `authClient.ts`, same browser tab as sign-in;
  success is read back from the profile). Delete Account
  calls the real `DELETE /me` on the server (`src/lib/api.ts`), then clears local auth
  state the same way logout does. A guest (never signed in) has nothing server-side to
  delete, so it just navigates back.
- `blocked-players.tsx` — the signed-in player's block list (`GET` blocked users,
  unblock with a confirmation). Reached from Account Security.
- `roadie-support.tsx` — support hub built from `roadie_support_pro_stage_animated`:
  FAQ, Technical / Billing (email support pre-filled with app version and platform),
  and Report a Player.
  Reached from Control Core's "Help & Support" row.
- `faq.tsx` — static FAQ (`FAQ_ENTRIES`), expandable rows. Reached from Roadie Support.
- `report-player.tsx` — pick a friend or a recent online opponent (`getMyMatches`) and
  report them (the shared form is `src/components/social/ReportPlayerModal.tsx`; server
  side `db/moderation.ts`).
  Reached from Roadie Support.
