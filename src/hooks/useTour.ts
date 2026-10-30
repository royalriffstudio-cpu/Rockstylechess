import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getTour, type TourStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

// The player's Tour progress, refetched every time the screen regains focus (a
// match ends, you come back, the gigs have moved).
export function useTour(): { tour: TourStatus | null; error: boolean; reload: () => Promise<void> } {
  const { status } = usePlayerProfile();
  const [tour, setTour] = useState<TourStatus | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      setTour(await getTour(token));
      setError(false);
    } catch (e) {
      console.log('Failed to load the Tour', e);
      setError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (status === 'ready') void reload();
    }, [status, reload]),
  );

  return { tour, error, reload };
}
