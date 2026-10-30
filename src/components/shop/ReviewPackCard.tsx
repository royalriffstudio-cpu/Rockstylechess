import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { CurrencyIcon, RockButton, RockCard } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { buyAnalysisPack } from '@/lib/api';
import { ANALYSIS_COST, ANALYSIS_PACK, packSavings } from '@/lib/analysisCost';
import { getAuthToken } from '@/lib/authStorage';

const ERRORS: Record<string, string> = {
  'insufficient-funds': 'Not enough for that.',
  'stock-full': `You can hold up to ${ANALYSIS_PACK.maxCredits} stored reviews. Use a few first.`,
};

// Game Reviews in bulk: ten at once for less than ten singles. Reviews are stored as credits on the
// player and spent by the Analyze Game button before any chips or gems; the server owns the rules
// (db/analysisCharge.ts). Lives in the Shop's Gear tab.
export function ReviewPackCard() {
  const { chips, gems, profile, refresh } = usePlayerProfile();
  const [busy, setBusy] = useState<'chips' | 'gems' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const credits = profile?.analysisCredits ?? 0;
  const full = credits + ANALYSIS_PACK.reviews > ANALYSIS_PACK.maxCredits;
  const chipSave = packSavings('chips');
  const gemSave = packSavings('gems');

  async function buy(currency: 'chips' | 'gems') {
    if (busy) return;
    setBusy(currency);
    setMessage(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('signed-out');
      await buyAnalysisPack(token, currency);
      await refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setMessage(ERRORS[code] ?? "That didn't go through. Try again.");
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.cyan}>
      <View className="gap-sm">
        <View className="flex-row items-center gap-md">
          <View className="items-center justify-center rounded-sm" style={{ width: 44, height: 44, backgroundColor: withOpacity(Colors.cyan, 0.14) }}>
            <MaterialCommunityIcons name="chart-timeline-variant" size={26} color={Colors.cyan} />
          </View>
          <View className="flex-1">
            <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 15 }}>
              Review Pack
            </Text>
            <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
              {ANALYSIS_PACK.reviews} Game Reviews at once. Save {chipSave.percent}% on every one.
            </Text>
          </View>
          <View className="items-end">
            <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
              {credits} / {ANALYSIS_PACK.maxCredits}
            </Text>
            <Text className="font-caption text-text-muted" style={{ fontSize: 10 }}>
              STORED
            </Text>
          </View>
        </View>

        <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
          A single review is {ANALYSIS_COST.chips.toLocaleString('en-US')} chips or {ANALYSIS_COST.gems} gems. In a pack that is {chipSave.each.toLocaleString('en-US')} chips or {gemSave.each} gems each. Stored reviews never expire and are used before any chips or gems.
        </Text>

        <View className="flex-row items-center gap-sm">
          <View className="flex-1">
            <RockButton
              label={full ? 'Full' : `${ANALYSIS_PACK.chips.toLocaleString('en-US')}`}
              variant="primary"
              icon={full ? undefined : <CurrencyIcon type="chips" size={16} />}
              disabled={full || chips < ANALYSIS_PACK.chips || busy !== null}
              loading={busy === 'chips'}
              onPress={() => void buy('chips')}
            />
          </View>
          <View className="flex-1">
            <RockButton
              label={full ? 'Full' : `${ANALYSIS_PACK.gems}`}
              variant="cyan"
              icon={full ? undefined : <CurrencyIcon type="gems" size={16} />}
              disabled={full || gems < ANALYSIS_PACK.gems || busy !== null}
              loading={busy === 'gems'}
              onPress={() => void buy('gems')}
            />
          </View>
        </View>
        {message ? (
          <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.crimson }}>
            {message}
          </Text>
        ) : null}
      </View>
    </RockCard>
  );
}
