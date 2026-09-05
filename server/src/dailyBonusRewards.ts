export interface DailyBonusReward {
  day: number; // 1-7
  chips: number;
  gems: number;
  label: string;
}

// Mirrors src/lib/dailyBonusRewards.ts on the client (used there for the
// daily-bonus.tsx day-card labels/count-up display). This copy is the
// authoritative one -- claimDailyBonus (db/dailyBonus.ts) grants these
// amounts, never a client-supplied number. Kept safely under
// MATCH_CHIP_REWARDS.win (475,000) so a daily login never out-earns actually
// playing and winning a match. Keep the two files in sync if these change.
export const DAILY_BONUS_REWARDS: DailyBonusReward[] = [
  { day: 1, chips: 50, gems: 0, label: '50 Chips' },
  { day: 2, chips: 75, gems: 0, label: '75 Chips' },
  { day: 3, chips: 0, gems: 3, label: '3 Gems' },
  { day: 4, chips: 100, gems: 0, label: '100 Chips' },
  { day: 5, chips: 0, gems: 5, label: '5 Gems' },
  { day: 6, chips: 150, gems: 5, label: 'Gift Box' },
  { day: 7, chips: 300, gems: 15, label: 'Grand Jackpot' },
];
