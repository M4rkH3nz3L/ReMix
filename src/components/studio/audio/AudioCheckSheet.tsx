import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { palette } from '@/constants/editor';
import type { CheckIssue, MixStats } from '@/lib/audioCheck';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🩺 A hangellenőrzés eredménye: összegzés (hangosság, csúcs) és a hibák listája — a hibák
 * elöl, időrendben; koppintásra a lejátszófej a hiba helyére ugrik.
 */
export function AudioCheckSheet({ issues, stats, onClose }: { issues: CheckIssue[]; stats: MixStats | null; onClose: () => void }) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const lanes = audioLanes(project);
  const trackName = (type?: string | number) => {
    const lane = lanes.find((l) => l.type === type);
    return lane ? laneLabel(lane, t) : String(type ?? '');
  };
  const db = (x: number) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : '−∞');
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.close')} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.audio.check.title')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>
          {stats ? (
            <Text style={styles.summary} testID="audio-check-summary">
              {t('studio.audio.check.summary', { lufs: Number.isFinite(stats.lufs) ? stats.lufs.toFixed(1) : '−∞', peak: db(stats.peak), dur: formatTime(stats.duration) })}
            </Text>
          ) : null}
          <ScrollView contentContainerStyle={styles.list}>
            {issues.length === 0 ? (
              <View style={styles.ok}>
                <Ionicons name="checkmark-circle" size={22} color="#39d98a" />
                <Text style={styles.okText}>{t('studio.audio.check.ok')}</Text>
              </View>
            ) : (
              issues.map((i, k) => (
                <Pressable
                  key={k}
                  style={styles.item}
                  disabled={i.start === undefined}
                  onPress={() => {
                    useEditorStore.getState().setPlayhead(i.start ?? 0);
                    onClose();
                  }}
                >
                  <Ionicons name={i.severity === 'error' ? 'alert-circle' : 'warning-outline'} size={18} color={i.severity === 'error' ? palette.danger : '#f5a524'} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemText}>{t(`studio.audio.check.kind.${i.kind}`, { ...i.params, track: trackName(i.params?.track), dir: i.params?.dir ? t(`studio.audio.check.dir.${i.params.dir}`) : '' })}</Text>
                    {i.start !== undefined ? (
                      <Text style={styles.time}>
                        {formatTime(i.start)}
                        {i.end !== undefined && i.end - i.start >= 0.2 ? ` – ${formatTime(i.end)}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  {i.start !== undefined ? <Ionicons name="locate-outline" size={16} color={palette.textDim} /> : null}
                </Pressable>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  scrim: { flex: 1 },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, maxHeight: '80%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  summary: { color: palette.textDim, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  list: { paddingBottom: 16, gap: 8 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  okText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceHigh },
  itemText: { color: palette.text, fontSize: 14, fontWeight: '600' },
  time: { color: palette.textDim, fontSize: 12, marginTop: 2 },
});
