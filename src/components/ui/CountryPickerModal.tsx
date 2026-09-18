import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';
import { COUNTRIES, type CountryOption } from '@/constants/countries';
import { CountryFlag } from './CountryFlag';

const CARD_HEIGHT = Dimensions.get('window').height * 0.72;

interface CountryPickerModalProps {
  visible: boolean;
  selectedCode?: string | null;
  onSelect: (code: string) => void;
  onClose: () => void;
}

// Shared by onboarding (pick-rockstar.tsx) and settings (account-security.tsx)
// -- a searchable list of the full ~250-entry ISO-3166-1 catalog. First
// FlatList in the codebase (everywhere else is a small .map()'d ScrollView),
// justified here by the list size -- virtualization is the point.
export function CountryPickerModal({ visible, selectedCode, onSelect, onClose }: CountryPickerModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [query]);

  function handleClose() {
    setQuery('');
    onClose();
  }

  function renderItem({ item }: { item: CountryOption }) {
    const isSelected = item.code === selectedCode;
    return (
      <Pressable
        onPress={() => {
          onSelect(item.code);
          handleClose();
        }}
        style={[styles.row, isSelected && styles.rowSelected]}
      >
        <CountryFlag code={item.code} size={20} />
        <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>{item.name}</Text>
        {isSelected ? <MaterialCommunityIcons name="check" size={18} color={Colors.cyan} /> : null}
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.cardWrap}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Select Country</Text>
              <Pressable onPress={handleClose} style={styles.closeButton}>
                <MaterialCommunityIcons name="close" size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.searchRow}>
              <MaterialCommunityIcons name="magnify" size={18} color={Colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search countries..."
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Text style={styles.emptyText}>No countries match &quot;{query}&quot;</Text>}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// #region Styles
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: withOpacity(Colors.bgBase, 0.8),
  },
  cardWrap: {
    width: '100%',
    maxWidth: 400,
    height: CARD_HEIGHT,
  },
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: withOpacity(Colors.cyan, 0.3),
    backgroundColor: Colors.bgPanel,
    padding: Spacing.lg,
    boxShadow: `0px 10px 25px ${withOpacity(Colors.cyan, 0.25)}`,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.md,
    marginBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: withOpacity(Colors.chromeDark, 0.3),
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  rowSelected: {
    backgroundColor: withOpacity(Colors.cyan, 0.12),
  },
  rowText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  rowTextSelected: {
    color: Colors.cyan,
    fontWeight: '600',
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});
// #endregion
