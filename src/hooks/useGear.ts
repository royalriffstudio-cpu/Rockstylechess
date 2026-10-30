import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getGear, type GearStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

// The player's Backstage Gear bag (stock + the copy that is active), refetched whenever the screen
// regains focus -- a match spends charges, so what was true when you left is stale when you return.
export function useGear(): { gear: GearStatus | null; error: boolean; reload: () => Promise<void> } {
  const { status } = usePlayerProfile();
  const [gear, setGear] = useState<GearStatus | null>(null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      setGear(await getGear(token));
      setError(false);
    } catch (e) {
      console.log('Failed to load Backstage Gear', e);
      setError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (status === 'ready') void reload();
    }, [status, reload]),
  );

  return { gear, error, reload };
}
