import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { silenceCutCommands } from '@/lib/audioSilence';
import { catalogAvailability, catalogEntry } from '@/lib/modelCatalog';
import { catalogRuntime, downloadModel } from '@/lib/modelRegistryClient';
import { trackWords, wordCutRanges, type SrcWord, type TimelineWord } from '@/lib/speechEdit';
import { clearSpeechWordCache, speechWordsFor } from '@/lib/speechEditClient';
import { findFillerAndRepeats } from '@/lib/textedit';
import { bestUsableWhisperModelId, runWhisperSmokeTest } from '@/lib/whisperClient';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import { useSpeechEdit } from '@/store/speechEditStore';
import type { AudioClip, Project, TrackType } from '@/types/project';

/**
 * ✂️💬 Beszédvágás szöveggel: a sáv átirata az idővonal alatt; a szóra koppintva kijelölöd (és a
 * lejátszófej odaugrik), a „Kivágás” a kijelölt szavakat vágja ki a hangból — ripple, egy undo.
 * Az átirat a vágás után magától frissül (a szavak forrás-időben tárolódnak).
 */

/** az alap (a magyarhoz a tiny gyenge) és az opcionális pontosabb modell */
const BASE_MODEL = 'whisper-base-q5';
const SMALL_MODEL = 'whisper-small-q5';

const audioClipsOf = (project: Project | null, trackType: TrackType | null): AudioClip[] =>
  (project?.tracks.find((t) => t.type === trackType)?.clips ?? []).filter((c): c is AudioClip => c.kind === 'audio');

const mbOf = (id: string) => Math.round((catalogEntry(id)?.manifest?.sizeBytes ?? 0) / 1024 / 1024);

/** egy whisper-modell letöltése (sha256-ellenőrzéssel) és bepróbálása; @returns használható-e */
export async function installWhisperModel(id: string, t: TFunction): Promise<boolean> {
  const entry = catalogEntry(id);
  if (!entry?.manifest) return false;
  if (catalogAvailability(entry, catalogRuntime()) === 'gated') {
    Alert.alert(t('studio.audio.speech.modelTitle'), t('studio.audio.speech.modelGated'));
    return false;
  }
  const ok = await withProgress(t('studio.audio.speech.modelWorking'), async () => {
    const res = await downloadModel(entry.manifest!);
    return res.ok && (await runWhisperSmokeTest(id));
  });
  if (!ok) Alert.alert(t('studio.audio.speech.modelTitle'), t('studio.audio.speech.modelFailed'));
  return ok;
}

/** van-e használható modell; ha nincs, a felhasználó választ: alap vagy pontosabb */
async function ensureWhisperModel(t: TFunction): Promise<boolean> {
  if (bestUsableWhisperModelId()) return true;
  const pick = await new Promise<string | null>((resolve) =>
    Alert.alert(t('studio.audio.speech.modelTitle'), t('studio.audio.speech.modelChoose'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
      { text: t('studio.audio.speech.modelBase', { mb: mbOf(BASE_MODEL) }), onPress: () => resolve(BASE_MODEL) },
      { text: t('studio.audio.speech.modelSmall', { mb: mbOf(SMALL_MODEL) }), onPress: () => resolve(SMALL_MODEL) },
    ])
  );
  return pick ? installWhisperModel(pick, t) : false;
}

/**
 * ⬆️ a pontosabb (small) modell letöltése a felhasználó jóváhagyásával, majd a sáv újra-átírása
 * (a régi átirat eldobva). @returns a szavak száma, vagy null
 */
export async function upgradeSpeechModel(t: TFunction, confirm = true): Promise<number | null> {
  const trackType = useSpeechEdit.getState().trackType;
  if (!trackType) return null;
  if (confirm) {
    const ok = await new Promise<boolean>((resolve) =>
      Alert.alert(t('studio.audio.speech.modelTitle'), t('studio.audio.speech.upgradeBody', { mb: mbOf(SMALL_MODEL) }), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('studio.audio.speech.modelDownload'), onPress: () => resolve(true) },
      ])
    );
    if (!ok) return null;
  }
  if (!(await installWhisperModel(SMALL_MODEL, t))) return null;
  clearSpeechWordCache();
  return startSpeechEdit(trackType, t);
}

/** az átirat elkészítése a sáv klipjeire és a sáv megnyitása; @returns a szavak száma vagy null */
export async function startSpeechEdit(trackType: TrackType, t: TFunction): Promise<number | null> {
  if (!(await ensureWhisperModel(t))) return null;
  const clips = audioClipsOf(useEditorStore.getState().project, trackType).filter((c) => !(c.loopLength && c.loopLength > 0));
  // fájlonként a sávon használt forrás-ablakok uniója
  const windows = new Map<string, { from: number; to: number; dur?: number }>();
  for (const c of clips) {
    const speed = c.speed && c.speed > 0 ? c.speed : 1;
    const from = c.trimIn ?? 0;
    const to = from + c.duration * speed;
    const w = windows.get(c.uri);
    windows.set(c.uri, w ? { from: Math.min(w.from, from), to: Math.max(w.to, to), dur: w.dur } : { from, to, dur: c.sourceDuration });
  }
  const wordsByUri = new Map<string, SrcWord[]>();
  let failed = false;
  await withProgress(t('studio.audio.speech.working'), async () => {
    for (const [uri, w] of windows) {
      const words = await speechWordsFor(uri, w.from, w.to, w.dur);
      if (words) wordsByUri.set(uri, words);
      else failed = true;
    }
  });
  const count = [...wordsByUri.values()].reduce((s, w) => s + w.length, 0);
  if (count === 0) {
    Alert.alert(t('studio.audio.speech.title'), t(failed ? 'studio.audio.speech.failed' : 'studio.audio.speech.none'));
    return failed ? null : 0;
  }
  useSpeechEdit.getState().open(trackType, wordsByUri);
  return count;
}

/** a sáv jelenlegi szavai (a vágások után is pontos) */
export function currentSpeechWords(): TimelineWord[] {
  const s = useSpeechEdit.getState();
  return trackWords(audioClipsOf(useEditorStore.getState().project, s.trackType), s.wordsByUri);
}

/** a kijelölt töltelékek és ismétlések hozzáadása a kijelöléshez; @returns a darabszám */
export function selectSpeechFillers(): number {
  const words = currentSpeechWords();
  const keys = findFillerAndRepeats(words).map((i) => words[i].key);
  useSpeechEdit.getState().select(keys);
  return keys.length;
}

/** a kijelölt szavak kivágása; @returns a kivágott tartományok száma */
export function applySpeechCut(): number {
  const s = useSpeechEdit.getState();
  const st = useEditorStore.getState();
  if (!s.trackType || !st.project) return 0;
  const ranges = wordCutRanges(currentSpeechWords(), s.selected, st.project.fps ?? 30);
  const cmds = silenceCutCommands(st.project, s.trackType, ranges, s.mode, st.lockedTracks);
  if (cmds.length === 0) return 0;
  st.applyBatch(cmds, 'user');
  useSpeechEdit.setState({ selected: new Set() });
  return ranges.length;
}

/** a kijelölt szavak a sávon (csak jelzés) */
export function SpeechCutMarks({ trackType, pxPerSec, height }: { trackType: TrackType; pxPerSec: number; height: number }) {
  const active = useSpeechEdit((s) => s.trackType);
  const selected = useSpeechEdit((s) => s.selected);
  const wordsByUri = useSpeechEdit((s) => s.wordsByUri);
  const project = useEditorStore((s) => s.project);
  const words = useMemo(() => (active === trackType ? trackWords(audioClipsOf(project, trackType), wordsByUri) : []), [active, trackType, project, wordsByUri]);
  if (active !== trackType || selected.size === 0) return null;
  const ranges = wordCutRanges(words, selected, project?.fps ?? 30);
  return (
    <>
      {ranges.map((r) => (
        <View key={r.start} pointerEvents="none" style={[styles.cut, { left: r.start * pxPerSec, width: Math.max(3, (r.end - r.start) * pxPerSec), height }]} />
      ))}
    </>
  );
}

/** az átirat-sáv az idővonal alatt */
export function SpeechEditBar() {
  const { t } = useTranslation();
  const trackType = useSpeechEdit((s) => s.trackType);
  const wordsByUri = useSpeechEdit((s) => s.wordsByUri);
  const selected = useSpeechEdit((s) => s.selected);
  const mode = useSpeechEdit((s) => s.mode);
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const words = useMemo(() => trackWords(audioClipsOf(project, trackType), wordsByUri), [project, trackType, wordsByUri]);
  if (!trackType) return null;
  const picked = words.filter((w) => selected.has(w.key)).length;
  return (
    <View style={styles.bar} testID="speech-edit-bar">
      <View style={styles.row}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={palette.accent} />
        <Text style={styles.title}>{t('studio.audio.speech.header', { count: words.length })}</Text>
        <View style={{ flex: 1 }} />
        {bestUsableWhisperModelId() !== SMALL_MODEL ? (
          <Pressable onPress={() => void upgradeSpeechModel(t)} style={styles.chip} accessibilityRole="button" testID="speech-upgrade-model">
            <Text style={styles.chipText}>{t('studio.audio.speech.upgrade')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => useSpeechEdit.getState().close()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={20} color={palette.textDim} />
        </Pressable>
      </View>
      <ScrollView style={styles.words} contentContainerStyle={styles.wordsInner}>
        {words.map((w) => {
          const on = selected.has(w.key);
          const current = playhead >= w.start && playhead < w.end;
          return (
            <Pressable
              key={w.key}
              onPress={() => {
                useSpeechEdit.getState().toggle(w.key);
                useEditorStore.getState().setPlayhead(w.start);
              }}
              style={[styles.word, current && styles.wordCurrent, on && styles.wordOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Text style={[styles.wordText, on && styles.wordTextOn]}>{w.text}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.row}>
        <Pressable onPress={() => selectSpeechFillers()} style={styles.chip} accessibilityRole="button">
          <Text style={styles.chipText}>{t('studio.audio.speech.fillers')}</Text>
        </Pressable>
        {(['track', 'all'] as const).map((m) => (
          <Pressable key={m} onPress={() => useSpeechEdit.getState().setMode(m)} style={[styles.chip, mode === m && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: mode === m }}>
            <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{t(m === 'track' ? 'studio.audio.silence.modeTrack' : 'studio.audio.silence.modeAll')}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => applySpeechCut()} disabled={picked === 0} style={[styles.btn, picked === 0 && { opacity: 0.4 }]} accessibilityRole="button">
          <Text style={styles.btnText}>{t('studio.audio.speech.cut', { count: picked })}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cut: { position: 'absolute', top: 0, backgroundColor: '#e5484dcc', borderRadius: 3 },
  bar: { paddingHorizontal: 14, paddingVertical: 8, gap: 6, backgroundColor: palette.surfaceHigh, borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title: { color: palette.text, fontSize: 13, fontWeight: '700' },
  words: { maxHeight: 132 },
  wordsInner: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  word: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  wordCurrent: { borderColor: palette.accent },
  wordOn: { backgroundColor: '#e5484d33', borderColor: palette.danger },
  wordText: { color: palette.text, fontSize: 14 },
  wordTextOn: { color: palette.danger, textDecorationLine: 'line-through' },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: palette.border },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: palette.danger },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
