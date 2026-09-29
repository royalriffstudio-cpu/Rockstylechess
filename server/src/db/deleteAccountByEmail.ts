import '../env.js';

import { eq } from 'drizzle-orm';

import { deleteUserAccount } from './accountDeletion.js';
import { db } from './client.js';
import { users } from './schema/index.js';

// Fulfills a web/email-based deletion request from someone who can't (or no
// longer can) access the app -- see docs/data-deletion.html. Not run
// automatically; the developer runs this by hand against whichever database
// the request concerns, same operational shape as the seed*.ts scripts.
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run delete-account -- <email>');
    process.exit(1);
  }

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    console.log(`No account found for ${email} -- nothing to delete.`);
    process.exit(0);
  }

  await deleteUserAccount(user.id);
  console.log(`Deleted account and associated data for ${email}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
