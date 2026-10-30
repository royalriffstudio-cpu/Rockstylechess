import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getFestival, type FestivalStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

// The player's Festival state (tiers, unlocks, today's runs, the active run), refetched
// whenever the screen regains focus: a set ends, you come back, the run has moved.
export function useFestival(): { festival: FestivalStatus | null; error: boolean; reload: () => Promise<void> } {
  const { status } = usePlayerProfile();
  const [festival, setFestival] = useState<FestivalStatus | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      setFestival(await getFestival(token));
      setError(false);
    } catch (e) {
      console.log('Failed to load the Festival', e);
      setError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (status === 'ready') void reload();
    }, [status, reload]),
  );

  return { festival, error, reload };
}
