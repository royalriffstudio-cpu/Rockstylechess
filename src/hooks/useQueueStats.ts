import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getQueueStats } from '@/lib/api';

const POLL_MS = 6000;

// Players waiting per time control at a venue, refreshed every few seconds while the screen is focused
// (display only: it tells a player which clock will find a game fastest). null until the first answer.
export function useQueueStats(venueTier: string): Record<'3m' | '5m' | '10m', number> | null {
  const [waiting, setWaiting] = useState<Record<'3m' | '5m' | '10m', number> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const load = async () => {
        try {
          const stats = await getQueueStats(venueTier);
          if (!cancelled) setWaiting(stats.waiting);
        } catch {
          if (!cancelled) setWaiting(null);
        }
      };
      void load();
      const timer = setInterval(load, POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [venueTier]),
  );

  return waiting;
}
