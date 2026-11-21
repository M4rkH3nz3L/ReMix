import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { applyCaptionSuggestions, heuristicSuggestions } from '@/lib/captionStudio';
import { fetchCaptionSuggestions, fetchCaptionTranslations } from '@/lib/captionStudioClient';
import { replaceProfanity, type ProfanityMode } from '@/lib/profanity';
import { captionBand } from '@/lib/captionLayout';
import { captionInSafeZone, fitCaptionY, safeZone } from '@/lib/safeZone';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { TextClip } from '@/types/project';

/**
 * A felirat-panel szöveg-átíró akciói (REFACTOR: a CaptionsPanel.tsx-ből): fordítás,
 * kétnyelvű felirat (Pro), káromkodás-maszkolás, safe-zone, Caption Studio. Hook
 * nélküli gyárak — a gyökér állapotát/settereit kapják, a store-t a hívás
 * pillanatában olvassák.
 */

export interface TranslateActionDeps {
  t: TFunction;
  translateStatus: string | null;
  setTranslateStatus: (status: string | null) => void;
}

/** 🌍 fordítás + kétnyelvű felirat (Pro) */
export function createTranslateActions({ t, translateStatus, setTranslateStatus }: TranslateActionDeps) {
  // 🌍 Felirat-fordítás (Phase 4.2): a meglévő feliratok szövegét a cél-nyelvre
  // fordítja (időzítés változatlan), egy undo-lépésben. Pro (guardPro → paywall).
  const runTranslate = async (lang: string) => {
    if (translateStatus) {
      return;
    }
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((tk) => tk.type === 'captions');
    const captions = (track?.clips ?? []).filter((c): c is TextClip => c.kind === 'text');
    if (!state.project || !track || captions.length === 0) {
      Alert.alert(t('panels.captions.translateTitle'), t('panels.captions.noCaptionsOnTrack'));
      return;
    }
    setTranslateStatus(t('panels.captions.translatingStatus', { lang }));
    try {
      await guardPro(
        async () => {
          const segs = captions.map((c) => ({ id: c.id, text: c.text }));
          const translated = await withProgress(t('panels.captions.translateTitle'), () =>
            fetchCaptionTranslations(segs, lang)
          );
          if (!translated || translated.length === 0) {
            Alert.alert(t('panels.captions.translateTitle'), t('panels.captions.translateNone'));
            return;
          }
          const map = new Map(translated.map((s) => [s.id, s.text]));
          let n = 0;
          const clips = track.clips.map((c) => {
            const tx = c.kind === 'text' ? map.get(c.id) : undefined;
            if (tx) {
              n += 1;
              return { ...c, text: tx };
            }
            return c;
          });
          useEditorStore
            .getState()
            .dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
          Alert.alert(
            t('panels.captions.translateDoneTitle'),
            t('panels.captions.translateDoneBody', { count: n, lang })
          );
        },
        (e) => Alert.alert(t('panels.captions.translateTitle'), e.message)
      );
    } finally {
      setTranslateStatus(null);
    }
  };

  // 🌍 Kétnyelvű felirat: az EREDETIT megtartja, alá teszi a fordítást (két sor).
  // A már kétnyelvű klipeknél az első sort veszi eredetinek → újrafuttatható. Pro.
  const runBilingual = async (lang: string) => {
    if (translateStatus) {
      return;
    }
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((tk) => tk.type === 'captions');
    const captions = (track?.clips ?? []).filter((c): c is TextClip => c.kind === 'text');
    if (!state.project || !track || captions.length === 0) {
      Alert.alert(t('panels.captions.bilingualTitle'), t('panels.captions.noCaptionsOnTrack'));
      return;
    }
    setTranslateStatus(t('panels.captions.translatingStatus', { lang }));
    try {
      await guardPro(
        async () => {
          const segs = captions.map((c) => ({ id: c.id, text: c.text.split('\n')[0] }));
          const translated = await withProgress(t('panels.captions.bilingualTitle'), () =>
            fetchCaptionTranslations(segs, lang)
          );
          if (!translated || translated.length === 0) {
            Alert.alert(t('panels.captions.bilingualTitle'), t('panels.captions.translateNone'));
            return;
          }
          const map = new Map(translated.map((s) => [s.id, s.text]));
          let n = 0;
          const clips = track.clips.map((c) => {
            const tx = c.kind === 'text' ? map.get(c.id) : undefined;
            if (tx && c.kind === 'text') {
              n += 1;
              const orig = c.text.split('\n')[0];
              return { ...c, text: `${orig}\n${tx}` };
            }
            return c;
          });
          useEditorStore
            .getState()
            .dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
          Alert.alert(
            t('panels.captions.bilingualTitle'),
            t('panels.captions.bilingualDone', { count: n, lang })
          );
        },
        (e) => Alert.alert(t('panels.captions.bilingualTitle'), e.message)
      );
    } finally {
      setTranslateStatus(null);
    }
  };
  return { runTranslate, runBilingual };
}

export interface CaptionFixActionDeps {
  t: TFunction;
  setStudioStatus: (status: string | null) => void;
}

/** 🧼 káromkodás, 🛡️ safe-zone, ✨ Caption Studio */
export function createCaptionFixActions({ t, setStudioStatus }: CaptionFixActionDeps) {
  // 🧼 Káromkodás-maszkolás: on-device, determinista (nem AI); egy undo-lépés.
  const runProfanity = (mode: ProfanityMode) => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((tk) => tk.type === 'captions');
    const captions = (track?.clips ?? []).filter((c): c is TextClip => c.kind === 'text');
    if (!track || captions.length === 0) {
      Alert.alert(t('panels.captions.profanityTitle'), t('panels.captions.noCaptionsOnTrack'));
      return;
    }
    let total = 0;
    const clips = track.clips.map((c) => {
      if (c.kind !== 'text') {
        return c;
      }
      const res = replaceProfanity(c.text, mode);
      if (res.count === 0) {
        return c;
      }
      total += res.count;
      return { ...c, text: res.text };
    });
    if (total === 0) {
      Alert.alert(t('panels.captions.profanityTitle'), t('panels.captions.profanityNone'));
      return;
    }
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips });
    Alert.alert(t('panels.captions.profanityTitle'), t('panels.captions.profanityDone', { count: total }));
  };

  // 🛡️ Safe-zone validáció: a biztonságos sávon KÍVÜL eső feliratokat visszatolja
  // (a platform-UI ne takarja). On-device, determinista; egy undo-lépés.
  const runSafeZone = () => {
    const state = useEditorStore.getState();
    const project = state.project;
    const track = project?.tracks.find((tk) => tk.type === 'captions');
    const captions = (track?.clips ?? []).filter((c): c is TextClip => c.kind === 'text');
    if (!project || !track || captions.length === 0) {
      Alert.alert(t('panels.captions.safeZoneTitle'), t('panels.captions.noCaptionsOnTrack'));
      return;
    }
    const zone = safeZone(project.aspectRatio);
    let moved = 0;
    const clips = track.clips.map((c) => {
      if (c.kind !== 'text') {
        return c;
      }
      const rect = { x: c.position.x, y: c.position.y, band: captionBand(c.text, c.fontSize) };
      if (captionInSafeZone(rect, zone)) {
        return c;
      }
      const y = Math.round(fitCaptionY(rect, zone) * 1000) / 1000;
      if (Math.abs(y - c.position.y) < 0.005) {
        return c;
      }
      moved += 1;
      return { ...c, position: { ...c.position, y } };
    });
    if (moved === 0) {
      Alert.alert(t('panels.captions.safeZoneTitle'), t('panels.captions.safeZoneAllOk'));
      return;
    }
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips });
    Alert.alert(t('panels.captions.safeZoneTitle'), t('panels.captions.safeZoneDone', { count: moved }));
  };

  // ✨ Caption Studio: kiemelt szavak + emoji a meglévő feliratokra — AI-val,
  // AI nélkül heurisztikával; egy undo-lépés (REPLACE_TRACK_CLIPS)
  const runCaptionStudio = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((t) => t.type === 'captions');
    const captions = (track?.clips ?? []).filter((c) => c.kind === 'text');
    if (!track || captions.length === 0) {
      Alert.alert('Caption Studio', t('panels.captions.captionStudioNoCaptions'));
      return;
    }
    setStudioStatus(t('panels.captions.analyzingStatus'));
    const segments = captions.map((c) => ({ id: c.id, text: (c as TextClip).text }));
    const ai = await fetchCaptionSuggestions(segments);
    const suggestions = ai ?? heuristicSuggestions(segments);
    setStudioStatus(null);
    const { clips, changed } = applyCaptionSuggestions(track.clips, suggestions);
    if (changed === 0) {
      Alert.alert('Caption Studio', t('panels.captions.captionStudioNoWords'));
      return;
    }
    state.dispatch(
      { type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips },
      'ai'
    );
    Alert.alert(
      t('panels.captions.captionStudioDoneTitle'),
      t('panels.captions.captionStudioDoneBody', { count: changed }) +
        (ai
          ? t('panels.captions.captionStudioSourceAi')
          : t('panels.captions.captionStudioSourceHeuristic')) +
        t('panels.captions.captionStudioDoneTail')
    );
  };
  return { runProfanity, runSafeZone, runCaptionStudio };
}
