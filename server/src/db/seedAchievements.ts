import '../env.js';

import { ACHIEVEMENT_SEED } from '../achievementCatalog.js';
import { db } from './client.js';
import { achievements } from './schema/index.js';

// Standalone, idempotent (upsert, not insert-only) -- mirrors
// seedQuests.ts's exact pattern. Not run automatically on server boot.
async function main() {
  for (const achievement of ACHIEVEMENT_SEED) {
    await db
      .insert(achievements)
      .values(achievement)
      .onConflictDoUpdate({
        target: achievements.id,
        set: {
          title: achievement.title,
          description: achievement.description,
          icon: achievement.icon,
          target: achievement.target,
          rewardType: achievement.rewardType,
          rewardAmount: achievement.rewardAmount,
          featured: achievement.featured,
          metric: achievement.metric,
        },
      });
  }
  console.log(`Seeded ${ACHIEVEMENT_SEED.length} achievements.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
