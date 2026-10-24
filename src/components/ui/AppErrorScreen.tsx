import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { RockButton } from '@/components/ui/RockButton';
import { RockCard } from '@/components/ui/RockCard';
import { Colors } from '@/constants/theme';
import { reportError } from '@/lib/crashReporting';

// What a render error shows instead of killing the app (expo-router's root `ErrorBoundary`
// export in src/app/_layout.tsx). It sits outside the app's providers, so it uses only theme
// colours and the plain router: no hooks that need a provider.
export function AppErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    reportError(error, { area: 'render-boundary' });
  }, [error]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bgBase, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <RockCard variant="surface" glowColor={Colors.crimson} contentPadding={20} style={{ width: '100%', maxWidth: 360 }}>
        <View style={{ gap: 14, alignItems: 'center' }}>
          <Text style={{ color: Colors.textPrimary, fontSize: 22, fontWeight: '800', textTransform: 'uppercase', textAlign: 'center' }}>Something went wrong</Text>
          <Text style={{ color: Colors.textMuted, fontSize: 14, textAlign: 'center' }}>
            The screen hit an unexpected error. A report was sent so we can fix it. Your chips and progress are safe.
          </Text>
          <View style={{ width: '100%', gap: 10 }}>
            <RockButton label="Try again" variant="primary" onPress={() => void retry()} />
            <RockButton label="Go to Home" variant="secondary" onPress={() => router.replace('/home')} />
          </View>
        </View>
      </RockCard>
    </View>
  );
}
