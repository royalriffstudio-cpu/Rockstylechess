import { eq } from 'drizzle-orm';

import { db } from './client.js';
import { matches, users } from './schema/index.js';

// Shared by the in-app `DELETE /me` route (auth.ts) and deleteAccountByEmail.ts
// (the CLI fallback for a web/email-based deletion request -- see
// docs/data-deletion.html) so both entry points delete exactly the same way.
//
// matches.white/blackUserId deliberately has no onDelete cascade (see
// db/schema/matches.ts) -- deleting a user who's played matches should
// preserve the match/rating record for whoever they played against, not
// force it to vanish too. Null out the reference on those rows instead of
// deleting them; everything else that's actually this user's own data
// (profile, their own match_participants rows, friendships, messages,
// purchases, cosmetics, progression -- all `onDelete: 'cascade'`) goes via
// the users row cascade below. One transaction so a mid-way failure can't
// leave a half-deleted account.
export async function deleteUserAccount(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(matches).set({ whiteUserId: null }).where(eq(matches.whiteUserId, userId));
    await tx.update(matches).set({ blackUserId: null }).where(eq(matches.blackUserId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}
