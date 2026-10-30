import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppIcon, RockButton, RockCard } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { hasSeenPushPrimer, markPushPrimerSeen } from '@/lib/pushRegistration';

// One-time, low-pressure ask for notification permission, shown under the result buttons after a finished game
// (the moment a player first has a reason to care), instead of the system prompt firing at launch. Appears only
// for a signed-in player whose permission is still undecided and who has not seen it before; either answer
// retires it for good. Later, Control Core -> Push Notifications is where it can be changed.
export function PushPrimer() {
  const { status } = usePlayerProfile();
  const { permission, enable } = usePushNotifications();
  const [seen, setSeen] = useState(true); // assume seen until storage says otherwise: no flash for people who did
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void hasSeenPushPrimer().then((v) => alive && setSeen(v));
    return () => {
      alive = false;
    };
  }, []);

  if (status !== 'ready' || permission !== 'undetermined' || seen) return null;

  async function turnOn() {
    if (busy) return;
    setBusy(true);
    await markPushPrimerSeen();
    await enable();
    setSeen(true);
  }

  function notNow() {
    void markPushPrimerSeen();
    setSeen(true);
  }

  return (
    <RockCard variant="surface" contentPadding={16}>
      <View className="items-center gap-sm">
        <AppIcon name="notifications" size={26} color={Colors.gold} />
        <Text className="text-center font-heading-md text-heading-md text-text-primary">Never miss a challenge</Text>
        <Text className="text-center font-body-sm text-body-sm text-text-muted">
          Get a ping when a friend challenges you, messages you, or your daily bonus is waiting. Change it any time in settings.
        </Text>
        <RockButton label={busy ? 'Asking…' : 'Turn on notifications'} variant="gold" disabled={busy} onPress={() => void turnOn()} />
        <Pressable onPress={notNow} hitSlop={10}>
          <Text className="font-body-sm text-body-sm text-text-muted" style={{ textDecorationLine: 'underline' }}>
            Not now
          </Text>
        </Pressable>
      </View>
    </RockCard>
  );
}
