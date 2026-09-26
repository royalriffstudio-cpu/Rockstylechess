import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { Colors, withOpacity } from '@/constants/theme';

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'matchmaking',
    question: "Why can't I find an online match?",
    answer:
      "Online matches pair you with another player currently queued in the same venue tier. If nobody else is queued, you'll keep waiting -- try a lower venue tier, or play a Bot match instead while you wait.",
  },
  {
    id: 'bots',
    question: 'How do the bot difficulties differ?',
    answer:
      'Easy and Medium are lightweight in-app engines. The three hardest bots run the real Stockfish engine at increasing search depth, so they play genuinely stronger chess the higher you go.',
  },
  {
    id: 'chips-gems',
    question: "What's the difference between chips and gems?",
    answer:
      'Chips are earned by playing matches and are the main in-app currency. Gems are the premium currency used for cosmetics in the Forge. Both are earned through play -- neither can currently be purchased.',
  },
  {
    id: 'rating',
    question: 'How is my rating calculated?',
    answer:
      'Your rating changes after each ranked online match based on the result and your opponent\'s rating, shown on the Result screen and in your Match History. Bot and local pass-and-play matches don\'t affect rating.',
  },
  {
    id: 'friends',
    question: 'How do I add a friend?',
    answer:
      'Share your Friend Code (find it in your profile) with another player, or add them from the World Rankings or a Match Result screen. Once accepted, you can chat, challenge, and see when they\'re online.',
  },
  {
    id: 'country-flag',
    question: 'How do I set my country flag?',
    answer: 'Go to Settings -> Account & Security -> Country, and pick your country from the list. It shows next to your name everywhere, including live matches.',
  },
  {
    id: 'puzzles',
    question: 'Does solving puzzles save my progress?',
    answer:
      "Yes -- solved puzzles are tracked on this device so you can pick up where you left off. Puzzle progress isn't synced across devices yet.",
  },
  {
    id: 'report-block',
    question: 'Someone was abusive or cheating -- what can I do?',
    answer:
      'Use "Report a Player" below, or block someone directly from your Friends list. Blocking immediately stops them from messaging or challenging you.',
  },
];

export default function FaqScreen() {
  const insets = useSafeAreaInsets();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="FAQ" />
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-3xl gap-sm px-lg py-xl"
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {FAQ_ENTRIES.map((entry) => {
          const isExpanded = expandedId === entry.id;
          return (
            <Pressable
              key={entry.id}
              onPress={() => setExpandedId(isExpanded ? null : entry.id)}
              className="overflow-hidden rounded-lg p-md"
              style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
            >
              <View className="flex-row items-center justify-between gap-sm">
                <Text className="flex-1 font-heading-md text-text-primary" style={{ fontSize: 14 }}>
                  {entry.question}
                </Text>
                <MaterialCommunityIcons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Colors.textMuted}
                />
              </View>
              {isExpanded ? (
                <Text className="mt-sm font-body-sm text-text-muted" style={{ fontSize: 13, lineHeight: 19 }}>
                  {entry.answer}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
