import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { silenceCutCommands } from '@/lib/audioSilence';
import { findClipSilences } from '@/lib/audioSilenceClient';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import { useSilenceReview } from '@/store/silenceReviewStore';
import type { AudioClip, TrackType } from '@/types/project';

/**
 * 🔇 Csendek kezelése jóváhagyással: a keresés a klip forrásán az eszközön fut, a talált csendek
 * a sávon pirosan jelennek meg (koppintás = kihagyás/visszavétel), a sáv alatti sávban a
 * kivágás módja és a jóváhagyás. A kivágás egy undo-lépés.
 */

/** a keresés elindítása (a klipszerkesztőből); @returns a talált csendek száma, vagy null */
export async function startSilenceSearch(clip: AudioClip, trackType: TrackType, fps: number, t: TFunction): Promise<number | null> {
  const project = useEditorStore.getState().project;
  if (!project) return null;
  if (clip.loopLength && clip.loopLength > 0) {
    Alert.alert(t('studio.audio.silence.title'), t('studio.audio.silence.loop'));
    return 0;
  }
  const ranges = await withProgress(t('studio.audio.silence.working'), () => findClipSilences(clip, fps));
  if (ranges === null) {
    Alert.alert(t('studio.audio.silence.title'), t('studio.audio.silence.failed'));
    return null;
  }
  if (ranges.length === 0) {
    Alert.alert(t('studio.audio.silence.title'), t('studio.audio.silence.none'));
    return 0;
  }
  useSilenceReview.getState().start({ clipId: clip.id, trackType, ranges, project: useEditorStore.getState().project ?? project });
  return ranges.length;
}

/** a jóváhagyott csendek kivágása; @returns az alkalmazott parancsok száma */
export function applySilenceReview(): number {
  const review = useSilenceReview.getState().review;
  const st = useEditorStore.getState();
  if (!review || !st.project) return 0;
  const on = review.ranges.filter((r) => r.on);
  const cmds = silenceCutCommands(st.project, review.trackType, on, review.mode, st.lockedTracks);
  useSilenceReview.getState().clear();
  return cmds.length > 0 ? st.applyBatch(cmds, 'user') : 0;
}

/** a talált csendek a sávon (a sáv saját koordinátáiban) */
export function SilenceMarks({ trackType, pxPerSec, height }: { trackType: TrackType; pxPerSec: number; height: number }) {
  const { t } = useTranslation();
  const review = useSilenceReview((s) => s.review);
  const toggle = useSilenceReview((s) => s.toggle);
  if (!review || review.trackType !== trackType) return null;
  return (
    <>
      {review.ranges.map((r, i) => (
        <Pressable
          key={`${r.start}`}
          testID={`silence-${i}`}
          onPress={() => toggle(i)}
          hitSlop={{ top: 0, bottom: 0, left: 4, right: 4 }}
          accessibilityRole="switch"
          accessibilityState={{ checked: r.on }}
          accessibilityLabel={t('studio.audio.a11y.silenceRange', { start: formatTime(r.start), end: formatTime(r.end) })}
          style={[
            styles.mark,
            { left: r.start * pxPerSec, width: Math.max(6, (r.end - r.start) * pxPerSec), height },
            r.on ? styles.markOn : styles.markOff,
          ]}
        >
          <Ionicons name={r.on ? 'cut' : 'remove-circle-outline'} size={14} color={r.on ? '#fff' : palette.textDim} />
        </Pressable>
      ))}
    </>
  );
}

/** a jóváhagyó sáv: összegzés, kivágás módja, Kivágás / Mégse */
export function SilenceReviewBar() {
  const { t } = useTranslation();
  const review = useSilenceReview((s) => s.review);
  const setMode = useSilenceReview((s) => s.setMode);
  const clear = useSilenceReview((s) => s.clear);
  if (!review) return null;
  const on = review.ranges.filter((r) => r.on);
  const total = on.reduce((s, r) => s + (r.end - r.start), 0);
  return (
    <View style={styles.bar} testID="silence-review-bar">
      <Text style={styles.summary}>{t('studio.audio.silence.summary', { count: on.length, of: review.ranges.length, sec: total.toFixed(1) })}</Text>
      <View style={styles.row}>
        {(['track', 'all'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.chip, review.mode === m && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: review.mode === m }}>
            <Text style={[styles.chipText, review.mode === m && styles.chipTextOn]}>{t(m === 'track' ? 'studio.audio.silence.modeTrack' : 'studio.audio.silence.modeAll')}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={clear} style={styles.btn} accessibilityRole="button">
          <Text style={styles.btnText}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable onPress={() => applySilenceReview()} disabled={on.length === 0} style={[styles.btn, styles.btnPrimary, on.length === 0 && { opacity: 0.4 }]} accessibilityRole="button">
          <Text style={[styles.btnText, { color: '#fff' }]}>{t('studio.audio.silence.apply')}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{t('studio.audio.silence.hint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute', top: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1 },
  markOn: { backgroundColor: '#e5484dcc', borderColor: '#ff8a8f' },
  markOff: { backgroundColor: '#ffffff10', borderColor: palette.border, borderStyle: 'dashed' },
  bar: { paddingHorizontal: 14, paddingVertical: 8, gap: 6, backgroundColor: palette.surfaceHigh, borderTopWidth: 1, borderTopColor: palette.border },
  summary: { color: palette.text, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: palette.border },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  btnPrimary: { backgroundColor: palette.danger, borderColor: palette.danger },
  btnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  hint: { color: palette.textDim, fontSize: 11 },
});
