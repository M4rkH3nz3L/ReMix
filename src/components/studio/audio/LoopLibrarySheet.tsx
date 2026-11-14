import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { LOOP_CATEGORIES, loopsIn, type BuiltinLoop, type LoopCategory } from '@/lib/loopLibrary';

/**
 * 🔁 V2: beépített loopok — a telefon a projekt tempóján süti ki (offline, ingyen); a kiválasztott loop a
 * lejátszófejnél egy klip lesz a hozzá tartozó, szerkeszthető mintával (egy undo-lépés).
 */
export function LoopLibrarySheet({ bpm, busyId, onPick, onClose }: { bpm: number; busyId: string | null; onPick: (loop: BuiltinLoop) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [cat, setCat] = useState<LoopCategory>('drums');
  const icon = (c: LoopCategory) => (c === 'drums' ? 'grid-outline' : c === 'bass' ? 'pulse-outline' : c === 'chords' ? 'layers-outline' : 'musical-note-outline');
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.closeSheet')} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.audio.loops.title')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>
          <Text style={styles.hint}>{t('studio.audio.loops.hint', { bpm: Math.round(bpm) })}</Text>
          <View style={styles.chips}>
            {LOOP_CATEGORIES.map((c) => (
              <Chip key={c} label={t(`studio.audio.loops.cat.${c}`)} active={cat === c} onPress={() => setCat(c)} />
            ))}
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {loopsIn(cat).map((l) => {
              const name = t(`studio.audio.loops.name.${l.id}`);
              return (
                <Pressable
                  key={l.id}
                  testID={`loop-${l.id}`}
                  onPress={() => onPick(l)}
                  disabled={busyId !== null}
                  style={[styles.row, busyId !== null && busyId !== l.id && { opacity: 0.5 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('studio.audio.loops.a11y', { name })}
                >
                  <Ionicons name={icon(l.category)} size={18} color={palette.accent} />
                  <Text style={styles.rowText}>{name}</Text>
                  {l.key ? <Text style={styles.key}>{l.key}</Text> : null}
                  {busyId === l.id ? <ActivityIndicator size="small" color={palette.accent} /> : <Ionicons name="add-circle-outline" size={20} color={palette.textDim} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  tap: { flex: 1 },
  sheet: { backgroundColor: '#0b0d14', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, maxHeight: '80%', borderTopWidth: 1, borderColor: palette.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 12, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceHigh, marginBottom: 8 },
  rowText: { color: palette.text, fontSize: 14, fontWeight: '700', flex: 1 },
  key: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
});
