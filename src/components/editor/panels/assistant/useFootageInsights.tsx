import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Alert } from 'react-native';

import { findBrollSpots } from '@/lib/brollClient';
import { analyzeQuality } from '@/lib/qualityClient';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';

/**
 * 🔍 Nem-módosító felvétel-elemzők (Pro): B-roll-helyek és footage check —
 * csak összefoglalót adnak, a projektet nem írják.
 */
export function useFootageInsights(t: TFunction) {
  const [footageStatus, setFootageStatus] = useState<string | null>(null);
  const [brollStatus, setBrollStatus] = useState<string | null>(null);

  /**
   * 🎞️ B-roll-helyek (saját médiából): a beszéd-szünetek (csend) azok a pontok,
   * ahol a legjobb SAJÁT B-roll felvétellel takarni. Nem módosít — összefoglaló.
   */
  const findBroll = async () => {
    if (brollStatus) {
      return;
    }
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    setBrollStatus(t('panels.assistant.brollChecking'));
    try {
      await guardPro(
        async () => {
          const spots = await withProgress(t('panels.assistant.brollTitle'), () =>
            findBrollSpots(project)
          );
          if (!spots || spots.length === 0) {
            Alert.alert(t('panels.assistant.brollTitle'), t('panels.assistant.brollNone'));
            return;
          }
          const list = spots
            .slice(0, 8)
            .map((s) => `• ${formatTime(s.start)}–${formatTime(s.end)}`)
            .join('\n');
          Alert.alert(
            t('panels.assistant.brollTitle'),
            `${t('panels.assistant.brollFound', { count: spots.length })}\n${list}`
          );
        },
        (e) => Alert.alert(t('panels.assistant.brollTitle'), e.message)
      );
    } finally {
      setBrollStatus(null);
    }
  };

  /**
   * 🔍 Footage check (Phase 1.5): a klipek reprezentatív kockái alapján jelöli a
   * homályos / alul-túlexponált felvételeket (worker /shotscore) — nem módosít,
   * csak összefoglalót ad. Pro (guardPro → nem-Pro esetén paywall).
   */
  const footageCheck = async () => {
    if (footageStatus) {
      return;
    }
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    setFootageStatus(t('panels.assistant.footageChecking'));
    try {
      await guardPro(
        async () => {
          const report = await analyzeQuality(project);
          Alert.alert(
            t('panels.assistant.footageTitle'),
            report ? report.summary : t('panels.assistant.footageUnavailable')
          );
        },
        (e) => Alert.alert(t('panels.assistant.footageTitle'), e.message)
      );
    } finally {
      setFootageStatus(null);
    }
  };

  return { footageStatus, brollStatus, findBroll, footageCheck };
}
