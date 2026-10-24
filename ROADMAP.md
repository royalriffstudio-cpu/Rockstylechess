# Roadmap: what is left before launch

A prioritized list of the gaps found by auditing the code on **2026-10-23** (branch
`economy-sinks`, including the uncommitted rematch / time-control-pool / public-profile work).
It covers three things: what keeps this from shipping, what a production app still needs, and
what the game layer is missing. Each item names the file where the gap is so it can be checked
before work starts. When something here is done, delete it (or move it to "Done" at the bottom)
in the same change.

Feature documentation lives elsewhere: `README.md` (overview, setup, builds), `server/README.md`
(every server system), the per-folder `README.md`s under `src/`, `DESIGN.md` / `ui.md` (UI).

## 1. Launch blockers

1. **Android match freeze/crash.** Entering a match on a low-end Adreno phone freezes, flickers
   and kills the app. The likely cause and the fix are in `TEMP-match-crash-notes.md`: on
   Android, expo-image draws an SVG as a `PictureDrawable` (vector commands replayed every
   frame), and the piece SVGs have 121-2,089 paths each. Switch `pieceSprites.ts` to the
   PNGs from `scripts/rasterize-pieces.mjs` (needs the owner's go-ahead; the SVGs stay as the
   source files).
2. **Empty matchmaking queues.** `server/src/matchmaking.ts` only pairs real players. A player
   alone in a pool waits forever; the only help is the opt-in "Also search other time controls"
   after ~25 s. Needed: a fallback after a timeout (a server-played bot seat, as Festival Run
   already uses in `server/src/serverBot.ts`, or an offer to play a bot), and pairing by a
   rating window.
3. **Puzzle rewards are farmable.** `POST /me/quests/report-puzzle-solved`
   (`server/src/auth.ts`) takes no puzzle id; any signed-in client can report a solve every
   4 s and collect quests, puzzle achievements (up to 130 gems) and Tour progress. The server
   needs the puzzle catalog, should check the submitted solution, and should count each puzzle
   once per user.
4. **Store blockers in `app.json` / the Android build.**
   - AdMob uses Google's public **test** app id, and the unit ids default to test units
     (`src/lib/ads/adsConfig.ts`). Set the real ids and turn on `ADS_REQUIRE_SSV`.
   - The release manifest requests `RECORD_AUDIO` (from `expo-audio`), `SYSTEM_ALERT_WINDOW`
     and external-storage permissions. Block them (`android.blockedPermissions`, or
     `expo-audio`'s `microphonePermission: false`).
   - Play requires an **AAB**; the docs only build an APK (`assembleRelease`). Add
     `bundleRelease` (or an `eas.json`).
   - `expo.name` is `rockstyle-chess` (shown under the launcher icon), the adaptive icon
     background is the template's `#E6F4FE`, and `userInterfaceStyle` is `automatic` on a
     dark-only app.

## 2. Production readiness

| # | Gap | Where |
|---|---|---|
| 5 | **Email verification + Forgot Password: code done, mail setup deferred (owner's call, doing it later).** See the checklist under this table. Sign-up email checks (typos, disposable, non-existent domains) are already always on | `server/src/betterAuth.ts`, `server/src/emailPolicy.ts`, `server/src/mailer.ts` |
| 6 | No crash reporting on either side (no Sentry/Crashlytics) | client + server |
| 7 | No React error boundary: a render error white-screens the app | `src/app/_layout.tsx` |
| 8 | IAP refunds are not handled (no Real-time Developer Notifications / Voided Purchases API): refunded gems stay spendable | `server/src/googlePlay.ts` |
| 9 | Rewarded-ad rewards trust the client until `ADS_REQUIRE_SSV=true` | `server/src/adRewards.ts` |
| 10 | No minimum-app-version check / forced update, no OTA (`expo-updates`) | client + a `/config` route |
| 11 | Stage names are only truncated to 40 chars: no profanity or impersonation filter | `server/src/auth.ts` (`PATCH /me/profile`) |
| 12 | No general REST rate limit (better-auth only limits sign-in/sign-up) | `server/src/index.ts` |
| 13 | Railway has no `healthcheckPath`; migrations are a manual `db:migrate:remote`; logs are plain `console.*` | `server/railway.json` |
| 14 | Every deploy ends every live match (wagers are refunded, but the games are lost): needs a drain step | `server/src/index.ts` (`shutdown`) |
| 15 | No analytics (funnel, retention, economy sinks/sources) to tune `economy.config.json` against | client |
| 16 | No CI and no automated tests; the money paths (wagers, festival, IAP, `grantFame`) need them first | repo |
| 17 | Release build is not minified (R8 off by default) | `android/` via `expo-build-properties` |
| 18 | Google sign-in is built (browser flow) but **needs the Google Cloud OAuth setup** (README "Google sign-in": consent screen published, Web client, redirect URI, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` on Railway) and a real-device test; there is still no Apple/Facebook (dropped on purpose) | `server/src/betterAuth.ts`, `src/lib/authClient.ts` |
| 19 | Control Core's Language and Terms of Service rows only `console.log` (the legal URLs exist in `src/constants/legal.ts`) | `src/app/(settings)/control-core.tsx` |
| 20 | No i18n, and no `accessibilityLabel` anywhere | client |
| 21 | iOS is not shippable (no `bundleIdentifier`, Google-only IAP, test AdMob iOS id). Fine for an Android-only launch | `app.json` |

**Item 5 checklist (do in this order; full steps in the root `README.md` -> "Email verification"):**
- [ ] Get a domain you control (any registrar).
- [ ] Make a Resend account, add the domain, copy its DNS records (SPF/DKIM) into the registrar, wait until Resend shows "Verified".
- [ ] Create a Resend API key.
- [ ] `cd server && npm run db:migrate:remote` (migration 0022) **before** deploying; it grandfathers existing accounts.
- [ ] Railway variables: `RESEND_API_KEY`, `MAIL_FROM` (e.g. `Rockstyle Chess <no-reply@yourdomain.com>`), then `EMAIL_GATE=1` **last**.
- [ ] Deploy, then test with a real address: sign up, receive the code, verify (welcome bonus arrives), and try Forgot Password.
- Do not set `EMAIL_GATE=1` before mail works, or new players wait on a code that never arrives. Until then everything behaves as before.

## 3. Game layer gaps

22. **Play tab time chips are mislabeled.** `src/app/(tabs)/play.tsx` shows Bullet 1+0,
    Blitz 3+2, Rapid 10+0 and Classical 30+0 but queues 3m / 3m / 10m / 10m. Online increment is
    always `0` (every `createMatch(..., 0, ...)` in `server/src/index.ts`) although the clock
    supports it.
23. **No premoves** (matters at 3 minutes).
24. **No tutorial or first-match guidance**: nothing explains chips, venues, Fame or the Tour.
25. **"Analysis Board" can't explore lines.** `replay.tsx` only scrubs a finished game; it has
    no board input, although the Play tab sells it as "explore lines".
26. **Rating is a flat Elo, K=32** (`server/src/db/elo.ts`): no provisional period, one rating
    for every time control.
27. **Haptics only on celebrations** (`src/lib/celebration.ts`): none for moves, captures,
    check or low time.
28. **Seasons / Backstage Pass.** The Shop shows "Backstage Pass ... Coming soon";
    `player_profiles.season_xp` exists but nothing uses it.
29. **Tournaments are "Coming Soon"** (`src/app/(play)/tournaments.tsx`).
30. **Venue and Country leaderboards are "Coming Soon"**; no weekly/seasonal boards.
31. **Push notifications: code done, Firebase/Expo setup deferred (owner's call, not doing it now).**
    Code is in (server `push.ts` / `pushScheduler.ts`, app `usePushNotifications`, Settings switches,
    result-screen primer) and migration 0021 is applied locally only. To switch it on, later:
    - [ ] Firebase project + Android app `com.rockstylechess.app`; put `google-services.json` in the repo
      root and add `android.googleServicesFile` to `app.json`.
    - [ ] `npx eas-cli init` (writes `extra.eas.projectId`).
    - [ ] Upload the FCM V1 service-account key at expo.dev -> Credentials -> Android.
    - [ ] `npm run db:migrate:remote` (0021), deploy the server, rebuild the APK.
    - [ ] Test on a real phone (nothing has been delivered end to end yet).
    Full steps: root `README.md` -> "Push notifications". iOS later also needs a bundle id and an APNs key.
32. **Puzzles are thin:** ~250 puzzles, no daily puzzle, no puzzle rating, no Puzzle Rush, and
    solved state is device-only (`src/lib/puzzleProgress.ts`).
33. **No live-ops tooling** (limited-time events, featured bosses, shop rotation) and no share
    card after a win.

## 4. Known bugs (board / match)

34. **Take Two replays a sound.** After `takeBack()` the board treats the bot's earlier move as
    new (`isNewMove` in `ChessBoard.tsx` compares only from/to), so it plays that move's sound
    again and re-fires the check pulse if it was a check.
35. **Leaving the move-history peek after scrubbing replays the last move's sound**, and
    re-animates it when the scrub was exactly one ply back.
36. **One-frame zero-size pieces on ungated boards.** `squareSizeShared` is synced in a
    `useEffect` (after paint); puzzle, replay and spectate boards can show a one-frame pop.
    Sync it in a layout effect.
37. **`positionsRef` never forgets captured pieces' shared values** (small per-game leak).
38. **`BoardAssetPrewarm` warms 44x44**, but Glide caches per size, so the board's real size
    is never warmed.
39. **Diagnostic switches in production code.** `match.tsx`'s `dbg` route param and
    ChessBoard's `debugNoPieces` / `debugPlain` were committed with `8bd310c`. Remove them once
    item 1 is fixed.

## Suggested order

1 -> 6 + 7 -> 4 -> 3, 8, 9, 12 (money safety) -> 2 -> 5, 10, 13, 15 -> 22, 24 -> 31, 28, 29.

## Done (recently, keep short)

- Rematch / play again (`server/src/rematch.ts`, `RematchPanel`), time-control pools with an
  opt-in widen, public player profiles (`PlayerProfileSheet`): uncommitted as of 2026-10-23.
