import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiActivity } from '@/components/editor/AiActivity';
import type { AiResult } from '@/components/editor/AiActivity';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { aspectValue, palette } from '@/constants/editor';
import { uploadFetch } from '@/lib/upload';
import { askAssistant } from '@/lib/ai';
import { isSilenceCutIntent } from '@/lib/localIntent';
import { AiProviderPicker } from '@/components/editor/AiProviderPicker';
import { AiCharacterPicker } from '@/components/editor/AiCharacterPicker';
import { buildAiContext, partitionAiCommands, toEditorCommands } from '@/lib/aiCommands';
import type { AiCommand } from '@/lib/aiCommands';
import { describeAiPlan } from '@/lib/aiPlan';
import type { AiPlanItem } from '@/lib/aiPlan';
import { toAppError } from '@/lib/errors';
import { haptics } from '@/design';
import { makeId } from '@/lib/id';
import { getTimelineTranscript } from '@/lib/transcripts';
import { compileVariant } from '@/lib/autoedit';
import type { AutoEditVariant } from '@/lib/autoedit';
import { runAutoEditFlow } from '@/lib/autoeditClient';
import { buildBeatFlashPlan, buildBeatPulsePlan } from '@/lib/beatFx';
import { buildBeatSplitPlan, detectBeats, timelineBeats } from '@/lib/beats';
import { buildCutPlan, buildSceneSplitPlan, detectScenes, detectSilence } from '@/lib/cutlist';
import type { SilenceRange } from '@/lib/cutlist';
import { projectDuration } from '@/lib/projectUtils';
import { buildSmartReframe } from '@/lib/reframeClient';
import { renderServerUrl } from '@/lib/render';
import { formatTime } from '@/lib/time';
import { findBrollSpots } from '@/lib/brollClient';
import { findHighlights } from '@/lib/highlightsClient';
import type { Highlight } from '@/lib/highlightsClient';
import { analyzeQuality } from '@/lib/qualityClient';
import { buildMultiRangeDeletePlan } from '@/lib/rangeEdit';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import { BrandKitSection } from '@/components/editor/panels/assistant/BrandKitSection';
import { HooksSection } from '@/components/editor/panels/assistant/HooksSection';
import { LookPacksSection } from '@/components/editor/panels/assistant/LookPacksSection';
import { SmartSearchSection } from '@/components/editor/panels/assistant/SmartSearchSection';
import { SoundDesignSection } from '@/components/editor/panels/assistant/SoundDesignSection';
import type { Project } from '@/types/project';

const QUICK_ACTIONS = ['makeEngaging', 'shorten30', 'addTitleCta', 'captionsLowerThird', 'unifyCaptions'];

/** 📱 közösségi platform → cél-képarány (a márkanevek fixek, nem i18n) */
const SOCIAL_PRESETS: { id: string; label: string; aspect: '16:9' | '9:16' | '1:1' }[] = [
  { id: 'tiktok', label: 'TikTok', aspect: '9:16' },
  { id: 'reels', label: 'Reels', aspect: '9:16' },
  { id: 'shorts', label: 'Shorts', aspect: '9:16' },
  { id: 'youtube', label: 'YouTube', aspect: '16:9' },
  { id: 'instagram', label: 'Instagram', aspect: '1:1' },
];

/**
 * AI-asszisztens (full-plan F3): utasítás → a worker Claude-dal parancslistát
 * készít → jóváhagyás után a Command Bus-on fut le (actor: 'ai'), teljes
 * undo-val. Az AI sosem írja közvetlenül a projektet.
 */
/**
 * ↩️ A projekt visszaállítása egy korábbi pillanatképre: undo-val, amíg a history-ban
 * megvan (a referencia pontosan visszaáll); ha a pillanatkép már kiesett a history-ból
 * (teli, 50 lépés), egyetlen `RESTORE_SNAPSHOT` parancs állítja vissza (B8).
 */
function revertProjectTo(base: Project | null): void {
  if (!base) return;
  let guard = 0;
  while (
    useEditorStore.getState().project !== base &&
    useEditorStore.getState().past.includes(base) &&
    guard++ < 200
  ) {
    useEditorStore.getState().undo();
  }
  const cur = useEditorStore.getState().project;
  if (cur && cur !== base && cur.id === base.id) {
    useEditorStore.getState().dispatch({ type: 'RESTORE_SNAPSHOT', project: base }, 'user');
  }
}

export function AssistantPanel() {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [reply, setReply] = useState<{ message: string; commands: AiCommand[] } | null>(
    null
  );
  const [applied, setApplied] = useState<string | null>(null);
  // 🤖 before/after preview: az AI-köteg ideiglenesen alkalmazva, megtekintésre
  const [previewing, setPreviewing] = useState(false);
  const [previewCount, setPreviewCount] = useState(0);
  // az undo-verem hossza a preview ELŐTT — a revert EDDIG göngyölít vissza (a köteg
  // + a preview alatt esetleg tett szerkesztések), NEM vak undo() a user editjén
  // a preview ELŐTTI projekt-pillanatkép (referencia) — a history-hossz helyett ehhez
  // göngyölünk vissza: teli (50 lépéses) history-nál a hossz nem nő, a régi összevetés
  // halott „Visszavonás"-t adott (B8)
  const previewBase = useRef<Project | null>(null);
  const previewingRef = useRef(false);
  // worker-diagnosztika: mit hív a kliens, és eléri-e (a „nem érhető el”
  // hibák oka azonnal látszik: rossz URL vs. nem futó worker vs. hálózat)
  const [workerDiag, setWorkerDiag] = useState<string>(t('panels.assistant.workerChecking'));
  // 🤖 melyik AI-modell oldja meg a feladatot (a profilban felvett modellek közül);
  useEffect(() => {
    let alive = true;
    const base = renderServerUrl();
    // az első videóklip fájlja megvan-e — konténer-költözésnél (Expo Go
    // frissítés/újratelepítés) a mentett file:// utak elszakadnak, és minden
    // feltöltés némán elhasal, miközben a worker elérhető
    let fileInfo = '';
    if (Platform.OS !== 'web') {
      const project = useEditorStore.getState().project;
      const firstVideo = project?.tracks
        .filter((t) => t.type === 'video')
        .flatMap((t) => t.clips)
        .find((c) => c.kind === 'video');
      if (firstVideo && firstVideo.kind === 'video') {
        try {
          fileInfo = new File(firstVideo.uri).exists
            ? t('panels.assistant.mediaOk')
            : t('panels.assistant.mediaMissing');
        } catch {
          fileInfo = t('panels.assistant.mediaUncheckable');
        }
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(`${base}/health`, { signal: controller.signal })
      .then((res) => {
        if (alive) {
          setWorkerDiag(
            t('panels.assistant.workerStatus', {
              base,
              status: res.ok
                ? t('panels.assistant.workerReachable')
                : t('panels.assistant.workerHttpError', { status: res.status }),
              fileInfo,
            })
          );
        }
      })
      .catch(() => {
        if (alive) {
          setWorkerDiag(
            t('panels.assistant.workerStatus', {
              base,
              status: t('panels.assistant.workerUnreachable'),
              fileInfo,
            })
          );
        }
      })
      .finally(() => clearTimeout(timer));

    // automatikus feltöltés-próba: ugyanazzal a mintával, mint az elemzők —
    // ha ez elhasal, a diag-sor a PONTOS kliens-hibaüzenetet mutatja
    if (Platform.OS !== 'web') {
      const project = useEditorStore.getState().project;
      const probeVideo = project?.tracks
        .filter((t) => t.type === 'video')
        .flatMap((t) => t.clips)
        .find((c) => c.kind === 'video');
      if (probeVideo && probeVideo.kind === 'video') {
        const form = new FormData();
        form.append('media', new File(probeVideo.uri) as unknown as Blob, 'probe.mp4');
        form.append('atSec', '0');
        uploadFetch(`${base}/color/stats`, { method: 'POST', body: form })
          .then((r) => {
            if (alive) {
              setWorkerDiag(
                (prev) =>
                  `${prev}\n` +
                  t('panels.assistant.uploadProbe', {
                    result: r.ok
                      ? t('panels.assistant.uploadProbeOk')
                      : t('panels.assistant.uploadProbeHttpError', { status: r.status }),
                  })
              );
            }
          })
          .catch((e) => {
            console.warn('feltöltés-próba hiba:', (e as Error).message);
            if (alive) {
              setWorkerDiag(
                (prev) =>
                  `${prev}\n` +
                  t('panels.assistant.uploadProbeError', { message: (e as Error).message })
              );
            }
          });
      }
    }
    return () => {
      alive = false;
    };
    // csak mount-kor futó worker-diagnosztika; a `t` stabil referencia (i18next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🪝 kiemelt AI-módok busy-állapota: a MEGLÉVŐ busyLabel-aggregációt megőrizve
  // a panel tartja a slotot, a szekciók vezérlik propból (controlled status)
  const [hookBusy, setHookBusy] = useState<string | null>(null);
  const [productBusy, setProductBusy] = useState<string | null>(null);
  const [sfxBusy, setSfxBusy] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState<string | null>(null);

  const send = async (text: string) => {
    const state = useEditorStore.getState();
    if (!state.project || status) {
      return;
    }
    // 🔇 „vágd ki a csendeket" → a csend-vágás (eszközön, ingyen; jóváhagyással,
    // egy undo-lépésben) — nem a modellnek megy, hanem a determinisztikus útra
    if (isSilenceCutIntent(text)) {
      await cutDeadAir();
      return;
    }
    setStatus(t('panels.assistant.thinking'));
    setReply(null);
    setApplied(null);
    try {
      const context = buildAiContext(
        state.project,
        state.playhead,
        state.selectedClipId,
        state.events
      );
      // szemantikus réteg: a videók beszéde idővonal-időben (best-effort,
      // fájlonként cache-elve — worker/Whisper nélkül kimarad)
      const transcript = await withProgress(t('panels.assistant.progressTranscript'), (report) =>
        getTimelineTranscript(state.project!, report)
      ).catch(() => null);
      if (transcript && transcript.length > 0) {
        context.transcript = transcript;
      }
      setStatus(t('panels.assistant.thinking'));
      // 🧩 lokál-előút (ingyenes): az egyszerű utasítás helyben fordul parancsra,
      // worker/kvóta nélkül — csak a nem-illeszkedő kérés megy hálózatra
      const answer = await askAssistant(context, text, {
        project: state.project,
        playhead: state.playhead,
        selectedClipId: state.selectedClipId,
      });
      setReply(answer);
      setAiResult({
        ok: true,
        text: answer.commands.length > 0
          ? t('panels.assistant.replyReady', { count: answer.commands.length })
          : t('panels.assistant.replyNoCommands'),
      });
    } catch (err) {
      // 🧯 kétrétegű hiba: a fejlesztői részlet a logba, a felhasználó barátságos,
      // cselekvésre hívó üzenetet lát (nem nyers „TypeError: …")
      const appErr = toAppError(err);
      console.warn('AI kérés hiba:', appErr.detail);
      const friendly = t('errors.' + appErr.kind);
      setApplied(friendly);
      setAiResult({ ok: false, text: friendly });
    } finally {
      setStatus(null);
    }
  };

  const [cutStatus, setCutStatus] = useState<string | null>(null);

  /**
   * Holtidő-vágás (Editor AI cut-lista): determinisztikus FFmpeg-elemzés a
   * workeren — AI-kulcs nélkül is működik. A terv jóváhagyás után egyetlen
   * undo-lépésként fut le.
   */
  const cutDeadAir = async () => {
    const state = useEditorStore.getState();
    if (!state.project || cutStatus) {
      return;
    }
    setCutStatus(t('panels.assistant.silenceAnalysis'));
    try {
      const uris = [
        ...new Set(
          state.project.tracks
            .filter((t) => t.type === 'video')
            .flatMap((t) => t.clips)
            .filter((c) => c.kind === 'video')
            .map((c) => c.uri)
        ),
      ];
      if (uris.length === 0) {
        Alert.alert(t('panels.assistant.deadAirTitle'), t('panels.assistant.noVideoClip'));
        return;
      }
      const silencesByUri = new Map<string, SilenceRange[]>();
      for (let i = 0; i < uris.length; i++) {
        setCutStatus(t('panels.assistant.silenceAnalysisProgress', { current: i + 1, total: uris.length }));
        const silences = await detectSilence(uris[i]);
        if (silences) {
          silencesByUri.set(uris[i], silences);
        }
      }
      if (silencesByUri.size === 0) {
        Alert.alert(
          t('panels.assistant.deadAirTitle'),
          Platform.OS === 'web'
            ? t('panels.assistant.silenceWebUnavailable')
            : t('panels.assistant.silenceUnavailable', { url: `${renderServerUrl()}/silence` })
        );
        return;
      }
      const plan = buildCutPlan(state.project, silencesByUri);
      if (!plan) {
        Alert.alert(t('panels.assistant.deadAirTitle'), t('panels.assistant.noDeadAir'));
        return;
      }
      Alert.alert(
        t('panels.assistant.deadAirRemoveTitle'),
        t('panels.assistant.deadAirBody', {
          cuts: plan.cuts,
          seconds: plan.removedSeconds.toFixed(1),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.applyAction'),
            onPress: () => {
              // B16: MINDEN sáv ripple-ödik a kivágott szakaszokkal (felirat, szöveg, PiP, hang) —
              // a háttérzene folyamatos marad, csak tolódik; zárolt sáv érintetlen
              const st = useEditorStore.getState();
              const patches = st.project
                ? buildMultiRangeDeletePlan(st.project, plan.removedRanges, st.lockedTracks)
                : null;
              const ok = patches
                ? st.dispatch({ type: 'REPLACE_TRACKS', tracks: patches, label: t('panels.assistant.deadAirRemoveTitle') }, 'ai')
                : st.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips }, 'ai');
              setApplied(
                ok
                  ? t('panels.assistant.deadAirDone', {
                      cuts: plan.cuts,
                      seconds: plan.removedSeconds.toFixed(1),
                    })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setCutStatus(null);
    }
  };

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

  const [sceneStatus, setSceneStatus] = useState<string | null>(null);

  /**
   * Jelenetvágás: FFmpeg scene-detektálás a workeren → a klipek felvágása a
   * jelenetváltásoknál (elrendezés változatlan, csak vágások kerülnek be).
   * Utána a darabok egyenként törölhetők/rendezhetők.
   */
  const splitAtScenes = async () => {
    const state = useEditorStore.getState();
    if (!state.project || sceneStatus) {
      return;
    }
    setSceneStatus(t('panels.assistant.sceneAnalysis'));
    try {
      const uris = [
        ...new Set(
          state.project.tracks
            .filter((t) => t.type === 'video')
            .flatMap((t) => t.clips)
            .filter((c) => c.kind === 'video')
            .map((c) => c.uri)
        ),
      ];
      if (uris.length === 0) {
        Alert.alert(t('panels.assistant.sceneCutTitle'), t('panels.assistant.noVideoClip'));
        return;
      }
      const scenesByUri = new Map<string, number[]>();
      for (let i = 0; i < uris.length; i++) {
        setSceneStatus(t('panels.assistant.sceneAnalysisProgress', { current: i + 1, total: uris.length }));
        const scenes = await detectScenes(uris[i]);
        if (scenes) {
          scenesByUri.set(uris[i], scenes);
        }
      }
      if (scenesByUri.size === 0) {
        Alert.alert(
          t('panels.assistant.sceneCutTitle'),
          t('panels.assistant.sceneAnalysisUnavailable')
        );
        return;
      }
      const plan = buildSceneSplitPlan(state.project, scenesByUri);
      if (!plan) {
        Alert.alert(t('panels.assistant.sceneCutTitle'), t('panels.assistant.noSceneChange'));
        return;
      }
      Alert.alert(
        t('panels.assistant.sceneCutHeader'),
        t('panels.assistant.sceneCutBody', { count: plan.splits }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.splitAction'),
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? t('panels.assistant.sceneCutDone', { count: plan.splits })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setSceneStatus(null);
    }
  };

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
    const ranges = variant.keep
      .map((k) => ({
        start: Math.max(0, Math.min(k.start, duration)),
        end: Math.max(0, Math.min(k.end, duration)),
      }))
      .filter((r) => r.end - r.start > 0.05);
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

  const [beatStatus, setBeatStatus] = useState<string | null>(null);
  const [fxStatus, setFxStatus] = useState<string | null>(null);

  const applyBeatFx = async (kind: 'pulse' | 'flash') => {
    const state = useEditorStore.getState();
    if (!state.project || fxStatus) {
      return;
    }
    setFxStatus(t('panels.assistant.beatAnalysis'));
    try {
      const musicClip = state.project.tracks
        .filter((t) => t.type === 'music')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'audio')
        .sort((a, b) => a.start - b.start)[0];
      if (!musicClip || musicClip.kind !== 'audio') {
        Alert.alert(t('panels.assistant.beatFxTitle'), t('panels.assistant.addMusicFirst'));
        return;
      }
      const grid = await detectBeats(musicClip.uri);
      if (!grid || grid.bpm === 0 || grid.beats.length < 4) {
        Alert.alert(t('panels.assistant.beatFxTitle'), t('panels.assistant.noBeatGrid'));
        return;
      }
      if (kind === 'pulse') {
        // gyors zenénél downbeatenként pulzál, különben minden beatre
        const useDownbeats = grid.bpm > 110;
        const times = timelineBeats(musicClip, useDownbeats ? grid.downbeats : grid.beats);
        const plan = buildBeatPulsePlan(state.project, times);
        if (!plan) {
          Alert.alert(
            t('panels.assistant.beatPulseTitle'),
            t('panels.assistant.beatPulseNoClip')
          );
          return;
        }
        Alert.alert(
          t('panels.assistant.beatPulseTitle'),
          t('panels.assistant.beatPulseBody', { pulses: plan.pulses, bpm: grid.bpm }) +
            (plan.skipped > 0
              ? t('panels.assistant.beatPulseSkipped', { count: plan.skipped })
              : '') +
            t('panels.assistant.beatPulseUndo'),
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
                    ? t('panels.assistant.beatPulseDone', { count: plan.pulses })
                    : t('panels.assistant.failedShort')
                );
              },
            },
          ]
        );
      } else {
        const times = timelineBeats(musicClip, grid.downbeats);
        const plan = buildBeatFlashPlan(state.project, times, () => makeId('clip'));
        if (!plan) {
          Alert.alert(t('panels.assistant.beatFlashTitle'), t('panels.assistant.beatFlashNoDownbeat'));
          return;
        }
        Alert.alert(
          t('panels.assistant.beatFlashTitle'),
          t('panels.assistant.beatFlashBody', { flashes: plan.flashes, bpm: grid.bpm }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('panels.assistant.applyAction'),
              onPress: () => {
                const ok = useEditorStore
                  .getState()
                  .dispatch(
                    { type: 'REPLACE_TRACK_CLIPS', trackType: 'overlay', clips: plan.clips },
                    'ai'
                  );
                setApplied(
                  ok
                    ? t('panels.assistant.beatFlashDone', { count: plan.flashes })
                    : t('panels.assistant.failedShort')
                );
              },
            },
          ]
        );
      }
    } finally {
      setFxStatus(null);
    }
  };

  /**
   * Auto Beat Edit (P0‑2): a zenesáv első klipjének beat-rácsa a workertől →
   * a videóklipek felvágása az ütemeken (gyors tempónál a downbeat-eken).
   * Nem ripple; egy undo-lépés.
   */
  const splitOnBeats = async () => {
    const state = useEditorStore.getState();
    if (!state.project || beatStatus) {
      return;
    }
    setBeatStatus(t('panels.assistant.beatAnalysis'));
    try {
      const musicClip = state.project.tracks
        .filter((t) => t.type === 'music')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'audio')
        .sort((a, b) => a.start - b.start)[0];
      if (!musicClip || musicClip.kind !== 'audio') {
        Alert.alert(t('panels.assistant.beatCutTitle'), t('panels.assistant.addMusicFirst'));
        return;
      }
      const grid = await detectBeats(musicClip.uri);
      if (!grid) {
        Alert.alert(
          t('panels.assistant.beatCutTitle'),
          t('panels.assistant.beatAnalysisUnavailable')
        );
        return;
      }
      if (grid.bpm === 0 || grid.beats.length < 4) {
        Alert.alert(t('panels.assistant.beatCutTitle'), t('panels.assistant.noBeatInMusic'));
        return;
      }
      // 135 BPM felett a minden-beat vágás már villódzás — ott a downbeat vág
      const useDownbeats = grid.bpm > 135;
      const times = timelineBeats(musicClip, useDownbeats ? grid.downbeats : grid.beats);
      const plan = buildBeatSplitPlan(state.project, times);
      if (!plan) {
        Alert.alert(t('panels.assistant.beatCutTitle'), t('panels.assistant.noBeatInsideClips'));
        return;
      }
      Alert.alert(
        t('panels.assistant.beatCutHeader'),
        t('panels.assistant.beatCutBody', {
          bpm: grid.bpm,
          downbeatNote: useDownbeats ? t('panels.assistant.beatCutDownbeatNote') : '',
          splits: plan.splits,
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.splitAction'),
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? t('panels.assistant.beatCutDone', { splits: plan.splits, bpm: grid.bpm })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setBeatStatus(null);
    }
  };

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
    smartReframe().catch((err: Error) => Alert.alert(t('panels.assistant.reframeTitle'), err.message));
  };

  /**
   * 🔔 A tevékenység-sáv a MEGLÉVŐ állapotokból származik — nem kellett a 13
   * hívási helyet átírni. Bármelyik fut, a sáv látszik, és mutatja az eltelt
   * időt is (ez különbözteti meg a „dolgozik"-ot a „beragadt"-tól).
   */
  const busyLabel =
    status ??
    hookBusy ??
    productBusy ??
    cutStatus ??
    sceneStatus ??
    autoStatus ??
    beatStatus ??
    fxStatus ??
    sfxBusy ??
    reframeStatus ??
    searchBusy ??
    highlightStatus ??
    footageStatus ??
    brollStatus ??
    null;
  const [aiResult, setAiResult] = useState<AiResult | null>(null);

  // 👁️ terv-elem előnézete alkalmazás ELŐTT: a lejátszófej az érintett régióra
  // ugrik, és (ha van) kijelöli az érintett klipet — a felhasználó látja, mit
  // fog az AI módosítani, mielőtt jóváhagyja.
  const previewPlanItem = (item: AiPlanItem) => {
    const s = useEditorStore.getState();
    if (item.time != null) {
      s.setPlayhead(item.time);
    }
    if (item.clipId) {
      s.selectClip(item.clipId);
    }
  };

  const apply = () => {
    if (!reply) {
      return;
    }
    // proveniencia (#34): az AI-hozzáadott elemek megkapják az AI indoklását
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const commands = toEditorCommands(partitionAiCommands(reply.commands, project).accepted, project, reply.message);
    // #57 smart undo: a teljes AI-köteg EGY undo-lépés (nem parancsonként külön)
    const ok = useEditorStore.getState().applyBatch(commands, 'ai');
    setReply(null);
    setInstruction('');
    setApplied(
      ok > 0
        ? t('panels.assistant.commandsApplied', { count: ok })
        : t('panels.assistant.noApplicableCommand')
    );
  };

  /**
   * 🤖 Before/after preview: az AI-köteget IDEIGLENESEN alkalmazzuk, hogy a
   * felhasználó a preview-felületen lássa a VALÓDI eredményt, majd megtarthatja
   * (marad az undo-előzményben) vagy visszavonhatja. A revert a preview ELŐTTI
   * undo-mélységig göngyölít vissza (lásd `revertToBase`) — nem vak `undo()`.
   */
  const previewAll = () => {
    if (!reply) {
      return;
    }
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const commands = toEditorCommands(partitionAiCommands(reply.commands, project).accepted, project, reply.message);
    const baseProject = useEditorStore.getState().project;
    const ok = useEditorStore.getState().applyBatch(commands, 'ai');
    if (ok > 0) {
      previewBase.current = baseProject;
      setPreviewCount(ok);
      setPreviewing(true);
      haptics.selection();
    } else {
      setApplied(t('panels.assistant.noApplicableCommand'));
    }
  };
  const keepPreview = () => {
    setPreviewing(false);
    setReply(null);
    setInstruction('');
    setApplied(t('panels.assistant.commandsApplied', { count: previewCount }));
    haptics.success();
  };
  // a projektet a preview ELŐTTI állapotra göngyölíti vissza a command-buson át
  // (nem vak undo()): a köteget ÉS a preview alatt tett szerkesztéseket is
  // visszavonja, így sosem a user egy random editjét törli.
  const revertToBase = () => revertProjectTo(previewBase.current);
  const revertPreview = () => {
    revertToBase();
    setPreviewing(false);
    haptics.selection();
  };
  // a preview állapotot ref-ben is tartjuk (a unmount-cleanup olvassa)
  useEffect(() => {
    previewingRef.current = previewing;
  }, [previewing]);
  // panel-váltás / unmount PREVIEW közben → AUTO-REVERT: ne maradjon árva, csendben
  // véglegesített ideiglenes köteg (store-only, nincs setState unmountoltan).
  useEffect(
    () => () => {
      if (previewingRef.current) {
        revertProjectTo(previewBase.current);
      }
    },
    []
  );

  // AI Command Bar (P0‑1): a leggyakoribb power-parancsok egy sorban —
  // determinisztikus eszközök és AI-promptok vegyesen, egy koppintásra
  const commandBar: { label: string; run: () => void }[] = [
    {
      label: t('panels.assistant.cmdSilenceOut'),
      run: () => {
        cutDeadAir().catch((err: Error) => Alert.alert(t('panels.assistant.deadAirTitle'), err.message));
      },
    },
    {
      label: t('panels.assistant.cmdBeatCut'),
      run: () => {
        splitOnBeats().catch((err: Error) => Alert.alert(t('panels.assistant.beatCutTitle'), err.message));
      },
    },
    {
      label: t('panels.assistant.cmdReframe'),
      run: () => {
        smartReframe().catch((err: Error) => Alert.alert(t('panels.assistant.reframeTitle'), err.message));
      },
    },
    {
      label: t('panels.assistant.cmdShort30'),
      run: () => {
        setTargetSeconds(30);
        startAutoEdit().catch((err: Error) => Alert.alert(t('panels.assistant.autoEditTitle'), err.message));
      },
    },
    { label: t('panels.assistant.cmdCaption'), run: () => send(t('panels.assistant.promptCaption')) },
    { label: t('panels.assistant.cmdTitleHook'), run: () => send(t('panels.assistant.promptTitleHook')) },
  ];

  // 🤖 B17: a válasz parancsai a VALÓDI projekt ellen szétválogatva — a lista, a darabszám
  // és a végrehajtás is ebből jön (eddig a nyers listát mutattuk, a kiszűrtekkel együtt)
  const planProject = useEditorStore.getState().project;
  const plan = reply && planProject ? partitionAiCommands(reply.commands, planProject) : null;

  return (
    <View>
      <AiActivity
        key={busyLabel ?? 'idle'}
        busyLabel={busyLabel}
        result={aiResult}
        onDismiss={() => setAiResult(null)}
      />
      <PanelSection title={t('panels.assistant.modelSection')}>
        <AiCharacterPicker task="assistant" />
        <Text style={styles.modelHint}>{t('panels.assistant.modelHint')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionCommands')}>
        <View style={styles.row}>
          {commandBar.map((cmd) => (
            <Chip key={cmd.label} label={cmd.label} active={false} onPress={cmd.run} />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionAutoEdit')}>
        <AiProviderPicker task="autoEdit" />
        <View style={styles.row}>
          {[15, 30, 60].map((sec) => (
            <Chip
              key={sec}
              label={t('panels.assistant.seconds', { count: sec })}
              active={targetSeconds === sec}
              onPress={() => setTargetSeconds(sec)}
            />
          ))}
        </View>
        <PrimaryButton
          icon="flash-outline"
          label={autoStatus ?? t('panels.assistant.autoEditStart', { seconds: targetSeconds })}
          onPress={() => {
            startAutoEdit().catch((err: Error) => Alert.alert('Auto Edit', err.message));
          }}
        />
        {autoResult ? (
          <>
            {autoResult.variants.map((variant) => (
              <Pressable
                key={variant.id}
                style={[
                  styles.variantCard,
                  previewingId === variant.id ? styles.variantCardActive : null,
                ]}
                onPress={() => applyVariant(variant)}
              >
                <Text style={styles.variantTitle}>{variant.title}</Text>
                <Text style={styles.variantMeta}>
                  {t('panels.assistant.variantMeta', {
                    seconds: variant.keep
                      .reduce((s, k) => s + Math.max(0, k.end - k.start), 0)
                      .toFixed(1),
                    segments: variant.keep.length,
                    captions: variant.captions.length,
                  })}
                </Text>
                <Text style={styles.variantRationale} numberOfLines={2}>
                  {variant.rationale}
                </Text>
                <View style={styles.variantActions}>
                  <Chip
                    label={
                      previewingId === variant.id
                        ? t('panels.assistant.previewStop')
                        : t('panels.assistant.previewPlay')
                    }
                    active={previewingId === variant.id}
                    onPress={() => previewVariant(variant)}
                  />
                </View>
              </Pressable>
            ))}
            <Text style={styles.note}>
              {autoResult.source === 'ai'
                ? t('panels.assistant.variantsAiNote')
                : t('panels.assistant.variantsHeuristicNote')}
            </Text>
          </>
        ) : (
          <Text style={styles.note}>{t('panels.assistant.autoEditIntro')}</Text>
        )}

        {/* 🎯 long-form → shorts: önálló highlight-jelöltek (Phase 3.3) */}
        <PrimaryButton
          icon="albums-outline"
          label={highlightStatus ?? t('panels.assistant.findShortsBtn')}
          onPress={() => {
            findShorts().catch((err: Error) => Alert.alert(t('panels.assistant.shortsTitle'), err.message));
          }}
        />
        {highlights?.map((h, i) => (
          <Pressable
            key={`hl-${i}-${h.start.toFixed(1)}`}
            style={styles.variantCard}
            onPress={() => useEditorStore.getState().setPlayhead(h.start)}
          >
            <Text style={styles.variantTitle}>{h.title || t('panels.assistant.shortsTitle')}</Text>
            <Text style={styles.variantMeta}>
              ▶ {formatTime(h.start)}–{formatTime(h.end)} · {(h.end - h.start).toFixed(0)}s
            </Text>
            <Text style={styles.variantRationale} numberOfLines={2}>
              {h.reason}
            </Text>
          </Pressable>
        ))}
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionWhatToDo')}>
        <TextInput
          value={instruction}
          onChangeText={setInstruction}
          multiline
          style={styles.input}
          placeholder={t('panels.assistant.instructionPlaceholder')}
          placeholderTextColor={palette.textDim}
        />
        <PrimaryButton
          icon="sparkles-outline"
          label={status ?? t('panels.assistant.sendToAssistant')}
          onPress={() => {
            if (instruction.trim()) {
              send(instruction.trim());
            }
          }}
        />
        <View style={styles.row}>
          {QUICK_ACTIONS.map((action) => {
            const actionLabel = t(`panels.assistant.quickAction_${action}`);
            // egyes műveletek a labelnél GAZDAGABB utasítást küldenek (pl. „tedd
            // ütősebbé" → több-lépéses terv); ha nincs ilyen kulcs, a label megy
            const instructionText = t(`panels.assistant.quickActionText_${action}`, {
              defaultValue: actionLabel,
            });
            return (
              <Chip
                key={action}
                label={actionLabel}
                active={false}
                onPress={() => send(instructionText)}
              />
            );
          })}
        </View>
      </PanelSection>

      <SmartSearchSection busy={searchBusy} setBusy={setSearchBusy} />

      <HooksSection busy={hookBusy} setBusy={setHookBusy} setApplied={setApplied} />

      <LookPacksSection busy={productBusy} setBusy={setProductBusy} setApplied={setApplied} />

      <BrandKitSection />

      <PanelSection title={t('panels.assistant.sectionCutTools')}>
        <PrimaryButton
          icon="cut-outline"
          label={cutStatus ?? t('panels.assistant.cutDeadAirBtn')}
          onPress={() => {
            cutDeadAir().catch((err: Error) => Alert.alert(t('panels.assistant.deadAirTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="film-outline"
          label={sceneStatus ?? t('panels.assistant.splitScenesBtn')}
          onPress={() => {
            splitAtScenes().catch((err: Error) => Alert.alert(t('panels.assistant.sceneCutTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="musical-notes-outline"
          label={beatStatus ?? t('panels.assistant.splitBeatsBtn')}
          onPress={() => {
            splitOnBeats().catch((err: Error) => Alert.alert(t('panels.assistant.beatCutTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="pulse-outline"
          label={fxStatus ?? t('panels.assistant.beatPulseBtn')}
          onPress={() => {
            applyBeatFx('pulse').catch((err: Error) => Alert.alert(t('panels.assistant.beatFxTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="flash-outline"
          label={fxStatus ?? t('panels.assistant.beatFlashBtn')}
          onPress={() => {
            applyBeatFx('flash').catch((err: Error) => Alert.alert(t('panels.assistant.beatFxTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="crop-outline"
          label={reframeStatus ?? t('panels.assistant.smartReframeBtn')}
          onPress={() => {
            smartReframe().catch((err: Error) => Alert.alert(t('panels.assistant.reframeTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="search-outline"
          label={footageStatus ?? t('panels.assistant.footageCheckBtn')}
          onPress={() => {
            footageCheck().catch((err: Error) => Alert.alert(t('panels.assistant.footageTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="images-outline"
          label={brollStatus ?? t('panels.assistant.brollBtn')}
          onPress={() => {
            findBroll().catch((err: Error) => Alert.alert(t('panels.assistant.brollTitle'), err.message));
          }}
        />
        <Text style={styles.note}>{t('panels.assistant.cutToolsNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionSocial')}>
        <View style={styles.row}>
          {SOCIAL_PRESETS.map((p) => (
            <Chip
              key={p.id}
              label={`${p.label} · ${p.aspect}`}
              active={false}
              onPress={() => applySocialPreset(p.aspect)}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.assistant.socialNote')}</Text>
      </PanelSection>

      <SoundDesignSection busy={sfxBusy} setBusy={setSfxBusy} />

      {reply ? (
        <PanelSection title={t('panels.assistant.sectionSuggestion')}>
          <Text style={styles.message}>{reply.message}</Text>
          {/* 🚫 B17: ami a validáción kiesett / csonkult — okkal, hogy a jóváhagyott terv = a végrehajtás */}
          {plan && plan.rejected.length > 0 ? (
            <View style={styles.rejectBox}>
              <Text style={styles.rejectHead}>
                {t('panels.assistant.rejectedHeader', { count: plan.rejected.length })}
              </Text>
              {plan.rejected.map((r, i) => (
                <Text key={i} style={styles.rejectRow}>
                  • {r.command.type}: {t(`panels.assistant.reject_${r.code}`, { detail: r.detail ?? '' })}
                </Text>
              ))}
            </View>
          ) : null}
          {plan && plan.accepted.length > 0 ? (
            <>
              {/* 🤖 Terv-preview (control layer): tételes, FELOLDOTT diff — melyik
                  klip, mi változik miről mire; ▶-vel a régióra ugorva alkalmazás ELŐTT */}
              <Text style={styles.changeHeader}>
                {t('panels.assistant.planHeader', { count: plan.accepted.length })}
              </Text>
              {describeAiPlan(
                plan.accepted,
                useEditorStore.getState().project!,
                t
              ).map((item, i) => (
                <View key={i} style={styles.planRow}>
                  <View style={styles.planBody}>
                    <Text style={styles.planTitle}>{item.title}</Text>
                    {item.detail ? <Text style={styles.planDetail}>{item.detail}</Text> : null}
                    {item.reason ? <Text style={styles.planReason}>💡 {item.reason}</Text> : null}
                  </View>
                  {item.time != null ? (
                    <Pressable
                      style={styles.planJump}
                      onPress={() => previewPlanItem(item)}
                      hitSlop={8}
                    >
                      <Ionicons name="eye-outline" size={14} color={palette.accent} />
                      <Text style={styles.planJumpText}>{t('panels.assistant.planPreview')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {previewing ? (
                <>
                  <Text style={styles.note}>{t('panels.assistant.previewingNote')}</Text>
                  <PrimaryButton
                    icon="checkmark"
                    label={t('panels.assistant.keepChanges')}
                    onPress={keepPreview}
                  />
                  <Chip
                    label={t('panels.assistant.revert')}
                    active={false}
                    onPress={revertPreview}
                  />
                </>
              ) : (
                <>
                  <Chip
                    label={t('panels.assistant.previewAll')}
                    active={false}
                    onPress={previewAll}
                  />
                  <PrimaryButton
                    icon="checkmark"
                    label={t('panels.assistant.applyCommandsBtn', { count: plan.accepted.length })}
                    onPress={apply}
                  />
                  <Text style={styles.note}>{t('panels.assistant.planApproveNote')}</Text>
                </>
              )}
            </>
          ) : null}
          {previewing ? null : (
            <Chip label={t('panels.assistant.discard')} active={false} onPress={() => setReply(null)} />
          )}
        </PanelSection>
      ) : null}

      {applied ? <Text style={styles.note}>{applied}</Text> : null}

      <Text style={styles.note}>{t('panels.assistant.assistantFooter')}</Text>
      <Text style={styles.note}>{workerDiag}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rejectBox: {
    borderWidth: 1,
    borderColor: palette.warning,
    borderRadius: 8,
    padding: 8,
    gap: 2,
    marginVertical: 6,
  },
  rejectHead: { color: palette.warning, fontSize: 12, fontWeight: '800' },
  rejectRow: { color: palette.textDim, fontSize: 12, lineHeight: 16 },
  variantCard: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  variantCardActive: {
    borderColor: palette.accent,
  },
  variantActions: {
    flexDirection: 'row',
    marginTop: 6,
  },
  variantTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  modelHint: {
    color: palette.textDim,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  message: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
  },
  changeHeader: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  planBody: {
    flex: 1,
    gap: 2,
  },
  planTitle: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
  },
  planDetail: {
    color: palette.textDim,
    fontSize: 12,
    lineHeight: 17,
  },
  planReason: {
    color: palette.accent,
    fontSize: 11,
    lineHeight: 16,
  },
  planJump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  planJumpText: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
