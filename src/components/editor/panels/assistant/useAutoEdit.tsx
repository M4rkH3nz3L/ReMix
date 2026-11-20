import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { variantPreviewRanges } from '@/lib/assistantPanelOps';
import { compileVariant } from '@/lib/autoedit';
import type { AutoEditVariant } from '@/lib/autoedit';
import { runAutoEditFlow } from '@/lib/autoeditClient';
import { findHighlights } from '@/lib/highlightsClient';
import type { Highlight } from '@/lib/highlightsClient';
import { logCaught } from '@/lib/logCaught';
import { projectDuration } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';

/**
 * 🎬 AI Edit Engine (P0‑1): cél-hosszú változatok + short-jelöltek, a változat
 * előnézete alkalmazás nélkül, és jóváhagyás után a végrehajtás (actor: 'ai').
 */
export function useAutoEdit(t: TFunction, setApplied: (message: string | null) => void) {
  // --- AI Edit Engine (P0‑1) ---
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [autoResult, setAutoResult] = useState<{
    variants: AutoEditVariant[];
    source: 'ai' | 'heuristic';
  } | null>(null);

  const startAutoEdit = async () => {
    const state = useEditorStore.getState();
    if (!state.project || autoStatus) {
      return;
    }
    setAutoResult(null);
    setAutoStatus(t('panels.assistant.gatheringSignals'));
    try {
      const result = await withProgress(t('panels.assistant.autoEditTitle'), (report) =>
        runAutoEditFlow(state.project!, targetSeconds, report)
      );
      setAutoResult(result);
    } catch (err) {
      logCaught('components/editor/panels/AssistantPanel.tsx:startAutoEdit', err);
      Alert.alert(t('panels.assistant.autoEditTitle'), (err as Error).message);
    } finally {
      setAutoStatus(null);
    }
  };

  const [highlightStatus, setHighlightStatus] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);

  /**
   * 🎯 AI Rough Cut → shorts (Phase 3.3): a hosszú anyagból önálló short-jelöltek
   * (highlight-ablakok). Nem módosít — tap = a lejátszófej a highlight elejére.
   */
  const findShorts = async () => {
    if (highlightStatus) {
      return;
    }
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    setHighlights(null);
    setHighlightStatus(t('panels.assistant.findShortsChecking'));
    try {
      await guardPro(
        async () => {
          const found = await withProgress(t('panels.assistant.shortsTitle'), () =>
            findHighlights(project)
          );
          if (found && found.length > 0) {
            setHighlights(found);
          } else {
            Alert.alert(t('panels.assistant.shortsTitle'), t('panels.assistant.shortsNone'));
          }
        },
        (e) => Alert.alert(t('panels.assistant.shortsTitle'), e.message)
      );
    } finally {
      setHighlightStatus(null);
    }
  };

  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const stopVariantPreview = () => {
    const s = useEditorStore.getState();
    s.setVariantPreview(null);
    s.setPlaying(false);
    setPreviewingId(null);
  };

  // a panel bezárásakor az előnézet-mód ne ragadjon be
  useEffect(() => stopVariantPreview, []);

  /** ▶ a változat lejátszása alkalmazás nélkül: az óra a keep-sávokon ugrál */
  const previewVariant = (variant: AutoEditVariant) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    if (previewingId === variant.id) {
      stopVariantPreview();
      return;
    }
    const duration = projectDuration(state.project);
    const ranges = variantPreviewRanges(variant, duration);
    if (ranges.length === 0) {
      Alert.alert(t('panels.assistant.previewTitle'), t('panels.assistant.previewNoTrack'));
      return;
    }
    state.setVariantPreview(ranges);
    state.setPlayhead(ranges[0].start);
    state.setPlaying(true);
    setPreviewingId(variant.id);
  };

  const applyVariant = (variant: AutoEditVariant) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    stopVariantPreview();
    const compiled = compileVariant(state.project, variant, projectDuration(state.project));
    if (!compiled) {
      Alert.alert(t('panels.assistant.autoEditTitle'), t('panels.assistant.variantNotApplicable'));
      return;
    }
    Alert.alert(
      variant.title,
      t('panels.assistant.variantBody', {
        seconds: compiled.totalSeconds.toFixed(1),
        cuts: compiled.cuts,
        captions: compiled.captionClips.length,
        rationale: variant.rationale,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('panels.assistant.applyAction'),
          onPress: () => {
            const s = useEditorStore.getState();
            const ok = s.dispatch(
              { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: compiled.videoClips },
              'ai'
            );
            if (ok && compiled.captionClips.length > 0) {
              s.dispatch(
                { type: 'ADD_CLIPS', trackType: 'captions', clips: compiled.captionClips },
                'ai'
              );
            }
            setAutoResult(null);
            setApplied(
              ok
                ? t('panels.assistant.variantApplied', {
                    title: variant.title,
                    seconds: compiled.totalSeconds.toFixed(1),
                    cuts: compiled.cuts,
                    captions: compiled.captionClips.length,
                  })
                : t('panels.assistant.applyFailed')
            );
          },
        },
      ]
    );
  };

  return {
    targetSeconds,
    setTargetSeconds,
    autoStatus,
    autoResult,
    startAutoEdit,
    highlightStatus,
    highlights,
    findShorts,
    previewingId,
    previewVariant,
    applyVariant,
  };
}
