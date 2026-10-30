import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { CurrencyIcon, RockButton, RockCard } from '@/components/ui';
import { ReviewPackCard } from '@/components/shop/ReviewPackCard';
import { Colors, withOpacity } from '@/constants/theme';
import { useGear } from '@/hooks/useGear';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { activateGear, buyGear, type GearItemStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { GEAR_AMP_BONUS_PERCENT, LUCKY_PICK_MIN_STREAK } from '@/lib/gear';

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  'amp-boost': 'amplifier',
  'lucky-pick': 'guitar-pick',
};

// What each item does, in the game's own words. The numbers come from economy.config.json.
const DETAIL: Record<string, string> = {
  'amp-boost': `Crank it to 11. Your next 3 wins earn +${GEAR_AMP_BONUS_PERCENT}% Fame on top of every other bonus. It only speeds up your level, never your play.`,
  'lucky-pick': `A lucky guitar pick. If you lose while on a Hot Streak of ${LUCKY_PICK_MIN_STREAK}+ wins, your streak survives. Spent only when it actually saves one.`,
};

const ERRORS: Record<string, string> = {
  'insufficient-chips': 'Not enough chips.',
  'stock-full': 'Your bag is full.',
  'already-active': 'One is already active. Use it up first.',
  'none-in-bag': 'None in your bag.',
};

// The Gear tab of the Rock Shop: consumables bought with chips and switched on by the player. The
// server owns every rule (db/boosts.ts); this is the bag and its buttons.
export function GearPanel() {
  const { gear, error, reload } = useGear();
  const { chips, refresh: refreshProfile } = usePlayerProfile();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ itemId: string; text: string } | null>(null);

  async function run(item: GearItemStatus, action: 'buy' | 'activate') {
    if (busy) return;
    setBusy(`${action}:${item.id}`);
    setMessage(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('signed-out');
      if (action === 'buy') await buyGear(token, item.id);
      else await activateGear(token, item.id);
      await Promise.all([reload(), refreshProfile()]);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setMessage({ itemId: item.id, text: ERRORS[code] ?? "That didn't go through. Try again." });
      void reload();
    } finally {
      setBusy(null);
    }
  }

  if (!gear) {
    return error ? (
      <View className="items-center gap-md py-lg">
        <Text className="font-body-base text-body-base text-text-muted">Couldn&apos;t open your gear bag.</Text>
        <RockButton label="Retry" variant="primary" onPress={() => void reload()} />
      </View>
    ) : (
      <ActivityIndicator color={Colors.cyan} style={{ marginTop: 24 }} />
    );
  }

  return (
    <View className="gap-md">
      <Text className="font-display-hero text-headline-lg uppercase text-cyan" style={{ fontSize: 18 }}>
        Backstage Gear
      </Text>
      <Text className="font-body-sm text-body-sm text-text-muted">
        Buy it here, switch it on when you want it. Gear never changes how a game is played, only what you get out of it.
      </Text>

      {gear.items.map((item) => {
        const active = item.activeCharges > 0;
        const canAfford = chips >= item.price;
        return (
          <RockCard key={item.id} glowColor={active ? Colors.gold : Colors.chromeDark} innerGlow={active ? Colors.gold : Colors.cyan}>
            <View className="gap-sm">
              <View className="flex-row items-center gap-md">
                <View className="items-center justify-center rounded-sm" style={{ width: 44, height: 44, backgroundColor: withOpacity(active ? Colors.gold : Colors.cyan, 0.14) }}>
                  <MaterialCommunityIcons name={ICONS[item.id] ?? 'star'} size={26} color={active ? Colors.gold : Colors.cyan} />
                </View>
                <View className="flex-1">
                  <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 15 }}>
                    {item.name}
                  </Text>
                  <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                    {item.tagline}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
                    {item.quantity} / {gear.maxStock}
                  </Text>
                  <Text className="font-caption text-text-muted" style={{ fontSize: 10 }}>
                    IN BAG
                  </Text>
                </View>
              </View>

              <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                {DETAIL[item.id]}
              </Text>

              {active ? (
                <View className="flex-row items-center gap-xs">
                  {Array.from({ length: item.charges }, (_, i) => (
                    <View
                      key={i}
                      style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: i < item.activeCharges ? Colors.gold : 'transparent', borderWidth: 1, borderColor: Colors.gold }}
                    />
                  ))}
                  <Text className="font-heading-md text-gold" style={{ fontSize: 12, marginLeft: 6 }}>
                    {item.id === 'lucky-pick' ? 'ARMED' : `ACTIVE · ${item.activeCharges} WIN${item.activeCharges === 1 ? '' : 'S'} LEFT`}
                  </Text>
                </View>
              ) : null}

              <View className="flex-row items-center gap-sm">
                <View className="flex-1">
                  <RockButton
                    label={active ? 'Active' : item.quantity > 0 ? 'Activate' : 'None in bag'}
                    variant="cyan"
                    disabled={active || item.quantity === 0 || busy !== null}
                    loading={busy === `activate:${item.id}`}
                    onPress={() => void run(item, 'activate')}
                  />
                </View>
                <View className="flex-1">
                  <RockButton
                    label={item.atCap ? 'Bag full' : `Buy · ${item.price}`}
                    variant="primary"
                    icon={item.atCap ? undefined : <CurrencyIcon type="chips" size={16} />}
                    disabled={item.atCap || !canAfford || busy !== null}
                    loading={busy === `buy:${item.id}`}
                    onPress={() => void run(item, 'buy')}
                  />
                </View>
              </View>
              {!canAfford && !item.atCap ? (
                <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.crimson }}>
                  {item.price - chips} more chips needed.
                </Text>
              ) : null}
              {message?.itemId === item.id ? (
                <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.crimson }}>
                  {message.text}
                </Text>
              ) : null}
            </View>
          </RockCard>
        );
      })}

      <ReviewPackCard />

      <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.ember}>
        <View className="flex-row items-center gap-md">
          <View className="items-center justify-center rounded-sm" style={{ width: 44, height: 44, backgroundColor: withOpacity(Colors.ember, 0.14) }}>
            <MaterialCommunityIcons name="lifebuoy" size={26} color={Colors.ember} />
          </View>
          <View className="flex-1">
            <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 15 }}>
              Safety Net
            </Text>
            <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
              Not stocked: offered on the Match Setup screen at every venue with a buy-in. Pay a premium up front and a loss pays part of your buy-in back. Never the whole of it.
            </Text>
          </View>
        </View>
      </RockCard>
    </View>
  );
}
