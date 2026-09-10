import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { buildRangeCutPlan } from '@/lib/cutplan';
import type { SrtCue } from '@/lib/srt';
import {
  findFillerWords,
  selectedSeconds,
  selectedWordRanges,
  timelineWords,
} from '@/lib/textedit';
import { getProjectWordCues } from '@/lib/transcripts';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';

/** ennyi szó fölött a lista csonkolódik (render-teljesítmény) */
const MAX_WORDS = 800;

/**
 * Text-based editing (P0‑3): az átirat vágófelület — szavakra koppintva
 * kijelölsz, a törlés ripple-vágásként fut le a videósávon (egy undo-lépés).
 * A szó-szintű átirat fájlonként cache-elt, a worker Whisperje készíti.
 */
export function TranscriptPanel() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);

  const [cuesByUri, setCuesByUri] = useState<Map<string, SrtCue[]> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState<string | null>(null);

  const load = async () => {
    const state = useEditorStore.getState();
    if (!state.project || status) {
      return;
    }
    setStatus(t('panels.transcript.wordLevelStatus'));
    try {
      const cues = await withProgress(t('panels.transcript.wordLevelProgress'), (report) =>
        getProjectWordCues(state.project!, report)
      );
      setCuesByUri(cues);
      if (cues.size === 0) {
        setApplied(
          Platform.OS === 'web'
            ? t('panels.transcript.webOnly')
            : t('panels.transcript.noSpeech')
        );
      }
    } finally {
      setStatus(null);
    }
  };

  const words = useMemo(
    () => (project && cuesByUri ? timelineWords(project, cuesByUri) : []),
    [project, cuesByUri]
  );
  const shown = words.slice(0, MAX_WORDS);

  const toggleWord = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        setPlayhead(words[index].start);
      }
      return next;
    });
  };

  const removeSelected = () => {
    const state = useEditorStore.getState();
    if (!state.project || selected.size === 0) {
      return;
    }
    const ranges = selectedWordRanges(words, selected);
    const plan = buildRangeCutPlan(state.project, ranges);
    if (!plan) {
      Alert.alert(t('panels.transcript.textCutTitle'), t('panels.transcript.textCutTooShort'));
      return;
    }
    const seconds = selectedSeconds(words, selected);
    Alert.alert(
      t('panels.transcript.deleteSelectedTitle'),
      t('panels.transcript.deleteSelectedMessage', {
        count: selected.size,
        seconds: seconds.toFixed(1),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            const ok = useEditorStore
              .getState()
              .dispatch(
                { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                'user'
              );
            setSelected(new Set());
            setApplied(
              ok
                ? t('panels.transcript.cutResult', {
                    cuts: plan.cuts,
                    seconds: plan.removedSeconds.toFixed(1),
                  })
                : t('panels.transcript.applyFailed')
            );
          },
        },
      ]
    );
  };

  return (
    <View>
      {words.length === 0 ? (
        <PanelSection title={t('panels.transcript.title')}>
          <PrimaryButton
            icon="mic-outline"
            label={status ?? t('panels.transcript.createFromSpeech')}
            onPress={() => {
              load().catch((err: Error) => Alert.alert(t('panels.transcript.title'), err.message));
            }}
          />
          {applied ? <Text style={styles.note}>{applied}</Text> : null}
        </PanelSection>
      ) : (
        <>
          <PanelSection title={t('panels.transcript.editFromText')}>
            <View style={styles.words}>
              {shown.map((w, i) => {
                const isSelected = selected.has(i);
                const isCurrent = playhead >= w.start && playhead < w.end;
                return (
                  <Pressable
                    key={`${i}-${w.start.toFixed(2)}`}
                    onPress={() => toggleWord(i)}
                    style={[
                      styles.word,
                      isCurrent ? styles.wordCurrent : null,
                      isSelected ? styles.wordSelected : null,
                    ]}
                  >
                    <Text
                      style={[styles.wordText, isSelected ? styles.wordTextSelected : null]}
                    >
                      {w.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {words.length > MAX_WORDS ? (
              <Text style={styles.note}>
                {t('panels.transcript.truncated', { max: MAX_WORDS, total: words.length })}
              </Text>
            ) : null}
          </PanelSection>

          <PrimaryButton
            icon="remove-circle-outline"
            label={t('panels.transcript.selectFillers')}
            onPress={() => {
              const fillers = findFillerWords(words);
              if (fillers.length === 0) {
                setApplied(t('panels.transcript.noFillers'));
                return;
              }
              setSelected(new Set(fillers));
              setApplied(
                t('panels.transcript.fillersSelected', { count: fillers.length })
              );
            }}
          />
          {selected.size > 0 ? (
            <PrimaryButton
              icon="cut-outline"
              label={t('panels.transcript.deleteWordsButton', { count: selected.size })}
              onPress={removeSelected}
            />
          ) : null}
          {applied ? <Text style={styles.note}>{applied}</Text> : null}
          <Text style={styles.note}>{t('panels.transcript.tapHint')}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  words: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  word: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: palette.surfaceHigh,
  },
  wordCurrent: {
    borderWidth: 1,
    borderColor: palette.accent,
  },
  wordSelected: {
    backgroundColor: palette.accent,
  },
  wordText: {
    color: palette.text,
    fontSize: 13,
  },
  wordTextSelected: {
    color: '#fff',
    textDecorationLine: 'line-through',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
