import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { LOOP_CATEGORIES, loopsIn, type BuiltinLoop, type LoopCategory } from '@/lib/loopLibrary';
import { logCaught } from '@/lib/logCaught';
import { fetchSoundLibrary, type LibraryTrack } from '@/lib/render';
import { useEntitlement } from '@/store/entitlementStore';

/**
 * 🔁 V2: beépített loopok — a telefon a projekt tempóján süti ki (offline, ingyen); a kiválasztott loop a
 * lejátszófejnél egy klip lesz a hozzá tartozó, szerkeszthető mintával (egy undo-lépés).
 */
export function LoopLibrarySheet({
  bpm,
  busyId,
  onPick,
  onPickCloud,
  onClose,
}: {
  bpm: number;
  busyId: string | null;
  onPick: (loop: BuiltinLoop) => void;
  /** 🔁 V2.2: a szerveres teljes könyvtár zenéje (Pro; a hívó nyitja a Pro-ajánlatot) */
  onPickCloud?: (track: LibraryTrack) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cat, setCat] = useState<LoopCategory>('drums');
  const isPro = useEntitlement((s) => s.isPro());
  // a felhő-könyvtár listája (böngészhető mindenkinek; a letöltés Pro) — felhő nélkül csendben üres
  const [cloud, setCloud] = useState<LibraryTrack[] | null>(null);
  useEffect(() => {
    if (!onPickCloud) return;
    let alive = true;
    fetchSoundLibrary()
      .then((tracks) => alive && setCloud(tracks.filter((x) => x.kind === 'music')))
      .catch((caught) => {
        logCaught('components/studio/audio/LoopLibrarySheet.tsx:cloud', caught);
        if (alive) setCloud([]);
      });
    return () => {
      alive = false;
    };
  }, [onPickCloud]);
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
            {onPickCloud && cloud && cloud.length > 0 ? (
              <>
                <View style={styles.cloudHead}>
                  <Ionicons name="cloud-outline" size={14} color={palette.textDim} />
                  <Text style={styles.cloudTitle}>{t('studio.audio.loops.cloud')}</Text>
                  {!isPro ? <Text style={styles.pro}>PRO</Text> : null}
                </View>
                {cloud.map((tr) => (
                  <Pressable
                    key={tr.id}
                    testID={`cloud-${tr.id}`}
                    onPress={() => onPickCloud(tr)}
                    disabled={busyId !== null}
                    style={[styles.row, busyId !== null && busyId !== tr.id && { opacity: 0.5 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('studio.audio.loops.a11y', { name: tr.name })}
                  >
                    <Ionicons name="musical-notes-outline" size={18} color={palette.accent2} />
                    <Text style={styles.rowText} numberOfLines={1}>{tr.name}</Text>
                    {tr.bpm ? <Text style={styles.key}>{Math.round(tr.bpm)} BPM</Text> : null}
                    {busyId === tr.id ? <ActivityIndicator size="small" color={palette.accent} /> : <Ionicons name={isPro ? 'add-circle-outline' : 'lock-closed-outline'} size={18} color={palette.textDim} />}
                  </Pressable>
                ))}
              </>
            ) : null}
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
  cloudHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 8 },
  cloudTitle: { color: palette.textDim, fontSize: 12, fontWeight: '700', flex: 1 },
  pro: { color: '#fff', backgroundColor: palette.accent, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
});
