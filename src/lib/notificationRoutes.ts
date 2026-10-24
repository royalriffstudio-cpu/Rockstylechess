import type { Href } from 'expo-router';

// Where a notification leads, shared by the Backstage Alerts feed (tap a row) and push (tap the banner) so the
// two can never disagree. `kind` is the stored notification type, a synthetic feed kind, or a push-only kind.
export function hrefForNotification(kind: string, payload: Record<string, unknown> = {}): Href | null {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  switch (kind) {
    case 'friend_request_received':
    case 'friend_request_accepted':
    case 'friend_challenge_received':
      return '/friends';
    case 'dm': {
      const userId = str(payload.fromUserId);
      return userId ? { pathname: '/messages', params: { userId } } : '/friends';
    }
    case 'match_ended': {
      const matchId = str(payload.matchId);
      if (!matchId) return null;
      return {
        pathname: '/replay',
        params: {
          matchId,
          opponentDisplayName: str(payload.opponentDisplayName),
          resultType: str(payload.resultType),
          color: str(payload.color),
          playedAt: str(payload.playedAt),
        },
      };
    }
    case 'quest_claimable':
      return '/quests';
    case 'achievement_claimable':
      return '/achievements';
    case 'daily_bonus_claimable':
    case 'daily':
      return '/daily-bonus';
    default:
      return null;
  }
}
