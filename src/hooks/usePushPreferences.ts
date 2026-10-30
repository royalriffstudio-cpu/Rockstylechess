import { useCallback, useEffect, useState } from 'react';

import { getPushPreferences, updatePushPreferences, type PushPreferences } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

const ALL_ON: PushPreferences = { social: true, invites: true, results: true, daily: true };

// The four push category switches (server/src/db/pushPrefs.ts). Optimistic: the switch moves at once and rolls
// back if the server refuses, so a flaky connection never leaves it lying.
export function usePushPreferences(enabled: boolean) {
  const [prefs, setPrefs] = useState<PushPreferences>(ALL_ON);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        const { preferences } = await getPushPreferences(token);
        if (alive) {
          setPrefs(preferences);
          setLoaded(true);
        }
      } catch (error) {
        console.log('Failed to load push preferences', error);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  const setPref = useCallback(
    async (key: keyof PushPreferences, value: boolean) => {
      const before = prefs[key];
      setPrefs((p) => ({ ...p, [key]: value }));
      try {
        const token = await getAuthToken();
        if (!token) throw new Error('unauthorized');
        const { preferences } = await updatePushPreferences(token, { [key]: value });
        setPrefs(preferences);
      } catch (error) {
        console.log('Failed to save push preference', error);
        setPrefs((p) => ({ ...p, [key]: before }));
      }
    },
    [prefs],
  );

  return { prefs, loaded, setPref };
}
