# (social) route group

Everything about other players: rankings, identity, clubs, friends, messaging, and
spectating a live match. Grouped together since they're all reachable from each other
(mostly via Iron ID's social row) rather than from a single Home tile, distinct from
`(play)`'s own-match flow and `(rewards)`'s solo engagement loops.

The parentheses make this a *route group* — Expo Router uses the folder to organize
files without adding `/social` to the URL/deep-link path.

- `world-rankings.tsx` — Global/Friends/Venue/Country leaderboard with a podium and a
  pinned "you" row, built from `world_rankings_pro_stage_animated`. Real `BottomNav`
  destination for the "Ranks" tab. **Global** and **Friends** tabs are live (Friends
  reads `useFriends()`, ranked by rating); Venue/Country still "Coming Soon". Ranked
  rows carry an inline "Add Friend" button.
- `iron-id.tsx` — the player's own profile: rating, stats, trophy case, match history,
  built from `iron_id_pro_stage_animated`. Real `BottomNav` destination for the
  "Profile" tab. Hosts the entry points into Bands/Friends/Messages/Front Row (Friends/
  Messages cards badge the pending-request / unread counts) and shows the player's own
  **friend code**.
- `bands.tsx` — clubs hub (my band, browse/join, global top 5), built from
  `bands_pro_stage_animated`. Still mock (no bands backend).
- `friends.tsx` — **real** friends feature. Friend list with live presence
  (online/in-game/offline via the socket), incoming/outgoing requests, add-by-friend-
  code, per-row Challenge (→ realtime `friend:challenge`, 3/5/10m picker) / Message /
  Remove. Guests get a sign-in prompt. Backed by `useFriends()` + `useChallenges()`
  (`src/hooks/`), the friend/DM REST routes in `server/src/auth.ts`, and the
  `friend:*` / `dm:*` socket protocol in `server/src/index.ts`. Original Stitch comp
  `friends_pro_stage_animated`.
- `messages.tsx` — **real** out-of-game DMs. Conversation list from `useFriends()`
  with unread badges + presence; thread view opened by `?userId=` param or tap, history
  via `GET /me/conversations/:userId/messages`, live append on `dm:message`, send via
  the `dm:send` socket event. Friends-only. Original Stitch comp
  `messages_pro_stage_animated`.
- `front-row.tsx` — live spectate screen. Reuses the shared `ChessBoard` component
  (`src/components/ui/ChessBoard.tsx`, extracted out of `(play)/match.tsx`) for the
  board instead of the source's throwaway decorative grid, built from
  `front_row_pro_stage_animated`. Still mock — spectating is deliberately deferred; the
  friends list's "in-game" status is real but "Watch" is not wired.

## Friends feature wiring (cross-cutting)

- **Client state**: `src/hooks/useFriends.tsx` (friends / requests / conversations /
  presence + REST actions) and `src/hooks/useChallenges.tsx` (the realtime challenge
  handshake + navigation into `/match`) are both providers mounted once in
  `src/app/_layout.tsx`, alongside the global `<ChallengeModals />`
  (`src/components/friends/`). They are the single place the `friend:*` / `dm:message`
  socket events are listened to.
- **REST**: `src/lib/api.ts` wrappers → `server/src/auth.ts` (`/me/friends*`,
  `/me/conversations*`); logic in `server/src/db/friends.ts` + `directMessages.ts`.
- **Realtime**: `src/lib/friendsSocket.ts` emit helpers → `server/src/index.ts`
  handlers; per-user targeting + presence in `server/src/realtime.ts`; challenge
  rendezvous in `server/src/challenge.ts`.
- **Friend code**: `player_profiles.friend_code`, generated in `server/src/betterAuth.ts`'s
  user-create hook, shown on `iron-id.tsx`.
