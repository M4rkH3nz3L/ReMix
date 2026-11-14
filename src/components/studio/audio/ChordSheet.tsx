import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { chordName, NOTE_ROOTS, PROGRESSION_IDS, PROGRESSIONS, romanNumeral, type ChordProgressionId } from '@/lib/chords';
import type { MusicKey } from '@/lib/pitch';

export type ChordPart = 'chords' | 'bass' | 'arp' | 'drums';
export const CHORD_PARTS: readonly ChordPart[] = ['chords', 'bass', 'arp', 'drums'];

/**
 * 🎼 V3.1: akkordmenet — hangnem (alaphang + dúr/moll) és menet-minta; a kiválasztott részeket (akkordok, basszus,
 * arpeggio, dob) a telefon a projekt tempóján süti, egy undo-lépésben külön sávokra, szerkeszthető mintaként.
 */
export function ChordSheet({ bpm, busy, onPlace, onClose }: { bpm: number; busy: boolean; onPlace: (key: MusicKey, prog: ChordProgressionId, parts: ChordPart[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [root, setRoot] = useState(0);
  const [minor, setMinor] = useState(false);
  const [prog, setProg] = useState<ChordProgressionId>('pop');
  const [parts, setParts] = useState<ChordPart[]>([...CHORD_PARTS]);
  const key: MusicKey = { root, scale: minor ? 'naturalMinor' : 'major' };
  const degrees = PROGRESSIONS[prog];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.closeSheet')} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.audio.chords.title')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.section}>{t('studio.audio.chords.key')}</Text>
            <View style={styles.chips}>
              {NOTE_ROOTS.map((n, i) => (
                <Chip key={n} label={n} active={root === i} onPress={() => setRoot(i)} />
              ))}
            </View>
            <View style={styles.chips}>
              <Chip label={t('studio.audio.chords.major')} active={!minor} onPress={() => setMinor(false)} />
              <Chip label={t('studio.audio.chords.minor')} active={minor} onPress={() => setMinor(true)} />
            </View>
            <Text style={styles.section}>{t('studio.audio.chords.progression')}</Text>
            {PROGRESSION_IDS.map((id) => {
              const ds = PROGRESSIONS[id];
              const active = prog === id;
              return (
                <Pressable key={id} onPress={() => setProg(id)} style={[styles.row, active && styles.rowActive]} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={t(`studio.audio.chords.prog.${id}`)} testID={`chords-${id}`}>
                  <Text style={styles.rowTitle}>{t(`studio.audio.chords.prog.${id}`)}</Text>
                  <Text style={styles.rowSub}>
                    {ds.map((d) => romanNumeral(key, d)).join('–')} · {ds.map((d) => chordName(key, d)).join(' ')}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={styles.section}>{t('studio.audio.chords.parts')}</Text>
            <View style={styles.chips}>
              {CHORD_PARTS.map((p) => (
                <Chip key={p} label={t(`studio.audio.chords.part.${p}`)} active={parts.includes(p)} onPress={() => setParts((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))} />
              ))}
            </View>
            <Text style={styles.hint}>{t('studio.audio.chords.hint', { bpm: Math.round(bpm), bars: degrees.length })}</Text>
            <Pressable onPress={() => onPlace(key, prog, parts)} disabled={busy || parts.length === 0} style={[styles.place, (busy || parts.length === 0) && { opacity: 0.5 }]} accessibilityRole="button" testID="chords-place">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="layers-outline" size={16} color="#fff" />}
              <Text style={styles.placeText}>{t('studio.audio.chords.place', { count: parts.length })}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  tap: { flex: 1 },
  sheet: { backgroundColor: '#0b0d14', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, maxHeight: '86%', borderTopWidth: 1, borderColor: palette.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  row: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceHigh, marginBottom: 6 },
  rowActive: { borderColor: palette.accent },
  rowTitle: { color: palette.text, fontSize: 14, fontWeight: '700' },
  rowSub: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  hint: { color: palette.textDim, fontSize: 12, marginVertical: 10 },
  place: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.accent, borderRadius: 10, paddingVertical: 12 },
  placeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
