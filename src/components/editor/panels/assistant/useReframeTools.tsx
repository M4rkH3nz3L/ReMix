import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Alert } from 'react-native';

import { aspectValue } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import { buildSmartReframe } from '@/lib/reframeClient';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';

/**
 * 📐 Smart Reframe + közösségi képarány-presetek: arányváltás után téma-követő
 * cover-kitöltés, jóváhagyás után egy undo-lépésben (actor: 'ai').
 */
export function useReframeTools(t: TFunction, setApplied: (message: string | null) => void) {
  const [reframeStatus, setReframeStatus] = useState<string | null>(null);

  /**
   * Smart Reframe (P0‑7): az arány-eltérő videóklipek cover-kitöltést kapnak
   * téma-követő pan kulcskockákkal — más vászonarányra váltásnál egy gomb.
   */
  const smartReframe = async () => {
    const state = useEditorStore.getState();
    if (!state.project || reframeStatus) {
      return;
    }
    setReframeStatus(t('panels.assistant.subjectAnalysis'));
    try {
      const canvasAspect = aspectValue(state.project.aspectRatio);
      const plan = await withProgress(t('panels.assistant.reframeTitle'), (report) =>
        buildSmartReframe(state.project!, canvasAspect, report)
      );
      if (!plan) {
        Alert.alert(
          t('panels.assistant.reframeTitle'),
          t('panels.assistant.reframeNothing')
        );
        return;
      }
      Alert.alert(
        t('panels.assistant.reframeTitle'),
        t('panels.assistant.reframeBody', { count: plan.changed }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.applyAction'),
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? t('panels.assistant.reframeDone', { count: plan.changed })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setReframeStatus(null);
    }
  };

  /**
   * 📱 AI social variant (Phase 4.1): egy platform-gombbal a projekt a helyes
   * képarányra vált (SET_ASPECT), bekapcsol a safe-zone, és lefut a téma-követő
   * reframe az új arányra (Pro — a smartReframe kezeli a Pro-gate-et + confirmot).
   */
  const applySocialPreset = (aspect: '16:9' | '9:16' | '1:1') => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    if (state.project.aspectRatio !== aspect) {
      state.dispatch({ type: 'SET_ASPECT', aspectRatio: aspect });
    }
    if (!state.showSafeZones) {
      state.toggleSafeZones();
    }
    // az arány már frissült (a dispatch szinkron) → reframe az új vászonra
    smartReframe().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:applySocialPreset', err); return Alert.alert(t('panels.assistant.reframeTitle'), err.message); });
  };

  return { reframeStatus, smartReframe, applySocialPreset };
}
