// Level/XP curve -- polynomial, total(L) = 300*L^2 for L >= 2, with level 1
// pinned to 0 XP (the raw formula would give total(1) = 300, which
// contradicts "everyone starts at 0 XP", so level 1 is a special-cased
// floor, not a plug-in value). Mirrored read-only in src/lib/leveling.ts on
// the client (xpForLevel/levelForXp/getLevelProgress only -- applyXpGain is
// a mutation helper and stays server-only, same reasoning as why level/xp
// are excluded from PATCH /me/profile's patchable fields). See
// server/README.md's Database section for the full writeup.
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 300 * level * level;
}

// Inverts xpForLevel. Starts from the algebraic sqrt estimate, then nudges
// to the exact integer boundary -- necessary because floating-point error
// right at a threshold (e.g. xp exactly 1200) could otherwise resolve to
// the wrong level.
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  let level = Math.max(1, Math.floor(Math.sqrt(xp / 300)));
  while (xpForLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpForLevel(level) > xp) level -= 1;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned since this level's own threshold. */
  xpIntoLevel: number;
  /** XP span from this level's threshold to the next (not cumulative). */
  xpForNextLevel: number;
  /** xpIntoLevel / xpForNextLevel, clamped to [0, 1]. */
  progress: number;
}

export function getLevelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const span = xpForLevel(level + 1) - floor;
  const xpIntoLevel = Math.max(0, xp - floor);
  return {
    level,
    xpIntoLevel,
    xpForNextLevel: span,
    progress: span > 0 ? Math.min(1, xpIntoLevel / span) : 1,
  };
}

// Server-only mutation helper -- never exposed client-side. Callers pass
// the profile's current xp and the amount being granted. (Fame is now granted by
// db/progression.ts's grantFame, which keeps level in step with xp itself.)
export function applyXpGain(currentXp: number, xpGained: number): { xp: number; level: number } {
  const xp = Math.max(0, currentXp) + Math.max(0, xpGained);
  return { xp, level: levelForXp(xp) };
}
