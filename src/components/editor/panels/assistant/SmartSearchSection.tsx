import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { clipsAt } from '@/lib/projectUtils';
import { formatTime } from '@/lib/time';
import { getTimelineTranscript } from '@/lib/transcripts';
import { mergeSearchHits, searchTranscript } from '@/lib/transcriptSearch';
import { indexProjectVision, searchVision } from '@/lib/visionSearch';
import type { SearchHit } from '@/lib/visionIndex';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { VideoClip } from '@/types/project';

/**
 * 🔍 Smart Search (P0‑8): átirat- és vision-találatok EGY listában, idővonal-
 * kiemeléssel + szemantikus multi-select. Önálló AI-mód — a közös busy-sávot a
 * panel adja (`busy`/`setBusy`).
 */
export function SmartSearchSection({
  busy,
  setBusy,
}: {
  busy: string | null;
  setBusy: (status: string | null) => void;
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);

  const runSearch = async () => {
    const state = useEditorStore.getState();
    const query = searchQuery.trim();
    if (!state.project || !query || busy) {
      return;
    }
    setSearchHits(null);
    state.setSearchMatchTimes([]); // korábbi kiemelés törlése
    setBusy(t('panels.assistant.searching'));
    try {
      // 📝 átirat-találatok a vision-találatokkal EGY listában (P0‑8)
      const transcript =
        (await getTimelineTranscript(state.project).catch(() => null)) ?? [];
      const transcriptHits = searchTranscript(transcript, query);
      const index = await withProgress(t('panels.assistant.progressVisualIndex'), (report) =>
        indexProjectVision(state.project!, report)
      );
      let visionHits: SearchHit[] = [];
      if (index.length > 0) {
        setBusy(t('panels.assistant.scoring'));
        visionHits = await searchVision(query, index);
      }
      if (index.length === 0 && transcriptHits.length === 0) {
        Alert.alert(
          t('panels.assistant.smartSearchTitle'),
          t('panels.assistant.searchNoIndex')
        );
        return;
      }
      const merged = mergeSearchHits(visionHits, transcriptHits);
      setSearchHits(merged);
      // 🔎 találatok kiemelése az idővonalon (Phase 2.2)
      state.setSearchMatchTimes(merged.map((h) => h.time));
    } finally {
      setBusy(null);
    }
  };

  /**
   * 🔎 Semantic select (Phase 2.1): a keresési találatok idejeit a videóklipekre
   * képezi, és MIND kijelöli (multi-select) — „válaszd ki az összes ilyen
   * snittet". Onnan a köteg-műveletek (stílus, törlés…) mennek. Kliens-oldali.
   */
  const selectSearchMatches = () => {
    const state = useEditorStore.getState();
    const vt = state.project?.tracks.find((tk) => tk.type === 'video');
    if (!vt || !searchHits || searchHits.length === 0) {
      return;
    }
    const byId = new Map<string, VideoClip>();
    for (const hit of searchHits) {
      for (const c of clipsAt<VideoClip>(vt, hit.time)) {
        if (c.kind === 'video') {
          byId.set(c.id, c);
        }
      }
    }
    const clips = [...byId.values()].sort((a, b) => a.start - b.start);
    if (clips.length === 0) {
      Alert.alert(t('panels.assistant.smartSearchTitle'), t('panels.assistant.selectMatchesNone'));
      return;
    }
    state.selectClips(clips.map((c) => c.id));
    Alert.alert(
      t('panels.assistant.smartSearchTitle'),
      t('panels.assistant.selectMatchesDone', { count: clips.length })
    );
  };

  return (
    <PanelSection title={t('panels.assistant.sectionSmartSearch')}>
      <TextInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={styles.input}
        placeholder={t('panels.assistant.searchPlaceholder')}
        placeholderTextColor={palette.textDim}
      />
      <PrimaryButton
        icon="search-outline"
        label={busy ?? t('panels.assistant.searchInVisual')}
        onPress={() => {
          runSearch().catch((err: Error) => Alert.alert('Smart Search', err.message));
        }}
      />
      {searchHits !== null ? (
        searchHits.length === 0 ? (
          <Text style={styles.note}>{t('panels.assistant.searchNoResults')}</Text>
        ) : (
          <>
            <PrimaryButton
              icon="checkbox-outline"
              label={t('panels.assistant.selectMatchesBtn', { count: searchHits.length })}
              onPress={selectSearchMatches}
            />
            {searchHits.map((hit, i) => (
              <Pressable
                key={`${hit.time.toFixed(1)}-${i}`}
                style={styles.variantCard}
                onPress={() => useEditorStore.getState().setPlayhead(hit.time)}
              >
                <Text style={styles.variantMeta}>
                  {hit.source === 'transcript' ? '📝' : '👁'} ▶ {formatTime(hit.time)} ·{' '}
                  {(hit.score * 100).toFixed(0)}%
                </Text>
                <Text style={styles.variantRationale} numberOfLines={2}>
                  {hit.description || hit.labels.join(', ')}
                </Text>
              </Pressable>
            ))}
          </>
        )
      ) : (
        <Text style={styles.note}>{t('panels.assistant.smartSearchIntro')}</Text>
      )}
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  variantCard: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  variantMeta: {
    color: palette.accent,
    fontSize: 11,
  },
  variantRationale: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 15,
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
