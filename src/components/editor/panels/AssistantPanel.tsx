import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiActivity } from '@/components/editor/AiActivity';
import type { AiResult } from '@/components/editor/AiActivity';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { aspectValue, palette } from '@/constants/editor';
import { uploadFetch } from '@/lib/upload';
import { askAssistant } from '@/lib/ai';
import {
  type AiProvider,
  listAiProviders,
  listTaskAssignments,
  setTaskAssignment,
} from '@/lib/aiProviders';
import { buildAiContext, describeAiCommand, toEditorCommands } from '@/lib/aiCommands';
import type { AiCommand } from '@/lib/aiCommands';
import {
  applyBrandCaptions,
  buildWatermarkClip,
  deriveBrandKit,
  describeBrandKit,
} from '@/lib/brandKit';
import type { BrandKit } from '@/lib/brandKit';
import {
  INTRO_TEMPLATES,
  OUTRO_TEMPLATES,
  buildBrandSegmentPlan,
} from '@/lib/brandIntro';
import type { IntroTemplate, OutroTemplate } from '@/lib/brandIntro';
import { loadBrandKit, saveBrandKit } from '@/lib/brandStore';
import { buildHookClip, replaceHookClips } from '@/lib/hooks';
import type { HookSuggestion } from '@/lib/hooks';
import { fetchHooks } from '@/lib/hooksClient';
import { makeId } from '@/lib/id';
import { getTimelineTranscript } from '@/lib/transcripts';
import { compileVariant } from '@/lib/autoedit';
import type { AutoEditVariant } from '@/lib/autoedit';
import { runAutoEditFlow } from '@/lib/autoeditClient';
import { buildBeatFlashPlan, buildBeatPulsePlan } from '@/lib/beatFx';
import { buildBeatSplitPlan, detectBeats, timelineBeats } from '@/lib/beats';
import { planSoundDesign, usedSfxIds } from '@/lib/soundDesign';
import type { SfxId, SfxPlacement } from '@/lib/soundDesign';
import { buildCutPlan, buildSceneSplitPlan, detectScenes, detectSilence } from '@/lib/cutlist';
import type { SilenceRange } from '@/lib/cutlist';
import { MOTION_PACKS, buildMotionPackPlan } from '@/lib/motionPacks';
import { buildProductAdPlan } from '@/lib/productAd';
import type { MotionPack } from '@/lib/motionPacks';
import { clipsAt, projectDuration } from '@/lib/projectUtils';
import { buildSmartReframe } from '@/lib/reframeClient';
import { downloadTrack, fetchSoundLibrary, renderServerUrl } from '@/lib/render';
import { formatTime } from '@/lib/time';
import { analyzeQuality } from '@/lib/qualityClient';
import { fetchShotScores } from '@/lib/shotScore';
import { fetchThumbHeadlines } from '@/lib/thumbStudio';
import { mergeSearchHits, searchTranscript } from '@/lib/transcriptSearch';
import { indexProjectVision, searchVision } from '@/lib/visionSearch';
import type { SearchHit } from '@/lib/visionIndex';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { VideoClip } from '@/types/project';

const QUICK_ACTIONS = ['makeEngaging', 'shorten30', 'addTitleCta', 'captionsLowerThird', 'unifyCaptions'];

/**
 * AI-asszisztens (full-plan F3): utasítás → a worker Claude-dal parancslistát
 * készít → jóváhagyás után a Command Bus-on fut le (actor: 'ai'), teljes
 * undo-val. Az AI sosem írja közvetlenül a projektet.
 */
export function AssistantPanel() {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [reply, setReply] = useState<{ message: string; commands: AiCommand[] } | null>(
    null
  );
  const [applied, setApplied] = useState<string | null>(null);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [intro, setIntro] = useState<IntroTemplate | null>(null);
  const [outro, setOutro] = useState<OutroTemplate | null>(null);
  // worker-diagnosztika: mit hív a kliens, és eléri-e (a „nem érhető el”
  // hibák oka azonnal látszik: rossz URL vs. nem futó worker vs. hálózat)
  const [workerDiag, setWorkerDiag] = useState<string>(t('panels.assistant.workerChecking'));
  // 🤖 melyik AI-modell oldja meg a feladatot (a profilban felvett modellek közül);
  // null = Auto (az alapértelmezett modell, majd a worker env-AI-ja)
  const [aiModels, setAiModels] = useState<AiProvider[]>([]);
  const [assistantModel, setAssistantModel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listAiProviders(), listTaskAssignments()])
      .then(([list, tasks]) => {
        if (alive) {
          setAiModels(list);
          setAssistantModel(tasks.assistant ?? null);
        }
      })
      .catch(() => {
        // nincs backend/bejelentkezés → nincs modellválasztó, marad az Auto
      });
    return () => {
      alive = false;
    };
  }, []);

  // modellválasztás a feladathoz — optimista, és perzisztálva (user_ai_task_providers)
  const pickAssistantModel = (id: string | null) => {
    setAssistantModel(id);
    setTaskAssignment('assistant', id).catch(() => {
      // best-effort; a következő betöltés úgyis a szerver-állapotot mutatja
    });
  };

  useEffect(() => {
    let alive = true;
    loadBrandKit().then((kit) => {
      if (alive) {
        setBrandKit(kit);
      }
    });
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

  // 🎬 Look-csomag: kamera + átmenetek + lighting egy koppintásra, egy undóban
  const applyMotionPack = (pack: MotionPack) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const plan = buildMotionPackPlan(state.project, pack);
    if (!plan) {
      Alert.alert(t('panels.assistant.lookPackTitle'), t('panels.assistant.lookPackNoClip'));
      return;
    }
    Alert.alert(
      t('panels.assistant.lookPackHeader', { pack: MOTION_PACKS[pack].label }),
      t('panels.assistant.lookPackBody', { count: plan.touched }) +
        (plan.skippedCamera > 0
          ? t('panels.assistant.lookPackSkipped', { count: plan.skippedCamera })
          : '') +
        t('panels.assistant.lookPackUndo'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('panels.assistant.applyAction'),
          onPress: () => {
            const ok = useEditorStore
              .getState()
              .dispatch(
                { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                'user'
              );
            setApplied(
              ok
                ? t('panels.assistant.lookPackApplied', {
                    pack: MOTION_PACKS[pack].label,
                    count: plan.touched,
                  })
                : t('panels.assistant.applyFailed')
            );
          },
        },
      ]
    );
  };

  // 🪝 Hook Generator: erősebb nyitómondatok a videó témájából
  const [hookStatus, setHookStatus] = useState<string | null>(null);
  const [hooks, setHooks] = useState<HookSuggestion[] | null>(null);

  const generateHooks = async () => {
    const state = useEditorStore.getState();
    if (!state.project || hookStatus) {
      return;
    }
    setHookStatus(t('panels.assistant.hookWriting'));
    try {
      const transcript = await getTimelineTranscript(state.project).catch(() => null);
      const lines = (transcript ?? []).slice(0, 12).map((l) => l.text);
      const summary = `${state.project.name}\n${lines.join('\n')}`.slice(0, 900);
      const list = await fetchHooks(summary);
      if (!list) {
        Alert.alert(
          t('panels.assistant.hookGeneratorTitle'),
          t('panels.assistant.hookUnavailable')
        );
        return;
      }
      setHooks(list);
    } finally {
      setHookStatus(null);
    }
  };

  /** a választott hook cím-klipként a szöveg-sáv elejére (a korábbit cserélve) */
  const applyHook = (hook: HookSuggestion) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const clip = buildHookClip(
      hook.text,
      projectDuration(state.project),
      () => makeId('clip')
    );
    const textTrack = state.project.tracks.find((t) => t.type === 'text');
    const clips = replaceHookClips(
      (textTrack?.clips ?? []) as never,
      clip
    ) as typeof clip[];
    const ok = state.dispatch(
      { type: 'REPLACE_TRACK_CLIPS', trackType: 'text', clips },
      'ai'
    );
    setApplied(
      ok ? t('panels.assistant.hookApplied', { text: hook.text }) : t('panels.assistant.applyFailed')
    );
  };

  // 🛍️ Product showcase: a legjobb pillanatokból 10 mp-es termékvideó
  const [productStatus, setProductStatus] = useState<string | null>(null);

  const makeProductAd = async () => {
    const state = useEditorStore.getState();
    if (!state.project || productStatus) {
      return;
    }
    const source = state.project.tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .filter((c): c is VideoClip => c.kind === 'video')
      .sort((a, b) => a.start - b.start)[0];
    if (!source) {
      Alert.alert(t('panels.assistant.productAdTitle'), t('panels.assistant.productAdNeedsClip'));
      return;
    }
    setProductStatus(t('panels.assistant.productFindingMoments'));
    try {
      const scenes = (await detectScenes(source.uri)) ?? [];
      const times = [0.5, ...scenes.map((s) => s + 0.4)].slice(0, 16);
      const shots = await fetchShotScores(source.uri, times);
      if (!shots || shots.length === 0) {
        Alert.alert(
          t('panels.assistant.productAdTitle'),
          t('panels.assistant.productScoringUnavailable')
        );
        return;
      }
      setProductStatus(t('panels.assistant.productWritingHeadline'));
      const headlines = await fetchThumbHeadlines(
        t('panels.assistant.productHeadlinePrompt', { name: state.project.name })
      );
      const plan = buildProductAdPlan(source, shots, {
        targetSeconds: 10,
        headline: headlines?.[0],
        cta: t('panels.assistant.productCta'),
        makeId: () => makeId('clip'),
      });
      if (!plan) {
        Alert.alert(t('panels.assistant.productAdTitle'), t('panels.assistant.productNotEnoughMoments'));
        return;
      }
      setProductStatus(null);
      Alert.alert(
        t('panels.assistant.productAdEmojiTitle'),
        t('panels.assistant.productAdBody', {
          shots: plan.shots,
          seconds: plan.totalSeconds,
        }) +
          (plan.captions.length > 0
            ? t('panels.assistant.productAdCaption', { text: plan.captions[0].text })
            : '') +
          t('panels.assistant.productAdUndo'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.createAction'),
            onPress: () => {
              const s = useEditorStore.getState();
              const ok = s.dispatch(
                { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                'ai'
              );
              if (ok && plan.captions.length > 0) {
                s.dispatch(
                  { type: 'ADD_CLIPS', trackType: 'captions', clips: plan.captions },
                  'ai'
                );
              }
              setApplied(
                ok
                  ? t('panels.assistant.productAdDone', {
                      shots: plan.shots,
                      seconds: plan.totalSeconds,
                    })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setProductStatus(null);
    }
  };

  // 🎨 Brand Kit: stílusprofil mentése a nyitott projektből
  const learnBrand = async () => {
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const kit = deriveBrandKit(project, new Date().toISOString());
    if (!kit) {
      Alert.alert(
        t('panels.assistant.brandKitTitle'),
        t('panels.assistant.brandKitNoStyle')
      );
      return;
    }
    await saveBrandKit(kit);
    setBrandKit(kit);
    Alert.alert(t('panels.assistant.brandKitSaved'), describeBrandKit(kit));
  };

  // 🎨 Brand Kit: a mentett márka alkalmazása a nyitott projektre
  const applyBrand = async () => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project) {
      return;
    }
    const kit = brandKit ?? (await loadBrandKit());
    if (!kit) {
      Alert.alert(t('panels.assistant.brandKitTitle'), t('panels.assistant.brandKitNoSaved'));
      return;
    }
    let captionCount = 0;
    const captionsTrack = project.tracks.find((t) => t.type === 'captions');
    if (kit.caption && captionsTrack && captionsTrack.clips.length > 0) {
      const { clips, changed } = applyBrandCaptions(captionsTrack.clips, kit);
      if (changed > 0) {
        state.dispatch(
          { type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips },
          'user'
        );
        captionCount = changed;
      }
    }
    let watermarkAdded = false;
    if (kit.watermark) {
      const exists = project.tracks
        .flatMap((t) => t.clips)
        .some((c) => c.kind === 'shape' && c.imageUri === kit.watermark!.imageUri);
      if (!exists) {
        const clip = buildWatermarkClip(
          kit.watermark,
          projectDuration(project),
          makeId('clip')
        );
        watermarkAdded = state.dispatch(
          {
            type: 'ADD_CLIP',
            trackType: 'overlay',
            clip,
            asset: {
              id: makeId('ast'),
              kind: 'image',
              uri: kit.watermark.imageUri,
              provider: 'local',
              name: t('panels.assistant.watermarkName'),
            },
          },
          'user'
        );
      }
    }
    if (captionCount === 0 && !watermarkAdded) {
      Alert.alert(t('panels.assistant.brandKitTitle'), t('panels.assistant.brandNothingToApply'));
      return;
    }
    Alert.alert(
      t('panels.assistant.brandApplied'),
      [
        captionCount > 0
          ? t('panels.assistant.brandCaptionsRestyled', { count: captionCount })
          : null,
        watermarkAdded ? t('panels.assistant.brandWatermarkAdded') : null,
      ]
        .filter(Boolean)
        .join(' · ') + t('panels.assistant.brandUndoStepwise')
    );
  };

  const send = async (text: string) => {
    const state = useEditorStore.getState();
    if (!state.project || status) {
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
      const answer = await askAssistant(context, text);
      setReply(answer);
      setAiResult({
        ok: true,
        text: answer.commands.length > 0
          ? t('panels.assistant.replyReady', { count: answer.commands.length })
          : t('panels.assistant.replyNoCommands'),
      });
    } catch (err) {
      // a hiba MOSTANTÓL a panel tetején, feltűnően jelenik meg
      setApplied((err as Error).message);
      setAiResult({ ok: false, text: (err as Error).message });
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
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
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
  const [sfxStatus, setSfxStatus] = useState<string | null>(null);
  const [sfxPunch, setSfxPunch] = useState<'subtle' | 'normal' | 'punchy'>('normal');

  /** 🔊 Beat FX: zoom-pulzus az ütemekre vagy flash a downbeatekre */
  /**
   * 🎬 Intro/outro beszúrása a mentett márka (szín + logó + felirat-stílus)
   * alapján. Az intro RIPPLE: minden sáv csúszik a hosszával, ezért az egész
   * egyetlen REPLACE_TRACKS parancsban megy be — egy undo-lépés.
   */
  const applyBrandSegments = async () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    if (!intro && !outro) {
      Alert.alert(t('panels.assistant.introOutroTitle'), t('panels.assistant.introOutroPickTemplate'));
      return;
    }
    const kit = brandKit ?? (await loadBrandKit());
    const plan = buildBrandSegmentPlan(
      state.project.tracks.map((t) => ({ type: t.type, clips: t.clips })),
      {
        intro: intro ?? undefined,
        outro: outro ?? undefined,
        kit,
        title: state.project.name,
        makeId: () => makeId('clip'),
      }
    );
    if (!plan) {
      Alert.alert(t('panels.assistant.introOutroTitle'), t('panels.assistant.introOutroBuildFailed'));
      return;
    }
    Alert.alert(
      t('panels.assistant.introOutroTitle'),
      t('panels.assistant.introOutroBody', { summary: plan.summary }) +
        (plan.duration > 0
          ? t('panels.assistant.introOutroShift', { duration: plan.duration.toFixed(1) })
          : '') +
        (kit?.watermark
          ? t('panels.assistant.introOutroLogoIncluded')
          : t('panels.assistant.introOutroNoLogo')) +
        t('panels.assistant.introOutroUndo'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('panels.assistant.insertAction'),
          onPress: () => {
            useEditorStore.getState().dispatch(
              {
                type: 'REPLACE_TRACKS',
                tracks: plan.tracks,
                label: t('panels.assistant.introOutroUndoLabel', { summary: plan.summary }),
              },
              'user'
            );
          },
        },
      ]
    );
  };

  /**
   * 🔊 Sound Design AI v1: a vágópontokra és a beat-rácsra oszt ki SFX-eket a
   * worker generált könyvtárából (whoosh/bassdrop/riser/pop). A terv pure
   * (soundDesign.ts), itt csak a jelek összegyűjtése, a fájlok letöltése és a
   * sávra rakás megy — egy undo-lépésben.
   */
  const runSoundDesign = async () => {
    const state = useEditorStore.getState();
    if (!state.project || sfxStatus) {
      return;
    }
    const project = state.project;
    const videoClips = project.tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .sort((a, b) => a.start - b.start);
    if (videoClips.length === 0) {
      Alert.alert(t('panels.assistant.soundDesignTitle'), t('panels.assistant.soundDesignNeedsVideo'));
      return;
    }

    setSfxStatus(t('panels.assistant.analyzing'));
    try {
      // vágópontok: minden klip-kezdet az első után
      const cuts = videoClips.slice(1).map((c) => c.start);
      // hangsúlyok: felirat- és overlay-megjelenések
      const accents = project.tracks
        .filter((t) => t.type === 'captions' || t.type === 'overlay')
        .flatMap((t) => t.clips)
        .map((c) => c.start);

      // beat-rács, ha van zene (enélkül is dolgozunk, csak vágásra)
      let beats: number[] = [];
      let downbeats: number[] = [];
      const musicClip = project.tracks
        .filter((t) => t.type === 'music')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'audio')
        .sort((a, b) => a.start - b.start)[0];
      if (musicClip && musicClip.kind === 'audio') {
        setSfxStatus(t('panels.assistant.beatAnalysis'));
        const grid = await detectBeats(musicClip.uri);
        if (grid && grid.bpm > 0) {
          beats = timelineBeats(musicClip, grid.beats);
          downbeats = timelineBeats(musicClip, grid.downbeats);
        }
      }

      const duration = Math.max(
        ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
        0
      );
      const plan = planSoundDesign(
        { cuts, beats, downbeats, accents, duration },
        { intensity: sfxPunch }
      );
      if (plan.length === 0) {
        Alert.alert(
          t('panels.assistant.soundDesignTitle'),
          t('panels.assistant.soundDesignNoPoints')
        );
        return;
      }

      // a szükséges SFX-fájlok letöltése (mindegyik csak egyszer)
      setSfxStatus(t('panels.assistant.downloadingSounds'));
      const library = await fetchSoundLibrary();
      const uriById = new Map<SfxId, { uri: string; name: string }>();
      for (const id of usedSfxIds(plan)) {
        const track = library.find((t) => t.id === id);
        if (!track) {
          continue;
        }
        try {
          uriById.set(id, { uri: await downloadTrack(track), name: track.name });
        } catch {
          // ez az egy SFX kimarad, a többi mehet
        }
      }
      setSfxStatus(null);
      if (uriById.size === 0) {
        Alert.alert(t('panels.assistant.soundDesignTitle'), t('panels.assistant.soundLibraryUnavailable'));
        return;
      }

      const usable = plan.filter((p) => uriById.has(p.sfxId));
      const sfxTrack = project.tracks.find((t) => t.type === 'sfx');
      const summary = usable.reduce<Record<string, number>>((acc, p) => {
        acc[p.reason] = (acc[p.reason] ?? 0) + 1;
        return acc;
      }, {});
      const lines = Object.entries(summary).map(([r, n]) => `· ${n}× ${r}`);

      Alert.alert(
        t('panels.assistant.soundDesignTitle'),
        t('panels.assistant.soundDesignBody', {
          count: usable.length,
          lines: lines.join('\n'),
        }) +
          (beats.length > 0
            ? t('panels.assistant.soundDesignWithBeats')
            : t('panels.assistant.soundDesignNoBeats')) +
          t('panels.assistant.soundDesignKeepUndo'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.applyAction'),
            onPress: () => {
              const newClips = usable.map((p: SfxPlacement) => {
                const entry = uriById.get(p.sfxId)!;
                return {
                  kind: 'audio' as const,
                  id: makeId('clip'),
                  start: Math.round(p.start * 1000) / 1000,
                  duration: p.duration,
                  uri: entry.uri,
                  label: `${entry.name} — ${p.reason}`,
                  volume: p.volume,
                  fadeIn: 0,
                  fadeOut: Math.min(0.12, p.duration / 3),
                  source: 'imported' as const,
                };
              });
              useEditorStore.getState().dispatch(
                {
                  type: 'REPLACE_TRACK_CLIPS',
                  trackType: 'sfx',
                  clips: [...(sfxTrack?.clips ?? []), ...newClips].sort(
                    (a, b) => a.start - b.start
                  ),
                },
                'ai'
              );
            },
          },
        ]
      );
    } finally {
      setSfxStatus(null);
    }
  };

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

  // --- Smart Search (P0‑8) ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<string | null>(null);

  /**
   * 🔔 A tevékenység-sáv a MEGLÉVŐ állapotokból származik — nem kellett a 13
   * hívási helyet átírni. Bármelyik fut, a sáv látszik, és mutatja az eltelt
   * időt is (ez különbözteti meg a „dolgozik"-ot a „beragadt"-tól).
   */
  const busyLabel =
    status ??
    hookStatus ??
    productStatus ??
    cutStatus ??
    sceneStatus ??
    autoStatus ??
    beatStatus ??
    fxStatus ??
    sfxStatus ??
    reframeStatus ??
    searchStatus ??
    null;
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);

  const runSearch = async () => {
    const state = useEditorStore.getState();
    const query = searchQuery.trim();
    if (!state.project || !query || searchStatus) {
      return;
    }
    setSearchHits(null);
    state.setSearchMatchTimes([]); // korábbi kiemelés törlése
    setSearchStatus(t('panels.assistant.searching'));
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
        setSearchStatus(t('panels.assistant.scoring'));
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
      setSearchStatus(null);
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

  const apply = () => {
    if (!reply) {
      return;
    }
    // proveniencia (#34): az AI-hozzáadott elemek megkapják az AI indoklását
    const commands = toEditorCommands(reply.commands, reply.message);
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

  return (
    <View>
      <AiActivity
        key={busyLabel ?? 'idle'}
        busyLabel={busyLabel}
        result={aiResult}
        onDismiss={() => setAiResult(null)}
      />
      <PanelSection title={t('panels.assistant.modelSection')}>
        {aiModels.length === 0 ? (
          <Text style={styles.modelHint}>{t('panels.assistant.modelHint')}</Text>
        ) : (
          <View style={styles.row}>
            <Chip
              label={t('panels.assistant.modelAuto')}
              active={!assistantModel}
              onPress={() => pickAssistantModel(null)}
            />
            {aiModels.map((m) => (
              <Chip
                key={m.id}
                label={m.label}
                active={assistantModel === m.id}
                onPress={() => pickAssistantModel(m.id)}
              />
            ))}
          </View>
        )}
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionCommands')}>
        <View style={styles.row}>
          {commandBar.map((cmd) => (
            <Chip key={cmd.label} label={cmd.label} active={false} onPress={cmd.run} />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionAutoEdit')}>
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
          label={searchStatus ?? t('panels.assistant.searchInVisual')}
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

      <PanelSection title={t('panels.assistant.sectionHookGenerator')}>
        <PrimaryButton
          icon="flash-outline"
          label={hookStatus ?? t('panels.assistant.hookGenerateBtn')}
          onPress={() => {
            generateHooks().catch((err: Error) =>
              Alert.alert('Hook Generator', err.message)
            );
          }}
        />
        {hooks?.map((hook) => (
          <Pressable
            key={hook.text}
            style={styles.variantCard}
            onPress={() => applyHook(hook)}
          >
            <Text style={styles.variantTitle}>{hook.text}</Text>
            <Text style={styles.variantMeta}>
              {t('panels.assistant.hookMeta', { style: hook.style, count: hook.text.length })}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.note}>{t('panels.assistant.hookNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionLookPacks')}>
        <View style={styles.packRow}>
          {(Object.keys(MOTION_PACKS) as MotionPack[]).map((pack) => (
            <Chip
              key={pack}
              label={MOTION_PACKS[pack].label}
              active={false}
              onPress={() => applyMotionPack(pack)}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.assistant.lookPacksNote')}</Text>
        <PrimaryButton
          icon="pricetag-outline"
          label={productStatus ?? t('panels.assistant.makeProductAdBtn')}
          onPress={() => {
            makeProductAd().catch((err: Error) =>
              Alert.alert(t('panels.assistant.productAdTitle'), err.message)
            );
          }}
        />
        <Text style={styles.note}>{t('panels.assistant.productAdNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionBrandKit')}>
        <PrimaryButton
          icon="bookmark-outline"
          label={t('panels.assistant.brandSaveStyle')}
          onPress={() => {
            void learnBrand();
          }}
        />
        <PrimaryButton
          icon="color-wand-outline"
          label={t('panels.assistant.brandApplyBtn')}
          onPress={() => {
            void applyBrand();
          }}
        />
        <Text style={styles.note}>
          {brandKit
            ? t('panels.assistant.brandSavedInfo', { info: describeBrandKit(brandKit) })
            : t('panels.assistant.brandNoSavedHint')}
        </Text>

        <Text style={styles.subLabel}>{t('panels.assistant.introLabel')}</Text>
        <View style={styles.row}>
          {INTRO_TEMPLATES.map((tpl) => (
            <Chip
              key={tpl.id}
              label={t(tpl.label)}
              active={intro === tpl.id}
              onPress={() => setIntro(intro === tpl.id ? null : tpl.id)}
            />
          ))}
        </View>
        <Text style={styles.subLabel}>{t('panels.assistant.outroLabel')}</Text>
        <View style={styles.row}>
          {OUTRO_TEMPLATES.map((tpl) => (
            <Chip
              key={tpl.id}
              label={t(tpl.label)}
              active={outro === tpl.id}
              onPress={() => setOutro(outro === tpl.id ? null : tpl.id)}
            />
          ))}
        </View>
        <PrimaryButton
          icon="albums-outline"
          label={t('panels.assistant.insertIntroOutroBtn')}
          onPress={() => {
            applyBrandSegments().catch((err: Error) =>
              Alert.alert(t('panels.assistant.introOutroTitle'), err.message)
            );
          }}
        />
        <Text style={styles.note}>{t('panels.assistant.introOutroNote')}</Text>
      </PanelSection>

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
        <Text style={styles.note}>{t('panels.assistant.cutToolsNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.assistant.sectionSoundDesign')}>
        <View style={styles.row}>
          {(
            [
              { id: 'subtle', label: t('panels.assistant.intensitySubtle') },
              { id: 'normal', label: t('panels.assistant.intensityNormal') },
              { id: 'punchy', label: t('panels.assistant.intensityPunchy') },
            ] as const
          ).map((opt) => (
            <Chip
              key={opt.id}
              label={opt.label}
              active={sfxPunch === opt.id}
              onPress={() => setSfxPunch(opt.id)}
            />
          ))}
        </View>
        <PrimaryButton
          icon="volume-high-outline"
          label={sfxStatus ?? t('panels.assistant.soundDesignBtn')}
          onPress={() => {
            runSoundDesign().catch((err: Error) =>
              Alert.alert(t('panels.assistant.soundDesignTitle'), err.message)
            );
          }}
        />
        <Text style={styles.note}>{t('panels.assistant.soundDesignNote')}</Text>
      </PanelSection>

      {reply ? (
        <PanelSection title={t('panels.assistant.sectionSuggestion')}>
          <Text style={styles.message}>{reply.message}</Text>
          {reply.commands.length > 0 ? (
            <>
              {/* 🤖 AI action preview (#35): tételesen, mi fog változni — alkalmazás ELŐTT */}
              <Text style={styles.changeHeader}>
                {t('panels.assistant.changesHeader', { count: reply.commands.length })}
              </Text>
              {reply.commands.map((c, i) => (
                <Text key={i} style={styles.changeItem}>
                  {'•  '}
                  {describeAiCommand(c, t)}
                </Text>
              ))}
              <PrimaryButton
                icon="checkmark"
                label={t('panels.assistant.applyCommandsBtn', { count: reply.commands.length })}
                onPress={apply}
              />
            </>
          ) : null}
          <Chip label={t('panels.assistant.discard')} active={false} onPress={() => setReply(null)} />
        </PanelSection>
      ) : null}

      {applied ? <Text style={styles.note}>{applied}</Text> : null}

      <Text style={styles.note}>{t('panels.assistant.assistantFooter')}</Text>
      <Text style={styles.note}>{workerDiag}</Text>
    </View>
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
  variantCardActive: {
    borderColor: palette.accent,
  },
  packRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  changeItem: {
    color: palette.text,
    fontSize: 12,
    lineHeight: 18,
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
