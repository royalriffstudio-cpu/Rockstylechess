import type { ImageSourcePropType } from 'react-native';

// Single source of truth for every selectable player avatar in the game.
// Both (auth)/pick-rockstar.tsx (onboarding picker) and (shop)/forge.tsx
// (shop/equip screen) render this same list, so a new avatar only needs to
// be added here once to show up consistently everywhere. `id` is also the
// value persisted as `avatarId` on the player's profile (see
// server/src/db/schema/users.ts), so it must stay unique and stable --
// never change an existing avatar's id once shipped.
//
// The artwork is 12 neon rock badges sliced from
// assets/avatar/avatar_rock_12pcs_set.png by scripts/split-avatars.mjs
// (one committed PNG per id). Rendered through <PlayerAvatar source={...} />.
export interface AvatarOption {
  id: string;
  name: string;
  image: ImageSourcePropType;
  locked: boolean;
  gemPrice?: number;
}

export const AVATARS: AvatarOption[] = [
  { id: 'axe', name: 'AXE', image: require('../../assets/avatar/axe.png'), locked: false },
  { id: 'nova', name: 'NOVA', image: require('../../assets/avatar/nova.png'), locked: false },
  { id: 'riff', name: 'RIFF', image: require('../../assets/avatar/riff.png'), locked: false },
  { id: 'axl', name: 'AXL', image: require('../../assets/avatar/axl.png'), locked: false },
  { id: 'blaze', name: 'BLAZE', image: require('../../assets/avatar/blaze.png'), locked: false },
  { id: 'beats', name: 'BEATS', image: require('../../assets/avatar/beats.png'), locked: false },
  { id: 'mic-drop', name: 'MIC DROP', image: require('../../assets/avatar/mic-drop.png'), locked: false },
  { id: 'synth', name: 'SYNTH', image: require('../../assets/avatar/synth.png'), locked: false },
  { id: 'reaper', name: 'REAPER', image: require('../../assets/avatar/reaper.png'), locked: false },
  { id: 'king', name: 'KING', image: require('../../assets/avatar/king.png'), locked: false },
  { id: 'rebel', name: 'REBEL', image: require('../../assets/avatar/rebel.png'), locked: false },
  // Not "king-axl" -- that id/name is already the strongest bot in
  // (play)/bots.tsx ("King Axl", stockfish-strong); reusing it for a
  // selectable avatar would be confusing, so this is a distinct character.
  { id: 'legend', name: 'LEGEND', image: require('../../assets/avatar/legend.png'), locked: false },
];

const AVATAR_IMAGE: Record<string, ImageSourcePropType> = AVATARS.reduce(
  (map, avatar) => ({ ...map, [avatar.id]: avatar.image }),
  {} as Record<string, ImageSourcePropType>,
);

// Shown for accounts with no avatarId set yet -- true for every account
// created before pick-rockstar's avatar step existed. 'riff' is the rock
// hand, i.e. the old '🤘' default this replaced.
export const DEFAULT_AVATAR_IMAGE: ImageSourcePropType = require('../../assets/avatar/riff.png');

export function getAvatarImage(avatarId: string | null | undefined): ImageSourcePropType {
  if (!avatarId) return DEFAULT_AVATAR_IMAGE;
  return AVATAR_IMAGE[avatarId] ?? DEFAULT_AVATAR_IMAGE;
}
