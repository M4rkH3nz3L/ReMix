import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiActivity } from '@/components/editor/AiActivity';
import type { AiResult } from '@/components/editor/AiActivity';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { aspectValue, palette } from '@/constants/editor';
import { uploadFetch } from '@/lib/upload';
import { askAssistant } from '@/lib/ai';
import { buildAiContext, toEditorCommands } from '@/lib/aiCommands';
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
import { projectDuration } from '@/lib/projectUtils';
import { buildSmartReframe } from '@/lib/reframeClient';
import { downloadTrack, fetchSoundLibrary, renderServerUrl } from '@/lib/render';
import { formatTime } from '@/lib/time';
import { fetchShotScores } from '@/lib/shotScore';
import { fetchThumbHeadlines } from '@/lib/thumbStudio';
import { mergeSearchHits, searchTranscript } from '@/lib/transcriptSearch';
import { indexProjectVision, searchVision } from '@/lib/visionSearch';
import type { SearchHit } from '@/lib/visionIndex';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { VideoClip } from '@/types/project';

const QUICK_ACTIONS = [
  'Rövidítsd 30 mp alá',
  'Adj hozzá címet és záró CTA-t',
  'Igazítsd a feliratokat az alsó harmadba',
  'Tedd egységessé a feliratok stílusát',
];

/**
 * AI-asszisztens (full-plan F3): utasítás → a worker Claude-dal parancslistát
 * készít → jóváhagyás után a Command Bus-on fut le (actor: 'ai'), teljes
 * undo-val. Az AI sosem írja közvetlenül a projektet.
 */
export function AssistantPanel() {
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
  const [workerDiag, setWorkerDiag] = useState<string>('worker: ellenőrzés…');

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
            ? ' · médiafájl ✓'
            : ' · MÉDIAFÁJL HIÁNYZIK ✗ (relink kell)';
        } catch {
          fileInfo = ' · médiafájl nem ellenőrizhető';
        }
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(`${base}/health`, { signal: controller.signal })
      .then((res) => {
        if (alive) {
          setWorkerDiag(
            `worker: ${base} · ${res.ok ? 'elérhető ✓' : `HTTP ${res.status} ✗`}${fileInfo}`
          );
        }
      })
      .catch(() => {
        if (alive) {
          setWorkerDiag(`worker: ${base} · NEM elérhető ✗${fileInfo}`);
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
                (prev) => `${prev}\nfeltöltés-próba: ${r.ok ? 'OK ✓' : `HTTP ${r.status} ✗`}`
              );
            }
          })
          .catch((e) => {
            console.warn('feltöltés-próba hiba:', (e as Error).message);
            if (alive) {
              setWorkerDiag(
                (prev) => `${prev}\nfeltöltés-próba HIBA: ${(e as Error).message}`
              );
            }
          });
      }
    }
    return () => {
      alive = false;
    };
  }, []);

  // 🎬 Look-csomag: kamera + átmenetek + lighting egy koppintásra, egy undóban
  const applyMotionPack = (pack: MotionPack) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const plan = buildMotionPackPlan(state.project, pack);
    if (!plan) {
      Alert.alert('Look-csomag', 'Nincs videó/kép klip a projektben.');
      return;
    }
    Alert.alert(
      `${MOTION_PACKS[pack].label} look`,
      `${plan.touched} klip kap összehangolt kameramozgást, átmenetet és ` +
        `világítást${
          plan.skippedCamera > 0
            ? ` (${plan.skippedCamera} kulcskockás klip mozgása megmarad)`
            : ''
        }.\n\nEgy lépésben visszavonható.`,
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Alkalmazás',
          onPress: () => {
            const ok = useEditorStore
              .getState()
              .dispatch(
                { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                'user'
              );
            setApplied(
              ok
                ? `${MOTION_PACKS[pack].label} look alkalmazva ${plan.touched} klipre.`
                : 'Nem sikerült alkalmazni.'
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
    setHookStatus('Hookok írása…');
    try {
      const transcript = await getTimelineTranscript(state.project).catch(() => null);
      const lines = (transcript ?? []).slice(0, 12).map((l) => l.text);
      const summary = `${state.project.name}\n${lines.join('\n')}`.slice(0, 900);
      const list = await fetchHooks(summary);
      if (!list) {
        Alert.alert(
          'Hook Generator',
          'A hook-javaslat nem érhető el — fut a worker és az AI? (a /health mutatja)'
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
    setApplied(ok ? `Hook beállítva: „${hook.text}"` : 'Nem sikerült alkalmazni.');
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
      Alert.alert('Termékvideó', 'Kell hozzá legalább egy videóklip.');
      return;
    }
    setProductStatus('Legjobb pillanatok keresése…');
    try {
      const scenes = (await detectScenes(source.uri)) ?? [];
      const times = [0.5, ...scenes.map((s) => s + 0.4)].slice(0, 16);
      const shots = await fetchShotScores(source.uri, times);
      if (!shots || shots.length === 0) {
        Alert.alert(
          'Termékvideó',
          'A kocka-pontozás nem érhető el — fut a worker? (cd server && npm start)'
        );
        return;
      }
      setProductStatus('Cím írása…');
      const headlines = await fetchThumbHeadlines(
        `${state.project.name} — termékbemutató videó`
      );
      const plan = buildProductAdPlan(source, shots, {
        targetSeconds: 10,
        headline: headlines?.[0],
        cta: 'Nézd meg most',
        makeId: () => makeId('clip'),
      });
      if (!plan) {
        Alert.alert('Termékvideó', 'Nem sikerült elég használható pillanatot találni.');
        return;
      }
      setProductStatus(null);
      Alert.alert(
        '🛍️ Termékvideó',
        `${plan.shots} legjobb pillanat · ${plan.totalSeconds} mp · Product look ` +
          `(orbit-kamera, lágy áttűnés, studio fény)` +
          `${plan.captions.length > 0 ? `\n\nCím: „${plan.captions[0].text}"` : ''}` +
          '\n\nA videósáv újraépül, a feliratok a Felirat sávra kerülnek — ' +
          'mindkét lépés visszavonható.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Készítés',
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
                  ? `Termékvideó kész: ${plan.shots} vágás, ${plan.totalSeconds} mp.`
                  : 'Nem sikerült alkalmazni.'
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
        'Brand Kit',
        'Ebből a projektből nem olvasható ki stílus — kell hozzá felirat vagy logó-vízjel.'
      );
      return;
    }
    await saveBrandKit(kit);
    setBrandKit(kit);
    Alert.alert('Brand Kit mentve', describeBrandKit(kit));
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
      Alert.alert('Brand Kit', 'Még nincs mentett márka — előbb mentsd el egy projektből.');
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
              name: 'Vízjel',
            },
          },
          'user'
        );
      }
    }
    if (captionCount === 0 && !watermarkAdded) {
      Alert.alert('Brand Kit', 'Nincs mit alkalmazni — a projekt már a márkádat viseli.');
      return;
    }
    Alert.alert(
      'Márka alkalmazva',
      [
        captionCount > 0 ? `${captionCount} felirat átstílusozva` : null,
        watermarkAdded ? 'vízjel hozzáadva' : null,
      ]
        .filter(Boolean)
        .join(' · ') + '. Lépésenként visszavonható.'
    );
  };

  const send = async (text: string) => {
    const state = useEditorStore.getState();
    if (!state.project || status) {
      return;
    }
    setStatus('Gondolkodik…');
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
      const transcript = await withProgress('Átirat (AI-kontextus)', (report) =>
        getTimelineTranscript(state.project!, report)
      ).catch(() => null);
      if (transcript && transcript.length > 0) {
        context.transcript = transcript;
      }
      setStatus('Gondolkodik…');
      const answer = await askAssistant(context, text);
      setReply(answer);
      setAiResult({
        ok: true,
        text: answer.commands.length > 0
          ? `Kész: ${answer.commands.length} javasolt művelet — nézd meg lent a „Javaslat" dobozban.`
          : 'Kész — az asszisztens válaszolt, de nem javasolt műveletet.',
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
    setCutStatus('Csend-elemzés…');
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
        Alert.alert('Holtidő-vágás', 'Nincs videóklip a projektben.');
        return;
      }
      const silencesByUri = new Map<string, SilenceRange[]>();
      for (let i = 0; i < uris.length; i++) {
        setCutStatus(`Csend-elemzés… (${i + 1}/${uris.length})`);
        const silences = await detectSilence(uris[i]);
        if (silences) {
          silencesByUri.set(uris[i], silences);
        }
      }
      if (silencesByUri.size === 0) {
        Alert.alert(
          'Holtidő-vágás',
          Platform.OS === 'web'
            ? 'A csend-elemzés a webes előnézetben nem elérhető (natív fájl-feltöltés ' +
              'kell hozzá) — próbáld a szimulátorban vagy a telefonon.'
            : `A csend-elemzés nem érhető el.\n\nCél: ${renderServerUrl()}/silence\n` +
              'Nézd meg a panel alján a „worker:” sort — ha ✓, akkor a fájl-feltöltés ' +
              'akadt el (szólj, és megnézzük a worker-naplót).'
        );
        return;
      }
      const plan = buildCutPlan(state.project, silencesByUri);
      if (!plan) {
        Alert.alert('Holtidő-vágás', 'Nem találtam kivágható holtidőt. 🎉');
        return;
      }
      Alert.alert(
        'Holtidő kivágása',
        `${plan.cuts} vágás, összesen −${plan.removedSeconds.toFixed(1)} mp.\n\n` +
          'A videósáv hézag nélkül újraépül; a többi sáv időzítése nem mozdul. ' +
          'A művelet visszavonható.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Alkalmazás',
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? `Holtidő kivágva: ${plan.cuts} vágás, −${plan.removedSeconds.toFixed(1)} mp.`
                  : 'Nem sikerült alkalmazni.'
              );
            },
          },
        ]
      );
    } finally {
      setCutStatus(null);
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
    setSceneStatus('Jelenet-elemzés…');
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
        Alert.alert('Jelenetvágás', 'Nincs videóklip a projektben.');
        return;
      }
      const scenesByUri = new Map<string, number[]>();
      for (let i = 0; i < uris.length; i++) {
        setSceneStatus(`Jelenet-elemzés… (${i + 1}/${uris.length})`);
        const scenes = await detectScenes(uris[i]);
        if (scenes) {
          scenesByUri.set(uris[i], scenes);
        }
      }
      if (scenesByUri.size === 0) {
        Alert.alert(
          'Jelenetvágás',
          'A jelenet-elemzés nem érhető el — fut a worker? (cd server && npm start)'
        );
        return;
      }
      const plan = buildSceneSplitPlan(state.project, scenesByUri);
      if (!plan) {
        Alert.alert('Jelenetvágás', 'Nem találtam jelenetváltást a klipekben.');
        return;
      }
      Alert.alert(
        'Vágás a jelenetváltásoknál',
        `${plan.splits} jelenetváltást találtam.\n\n` +
          'A klipek a határokon felvágódnak (semmi nem törlődik és nem mozdul el), ' +
          'utána a darabok egyenként szerkeszthetők. A művelet visszavonható.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Felvágás',
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? `Jelenetvágás kész: ${plan.splits} vágás.`
                  : 'Nem sikerült alkalmazni.'
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
    setAutoStatus('Jelek gyűjtése…');
    try {
      const result = await withProgress('Auto Edit', (report) =>
        runAutoEditFlow(state.project!, targetSeconds, report)
      );
      setAutoResult(result);
    } catch (err) {
      Alert.alert('Auto Edit', (err as Error).message);
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
      Alert.alert('Előnézet', 'Ehhez a változathoz nincs lejátszható sáv.');
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
      Alert.alert('Auto Edit', 'Ez a változat nem alkalmazható erre a projektre.');
      return;
    }
    Alert.alert(
      variant.title,
      `${compiled.totalSeconds.toFixed(1)} mp · ${compiled.cuts} vágás · ` +
        `${compiled.captionClips.length} felirat\n\n${variant.rationale}\n\n` +
        'A videósáv újraépül és a feliratok a Felirat sávra kerülnek — mindkét ' +
        'lépés visszavonható.',
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Alkalmazás',
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
                ? `${variant.title} alkalmazva: ${compiled.totalSeconds.toFixed(1)} mp, ` +
                    `${compiled.cuts} vágás, ${compiled.captionClips.length} felirat.`
                : 'Nem sikerült alkalmazni.'
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
      Alert.alert('Intro / Outro', 'Válassz legalább egy sablont.');
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
      Alert.alert('Intro / Outro', 'Nem sikerült felépíteni a sablont.');
      return;
    }
    Alert.alert(
      'Intro / Outro',
      `${plan.summary} kerül a videóra.` +
        (plan.duration > 0
          ? `\n\nAz intro miatt minden sáv ${plan.duration.toFixed(1)} mp-cel ` +
            'csúszik — a zene és a feliratok szinkronban maradnak.'
          : '') +
        (kit?.watermark
          ? '\n\nA mentett logó is bekerül.'
          : '\n\nNincs mentett logó — szöveges változat készül. Logóért ments ' +
            'egy márkát vízjellel.') +
        '\n\nVisszavonható egy lépésben.',
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Beszúrás',
          onPress: () => {
            useEditorStore.getState().dispatch(
              {
                type: 'REPLACE_TRACKS',
                tracks: plan.tracks,
                label: `intro/outro: ${plan.summary}`,
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
      Alert.alert('Sound Design', 'Előbb tegyél videót az idővonalra.');
      return;
    }

    setSfxStatus('Elemzés…');
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
        setSfxStatus('Beat-elemzés…');
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
          'Sound Design',
          'Nem találtam hangosítható pontot — több vágás vagy zene kell hozzá.'
        );
        return;
      }

      // a szükséges SFX-fájlok letöltése (mindegyik csak egyszer)
      setSfxStatus('Hangok letöltése…');
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
        Alert.alert('Sound Design', 'A hangkönyvtár nem érhető el — fut a worker?');
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
        'Sound Design',
        `${usable.length} hangeffekt kerül az SFX sávra:\n${lines.join('\n')}\n\n` +
          (beats.length > 0
            ? 'A vágások az ütemhez igazodva kapnak hangot.'
            : 'Zene nélkül csak a vágásokra kerül hang — zenével pontosabb.') +
          '\n\nA meglévő SFX-klipek megmaradnak. Visszavonható egy lépésben.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Alkalmazás',
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
    setFxStatus('Beat-elemzés…');
    try {
      const musicClip = state.project.tracks
        .filter((t) => t.type === 'music')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'audio')
        .sort((a, b) => a.start - b.start)[0];
      if (!musicClip || musicClip.kind !== 'audio') {
        Alert.alert('Beat FX', 'Adj előbb zenét a Zene sávra.');
        return;
      }
      const grid = await detectBeats(musicClip.uri);
      if (!grid || grid.bpm === 0 || grid.beats.length < 4) {
        Alert.alert('Beat FX', 'Nem érhető el beat-rács — fut a worker, van ütem a zenében?');
        return;
      }
      if (kind === 'pulse') {
        // gyors zenénél downbeatenként pulzál, különben minden beatre
        const useDownbeats = grid.bpm > 110;
        const times = timelineBeats(musicClip, useDownbeats ? grid.downbeats : grid.beats);
        const plan = buildBeatPulsePlan(state.project, times);
        if (!plan) {
          Alert.alert(
            'Beat-pulzus',
            'Nincs pulzálható klip — a kulcskockás/animált klipeken nem fut.'
          );
          return;
        }
        Alert.alert(
          'Beat-pulzus',
          `${plan.pulses} zoom-pulzus ${grid.bpm} BPM-re` +
            `${plan.skipped > 0 ? ` (${plan.skipped} kulcskockás klip kihagyva)` : ''}.\n\n` +
            'A videó minden ütemre finoman ránagyít, majd visszaáll — előnézetben ' +
            'és renderben is. Visszavonható.',
          [
            { text: 'Mégse', style: 'cancel' },
            {
              text: 'Alkalmazás',
              onPress: () => {
                const ok = useEditorStore
                  .getState()
                  .dispatch(
                    { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                    'ai'
                  );
                setApplied(ok ? `Beat-pulzus kész: ${plan.pulses} ütem.` : 'Nem sikerült.');
              },
            },
          ]
        );
      } else {
        const times = timelineBeats(musicClip, grid.downbeats);
        const plan = buildBeatFlashPlan(state.project, times, () => makeId('clip'));
        if (!plan) {
          Alert.alert('Beat-flash', 'Nem esik downbeat a videó hosszába.');
          return;
        }
        Alert.alert(
          'Beat-flash',
          `${plan.flashes} villanás a 4-es ütemekre (${grid.bpm} BPM).\n\n` +
            'Rövid fehér flash-réteg kerül az overlay-sávra minden downbeatnél. ' +
            'Visszavonható.',
          [
            { text: 'Mégse', style: 'cancel' },
            {
              text: 'Alkalmazás',
              onPress: () => {
                const ok = useEditorStore
                  .getState()
                  .dispatch(
                    { type: 'REPLACE_TRACK_CLIPS', trackType: 'overlay', clips: plan.clips },
                    'ai'
                  );
                setApplied(ok ? `Beat-flash kész: ${plan.flashes} villanás.` : 'Nem sikerült.');
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
    setBeatStatus('Beat-elemzés…');
    try {
      const musicClip = state.project.tracks
        .filter((t) => t.type === 'music')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'audio')
        .sort((a, b) => a.start - b.start)[0];
      if (!musicClip || musicClip.kind !== 'audio') {
        Alert.alert('Beat-vágás', 'Adj előbb zenét a Zene sávra.');
        return;
      }
      const grid = await detectBeats(musicClip.uri);
      if (!grid) {
        Alert.alert(
          'Beat-vágás',
          'A beat-elemzés nem érhető el — fut a worker? (cd server && npm start)'
        );
        return;
      }
      if (grid.bpm === 0 || grid.beats.length < 4) {
        Alert.alert('Beat-vágás', 'Nem találtam kivehető ütemet a zenében.');
        return;
      }
      // 135 BPM felett a minden-beat vágás már villódzás — ott a downbeat vág
      const useDownbeats = grid.bpm > 135;
      const times = timelineBeats(musicClip, useDownbeats ? grid.downbeats : grid.beats);
      const plan = buildBeatSplitPlan(state.project, times);
      if (!plan) {
        Alert.alert('Beat-vágás', 'Nem esik ütem a videóklipek belsejébe.');
        return;
      }
      Alert.alert(
        'Vágás a zene ütemére',
        `${grid.bpm} BPM${useDownbeats ? ' (4-es ütemenként vágva)' : ''} — ` +
          `${plan.splits} vágás.\n\n` +
          'A klipek az ütemeken felvágódnak (semmi nem törlődik és nem mozdul el), ' +
          'utána a darabok egyenként cserélhetők/törölhetők. A művelet visszavonható.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Felvágás',
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? `Beat-vágás kész: ${plan.splits} vágás ${grid.bpm} BPM-re.`
                  : 'Nem sikerült alkalmazni.'
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
    setReframeStatus('Téma-elemzés…');
    try {
      const canvasAspect = aspectValue(state.project.aspectRatio);
      const plan = await withProgress('Smart Reframe', (report) =>
        buildSmartReframe(state.project!, canvasAspect, report)
      );
      if (!plan) {
        Alert.alert(
          'Smart Reframe',
          'Nincs teendő: minden klip aránya egyezik a vászonnal, vagy a worker nem érhető el.'
        );
        return;
      }
      Alert.alert(
        'Smart Reframe',
        `${plan.changed} klip okos-kitöltést kap: a videó kitölti a vásznat, és a ` +
          'kivágás követi a témát (mozgás-alapú elemzés).\n\nA korábbi ' +
          'zoom/pozíció ezeken a klipeken felülíródik. A művelet visszavonható.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Alkalmazás',
            onPress: () => {
              const ok = useEditorStore
                .getState()
                .dispatch(
                  { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                  'ai'
                );
              setApplied(
                ok
                  ? `Smart Reframe kész: ${plan.changed} klip téma-követő kitöltéssel.`
                  : 'Nem sikerült alkalmazni.'
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
    setSearchStatus('Keresés…');
    try {
      // 📝 átirat-találatok a vision-találatokkal EGY listában (P0‑8)
      const transcript =
        (await getTimelineTranscript(state.project).catch(() => null)) ?? [];
      const transcriptHits = searchTranscript(transcript, query);
      const index = await withProgress('Vizuális index', (report) =>
        indexProjectVision(state.project!, report)
      );
      let visionHits: SearchHit[] = [];
      if (index.length > 0) {
        setSearchStatus('Pontozás…');
        visionHits = await searchVision(query, index);
      }
      if (index.length === 0 && transcriptHits.length === 0) {
        Alert.alert(
          'Smart Search',
          'Se vizuális index, se átirat — fut a worker és megvan a vision-modell? ' +
            '(ollama pull qwen2.5vl:7b)'
        );
        return;
      }
      setSearchHits(mergeSearchHits(visionHits, transcriptHits));
    } finally {
      setSearchStatus(null);
    }
  };

  const apply = () => {
    if (!reply) {
      return;
    }
    const commands = toEditorCommands(reply.commands);
    const state = useEditorStore.getState();
    let ok = 0;
    for (const command of commands) {
      if (state.dispatch(command, 'ai')) {
        ok += 1;
      }
    }
    setReply(null);
    setInstruction('');
    setApplied(
      ok > 0
        ? `${ok} művelet alkalmazva — a visszavonás gombbal bármikor visszavonható.`
        : 'Nem volt alkalmazható művelet.'
    );
  };

  // AI Command Bar (P0‑1): a leggyakoribb power-parancsok egy sorban —
  // determinisztikus eszközök és AI-promptok vegyesen, egy koppintásra
  const commandBar: { label: string; run: () => void }[] = [
    {
      label: '✂️ Csend ki',
      run: () => {
        cutDeadAir().catch((err: Error) => Alert.alert('Holtidő-vágás', err.message));
      },
    },
    {
      label: '🎵 Beat-vágás',
      run: () => {
        splitOnBeats().catch((err: Error) => Alert.alert('Beat-vágás', err.message));
      },
    },
    {
      label: '🎯 Reframe',
      run: () => {
        smartReframe().catch((err: Error) => Alert.alert('Smart Reframe', err.message));
      },
    },
    {
      label: '⚡ 30 mp-es short',
      run: () => {
        setTargetSeconds(30);
        startAutoEdit().catch((err: Error) => Alert.alert('Auto Edit', err.message));
      },
    },
    { label: '💬 Feliratozz', run: () => send('Feliratozd a beszédet a felirat-sávra') },
    { label: '🔥 Címet a hookra', run: () => send('Adj ütős címet a videó elejére') },
  ];

  return (
    <View>
      <AiActivity
        key={busyLabel ?? 'idle'}
        busyLabel={busyLabel}
        result={aiResult}
        onDismiss={() => setAiResult(null)}
      />
      <PanelSection title="Parancsok">
        <View style={styles.row}>
          {commandBar.map((cmd) => (
            <Chip key={cmd.label} label={cmd.label} active={false} onPress={cmd.run} />
          ))}
        </View>
      </PanelSection>

      <PanelSection title="Auto Edit — 3 változat">
        <View style={styles.row}>
          {[15, 30, 60].map((sec) => (
            <Chip
              key={sec}
              label={`${sec} mp`}
              active={targetSeconds === sec}
              onPress={() => setTargetSeconds(sec)}
            />
          ))}
        </View>
        <PrimaryButton
          icon="flash-outline"
          label={autoStatus ?? `Auto Edit indítása (${targetSeconds} mp-es short)`}
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
                  {variant.keep
                    .reduce((s, k) => s + Math.max(0, k.end - k.start), 0)
                    .toFixed(1)}{' '}
                  mp · {variant.keep.length} szegmens · {variant.captions.length} felirat
                </Text>
                <Text style={styles.variantRationale} numberOfLines={2}>
                  {variant.rationale}
                </Text>
                <View style={styles.variantActions}>
                  <Chip
                    label={previewingId === variant.id ? '⏹ Előnézet leállítása' : '▶ Előnézet'}
                    active={previewingId === variant.id}
                    onPress={() => previewVariant(variant)}
                  />
                </View>
              </Pressable>
            ))}
            <Text style={styles.note}>
              {autoResult.source === 'ai'
                ? 'AI-tervezett változatok — ▶ előnézet alkalmazás nélkül, koppintás a kártyán = alkalmazás (visszavonható).'
                : 'Heurisztikus változatok (AI nélkül) — ▶ előnézet alkalmazás nélkül, koppintás = alkalmazás.'}
            </Text>
          </>
        ) : (
          <Text style={styles.note}>
            A jelekből (jelenetek + átirat + csend + beat) 3 kész vágás készül:
            🔥 Viral · 🎬 Cinematic · ⚡ Fast-paced.
          </Text>
        )}
      </PanelSection>

      <PanelSection title="Mit csináljak?">
        <TextInput
          value={instruction}
          onChangeText={setInstruction}
          multiline
          style={styles.input}
          placeholder={'Pl. "Vágd ki az üres részeket és feliratozd a hookot"'}
          placeholderTextColor={palette.textDim}
        />
        <PrimaryButton
          icon="sparkles-outline"
          label={status ?? 'Küldés az asszisztensnek'}
          onPress={() => {
            if (instruction.trim()) {
              send(instruction.trim());
            }
          }}
        />
        <View style={styles.row}>
          {QUICK_ACTIONS.map((action) => (
            <Chip key={action} label={action} active={false} onPress={() => send(action)} />
          ))}
        </View>
      </PanelSection>

      <PanelSection title="Smart Search — keresés a videóban">
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.input}
          placeholder={'Pl. "ahol az autó látszik" vagy "nevető ember"'}
          placeholderTextColor={palette.textDim}
        />
        <PrimaryButton
          icon="search-outline"
          label={searchStatus ?? 'Keresés a képi tartalomban'}
          onPress={() => {
            runSearch().catch((err: Error) => Alert.alert('Smart Search', err.message));
          }}
        />
        {searchHits !== null ? (
          searchHits.length === 0 ? (
            <Text style={styles.note}>Nincs találat — próbáld más szavakkal.</Text>
          ) : (
            searchHits.map((hit, i) => (
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
            ))
          )
        ) : (
          <Text style={styles.note}>
            A jelenetek képi tartalma a gépen futó vision-modellel indexelődik
            (fájlonként egyszer), a találatra koppintva a lejátszófej odaugrik.
          </Text>
        )}
      </PanelSection>

      <PanelSection title="🪝 Hook Generator (erősebb nyitás)">
        <PrimaryButton
          icon="flash-outline"
          label={hookStatus ?? '🪝 Adj 6 erősebb openinget'}
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
              {hook.style} · {hook.text.length} karakter
            </Text>
          </Pressable>
        ))}
        <Text style={styles.note}>
          Az első 2 másodperc dönti el, végignézik-e. Az AI a videó témájából ír
          hatféle stílusú nyitómondatot — koppints egyre, és cím-klipként a
          videó elejére kerül (a korábbi hookot lecseréli, visszavonható).
        </Text>
      </PanelSection>

      <PanelSection title="🎬 Look-csomagok (motion-presetek)">
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
        <Text style={styles.note}>
          Egy koppintásos stílus a teljes videóra: kameramozgás + 3D átmenetek +
          hangulat-világítás összehangolva. A már kulcskockázott klipek mozgása
          megmarad. Egy lépésben visszavonható.
        </Text>
        <PrimaryButton
          icon="pricetag-outline"
          label={productStatus ?? '🛍️ Termékvideó készítése (10 mp)'}
          onPress={() => {
            makeProductAd().catch((err: Error) =>
              Alert.alert('Termékvideó', err.message)
            );
          }}
        />
        <Text style={styles.note}>
          Az AI kiválogatja a legjobban kinéző pillanatokat (élesség, kontraszt,
          arc), Product-lookba rendezi őket, és címet + záró felhívást is ír.
        </Text>
      </PanelSection>

      <PanelSection title="🎨 Márka (Brand Kit)">
        <PrimaryButton
          icon="bookmark-outline"
          label="Stílus mentése ebből a projektből"
          onPress={() => {
            void learnBrand();
          }}
        />
        <PrimaryButton
          icon="color-wand-outline"
          label="Márka alkalmazása erre a projektre"
          onPress={() => {
            void applyBrand();
          }}
        />
        <Text style={styles.note}>
          {brandKit
            ? `Mentett márka: ${describeBrandKit(brandKit)}`
            : 'Még nincs mentett márka — állítsd be egy projektben a felirat-stílust ' +
              '(és opcionálisan egy logó-vízjelet), majd mentsd el innen.'}
        </Text>

        <Text style={styles.subLabel}>🎬 Intro</Text>
        <View style={styles.row}>
          {INTRO_TEMPLATES.map((t) => (
            <Chip
              key={t.id}
              label={t.label}
              active={intro === t.id}
              onPress={() => setIntro(intro === t.id ? null : t.id)}
            />
          ))}
        </View>
        <Text style={styles.subLabel}>🏁 Outro</Text>
        <View style={styles.row}>
          {OUTRO_TEMPLATES.map((t) => (
            <Chip
              key={t.id}
              label={t.label}
              active={outro === t.id}
              onPress={() => setOutro(outro === t.id ? null : t.id)}
            />
          ))}
        </View>
        <PrimaryButton
          icon="albums-outline"
          label="Intro / outro beszúrása"
          onPress={() => {
            applyBrandSegments().catch((err: Error) =>
              Alert.alert('Intro / Outro', err.message)
            );
          }}
        />
        <Text style={styles.note}>
          A sablonok a mentett márkaszínt, logót és felirat-stílust használják.
          Az intro az elejére kerül és mindent eltol (a zene is vele csúszik),
          az outro a videó végére. Logó nélkül szöveges változat készül.
        </Text>
      </PanelSection>

      <PanelSection title="Vágó-eszközök">
        <PrimaryButton
          icon="cut-outline"
          label={cutStatus ?? 'Holtidő kivágása (csend-vágás)'}
          onPress={() => {
            cutDeadAir().catch((err: Error) => Alert.alert('Holtidő-vágás', err.message));
          }}
        />
        <PrimaryButton
          icon="film-outline"
          label={sceneStatus ?? 'Vágás a jelenetváltásoknál'}
          onPress={() => {
            splitAtScenes().catch((err: Error) => Alert.alert('Jelenetvágás', err.message));
          }}
        />
        <PrimaryButton
          icon="musical-notes-outline"
          label={beatStatus ?? 'Vágás a zene ütemére (Beat Sync)'}
          onPress={() => {
            splitOnBeats().catch((err: Error) => Alert.alert('Beat-vágás', err.message));
          }}
        />
        <PrimaryButton
          icon="pulse-outline"
          label={fxStatus ?? 'Beat-pulzus (zoom az ütemre)'}
          onPress={() => {
            applyBeatFx('pulse').catch((err: Error) => Alert.alert('Beat FX', err.message));
          }}
        />
        <PrimaryButton
          icon="flash-outline"
          label={fxStatus ?? 'Beat-flash (villanás a 4-esekre)'}
          onPress={() => {
            applyBeatFx('flash').catch((err: Error) => Alert.alert('Beat FX', err.message));
          }}
        />
        <PrimaryButton
          icon="crop-outline"
          label={reframeStatus ?? 'Smart Reframe (téma-követő kitöltés)'}
          onPress={() => {
            smartReframe().catch((err: Error) => Alert.alert('Smart Reframe', err.message));
          }}
        />
        <Text style={styles.note}>
          FFmpeg-alapú csend-, jelenet- és beat-elemzés a workeren — AI-kulcs
          nélkül is működik.
        </Text>
      </PanelSection>

      <PanelSection title="🔊 Sound Design AI">
        <View style={styles.row}>
          {(
            [
              { id: 'subtle', label: 'Finom' },
              { id: 'normal', label: 'Normál' },
              { id: 'punchy', label: 'Ütős' },
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
          label={sfxStatus ?? 'Hangosítsd be a vágásokat'}
          onPress={() => {
            runSoundDesign().catch((err: Error) =>
              Alert.alert('Sound Design', err.message)
            );
          }}
        />
        <Text style={styles.note}>
          Whoosh a vágásokra, bassdrop az ütem-elsőkre, egy riser a legerősebb
          váltás elé, pop a feliratok megjelenésére — mind a worker generált
          hangkönyvtárából, az SFX sávra. Zenével pontosabb, de anélkül is megy.
        </Text>
      </PanelSection>

      {reply ? (
        <PanelSection title="Javaslat">
          <Text style={styles.message}>{reply.message}</Text>
          {reply.commands.length > 0 ? (
            <PrimaryButton
              icon="checkmark"
              label={`${reply.commands.length} művelet alkalmazása`}
              onPress={apply}
            />
          ) : null}
          <Chip label="Elvetés" active={false} onPress={() => setReply(null)} />
        </PanelSection>
      ) : null}

      {applied ? <Text style={styles.note}>{applied}</Text> : null}

      <Text style={styles.note}>
        Az asszisztens a worker AI-motorjával dolgozik (Claude, vagy dev-ben a
        gépen futó lokális modell) — a műveletei jóváhagyás után futnak le, és
        visszavonhatók.
      </Text>
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
  message: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
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
