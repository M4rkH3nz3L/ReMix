import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { aspectValue, palette, textStylePresets } from '@/constants/editor';
import { isProRequiredError } from '@/lib/backend';
import { assignSpeakers, captionBand, captionY, speakerColor } from '@/lib/captionLayout';
import { applyCaptionSuggestions, heuristicSuggestions } from '@/lib/captionStudio';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import type { FaceBoxLike } from '@/lib/faceRegion';
import { fetchCaptionSuggestions, fetchCaptionTranslations } from '@/lib/captionStudioClient';
import { makeId } from '@/lib/id';
import { pickSrt } from '@/lib/media';
import {
  activeVisualClip,
  sourceTimeAt,
  trackEnd,
  trackOf,
} from '@/lib/projectUtils';
import { transcribeToSrt } from '@/lib/render';
import { getProjectWordCues } from '@/lib/transcripts';
import { alignWordTimings, cuesToCaptionTime } from '@/lib/wordTiming';
import { mapCuesToTimeline, parseSrt } from '@/lib/srt';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { guardPro, usePaywall } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { TextClip, TextStylePreset, VideoClip } from '@/types/project';

/** feliratonkénti hossz-korlátok (mp) */
const MIN_CAPTION = 1;
const MAX_CAPTION = 5;
const FALLBACK_CAPTION = 2.5;

/** 🌍 felirat-fordítás cél-nyelvei (a nevek endonimák — nem kell i18n) */
const TARGET_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'hu', label: 'Magyar' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

/**
 * Gyors felirat: soronként egy caption, a lejátszófejtől a videósáv végéig
 * egyenletesen elosztva. Ugyanez a belépési pont fogadja majd a beszédfelismerés
 * (auto-caption) eredményét is.
 */
export function CaptionsPanel() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [preset, setPreset] = useState<TextStylePreset>('bubble');
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [studioStatus, setStudioStatus] = useState<string | null>(null);
  const [layoutStatus, setLayoutStatus] = useState<string | null>(null);
  const [wordStatus, setWordStatus] = useState<string | null>(null);
  const [translateStatus, setTranslateStatus] = useState<string | null>(null);

  /**
   * 🎤 Szó-szintű karaoke-időzítés: a Whisper SZÓ-átiratához igazítja a
   * feliratok szavait, és klip-relatív időket ír rájuk. Enélkül a karaoke a
   * klip hosszát osztja el egyenletesen — ami eltérő szóhosszaknál elcsúszik.
   * Ahol az illesztés nem elég megbízható, a klip marad az egyenletesen.
   */
  const runWordTimings = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((t) => t.type === 'captions');
    const captions = (track?.clips ?? []).filter(
      (c): c is TextClip => c.kind === 'text'
    );
    if (!state.project || !track || captions.length === 0) {
      Alert.alert(t('panels.captions.wordTiming'), t('panels.captions.noCaptionsOnTrack'));
      return;
    }
    setWordStatus(t('panels.captions.wordTranscriptStatus'));
    try {
      const cuesByUri = await withProgress(t('panels.captions.wordTiming'), (report) =>
        getProjectWordCues(state.project!, report)
      );
      if (cuesByUri.size === 0) {
        Alert.alert(
          t('panels.captions.wordTiming'),
          t('panels.captions.noWordTranscript')
        );
        return;
      }
      setWordStatus(t('panels.captions.aligningStatus'));
      let aligned = 0;
      let skipped = 0;
      const clips = track.clips.map((c) => {
        if (c.kind !== 'text') {
          return c;
        }
        const mid = c.start + c.duration / 2;
        const video = activeVisualClip(state.project!, mid);
        if (!video || video.kind !== 'video') {
          skipped += 1;
          return c;
        }
        const cues = cuesByUri.get(video.uri);
        if (!cues) {
          skipped += 1;
          return c;
        }
        const words = c.text.split(/\s+/).filter(Boolean);
        const timings = alignWordTimings(
          words,
          cuesToCaptionTime(cues, video, c),
          c.duration
        );
        if (!timings) {
          skipped += 1;
          return c;
        }
        aligned += 1;
        return { ...c, wordTimings: timings, animation: 'karaoke' as const };
      });
      setWordStatus(null);
      if (aligned === 0) {
        Alert.alert(
          t('panels.captions.wordTiming'),
          t('panels.captions.wordTimingNoneAligned')
        );
        return;
      }
      state.dispatch(
        { type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips },
        'ai'
      );
      Alert.alert(
        t('panels.captions.wordTimingDoneTitle'),
        t('panels.captions.wordTimingDoneBody', { count: aligned }) +
          (skipped > 0 ? t('panels.captions.wordTimingSkippedSuffix', { count: skipped }) : '') +
          t('panels.captions.wordTimingDoneTail')
      );
    } finally {
      setWordStatus(null);
    }
  };
  const setPanel = useEditorStore((s) => s.setPanel);

  /**
   * 🗣️ Arc-mintavétel a felirat-klipek közepén: forráskulcs (melyik kamera) +
   * az arc doboza. Az azonos forrás+másodperc kérések cache-elve mennek, és
   * négyesével párhuzamosan — így egy hosszabb feliratsáv sem fojtja meg a
   * workert.
   */
  const sampleFaces = async (
    captions: TextClip[]
  ): Promise<Map<string, { sourceKey: string; face: FaceBoxLike | null }>> => {
    const state = useEditorStore.getState();
    const out = new Map<string, { sourceKey: string; face: FaceBoxLike | null }>();
    if (!state.project) {
      return out;
    }
    const ar = aspectValue(state.project.aspectRatio);
    const cache = new Map<string, FaceBoxLike | null>();
    const items = captions.slice(0, 60);

    for (let i = 0; i < items.length; i += 4) {
      setLayoutStatus(
        t('panels.captions.searchingFaces', {
          current: Math.min(i + 4, items.length),
          total: items.length,
        })
      );
      await Promise.all(
        items.slice(i, i + 4).map(async (c) => {
          const mid = c.start + c.duration / 2;
          const video = activeVisualClip(state.project!, mid);
          if (!video || video.kind !== 'video') {
            out.set(c.id, { sourceKey: 'nincs', face: null });
            return;
          }
          const atSec = sourceTimeAt(video, mid);
          const key = `${video.uri}@${Math.round(atSec * 2)}`;
          if (!cache.has(key)) {
            const faces = await fetchFaces(video.uri, {
              atSec,
              aspectW: ar,
              aspectH: 1,
            });
            cache.set(key, faces ? pickPrimaryFace(faces) : null);
          }
          out.set(c.id, { sourceKey: video.uri, face: cache.get(key) ?? null });
        })
      );
    }
    return out;
  };

  /** 🗣️ beszélő-színek: forrásklip + arc-pozíció alapján csoportosít, majd színez */
  const runSpeakerColors = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((t) => t.type === 'captions');
    const captions = (track?.clips ?? []).filter(
      (c): c is TextClip => c.kind === 'text'
    );
    if (!track || captions.length < 2) {
      Alert.alert(t('panels.captions.speakerColors'), t('panels.captions.speakerColorsNeedTwo'));
      return;
    }
    setLayoutStatus(t('panels.captions.analyzingStatus'));
    const samples = await sampleFaces(captions);
    setLayoutStatus(null);
    const speakers = assignSpeakers(
      captions.map((c) => ({
        id: c.id,
        sourceKey: samples.get(c.id)?.sourceKey ?? 'nincs',
        faceX: samples.get(c.id)?.face?.x,
      }))
    );
    const count = new Set(speakers.values()).size;
    if (count < 2) {
      Alert.alert(
        t('panels.captions.speakerColors'),
        t('panels.captions.speakerColorsSingle')
      );
      return;
    }
    const clips = track.clips.map((c) => {
      const idx = speakers.get(c.id);
      return c.kind === 'text' && idx != null ? { ...c, color: speakerColor(idx) } : c;
    });
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
    Alert.alert(
      t('panels.captions.speakerColorsDoneTitle'),
      t('panels.captions.speakerColorsDoneBody', { count })
    );
  };

  /**
   * 🗣️ Beszélő-címkék (diarization, heurisztikus): ugyanaz a csoportosítás, mint
   * a beszélő-színeknél (forrásklip + arc-pozíció), de a felirat SZÖVEGÉBE tesz
   * „[Beszélő N] " előtagot. A szöveg amúgy is renderelődik → paritás-mentes;
   * re-run-nál a régi előtag lecserélődik.
   */
  const runSpeakerLabels = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((tk) => tk.type === 'captions');
    const captions = (track?.clips ?? []).filter((c): c is TextClip => c.kind === 'text');
    if (!track || captions.length < 2) {
      Alert.alert(t('panels.captions.speakerLabels'), t('panels.captions.speakerColorsNeedTwo'));
      return;
    }
    setLayoutStatus(t('panels.captions.analyzingStatus'));
    const samples = await sampleFaces(captions);
    setLayoutStatus(null);
    const speakers = assignSpeakers(
      captions.map((c) => ({
        id: c.id,
        sourceKey: samples.get(c.id)?.sourceKey ?? 'nincs',
        faceX: samples.get(c.id)?.face?.x,
      }))
    );
    const count = new Set(speakers.values()).size;
    if (count < 2) {
      Alert.alert(t('panels.captions.speakerLabels'), t('panels.captions.speakerColorsSingle'));
      return;
    }
    const clips = track.clips.map((c) => {
      const idx = speakers.get(c.id);
      if (c.kind !== 'text' || idx == null) {
        return c;
      }
      const bare = c.text.replace(/^\[[^\]]+\]\s+/, ''); // korábbi címke levágása
      return { ...c, text: `[${t('panels.captions.speakerName', { n: idx + 1 })}] ${bare}` };
    });
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
    Alert.alert(t('panels.captions.speakerLabels'), t('panels.captions.speakerLabelsDone', { count }));
  };

  /** 📐 okos pozíció: a felirat kikerüli az arcot (fölé/alá ugrik) */
  const runSmartPosition = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((t) => t.type === 'captions');
    const captions = (track?.clips ?? []).filter(
      (c): c is TextClip => c.kind === 'text'
    );
    if (!track || captions.length === 0) {
      Alert.alert(t('panels.captions.smartPosition'), t('panels.captions.noCaptionsOnTrack'));
      return;
    }
    setLayoutStatus(t('panels.captions.analyzingStatus'));
    const samples = await sampleFaces(captions);
    setLayoutStatus(null);
    let moved = 0;
    const clips = track.clips.map((c) => {
      if (c.kind !== 'text') {
        return c;
      }
      const face = samples.get(c.id)?.face ?? null;
      const band = captionBand(c.text, c.fontSize);
      const y = captionY(face, c.position.y, band);
      if (Math.abs(y - c.position.y) < 0.005) {
        return c;
      }
      moved += 1;
      return { ...c, position: { ...c.position, y: Math.round(y * 1000) / 1000 } };
    });
    if (moved === 0) {
      Alert.alert(
        t('panels.captions.smartPosition'),
        samples.size === 0
          ? t('panels.captions.smartPositionNoDetector')
          : t('panels.captions.smartPositionNoOverlap')
      );
      return;
    }
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
    Alert.alert(
      t('panels.captions.smartPositionDoneTitle'),
      t('panels.captions.smartPositionDoneBody', { count: moved })
    );
  };

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

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const captionClip = (
    text: string,
    start: number,
    duration: number
  ): TextClip => ({
    kind: 'text',
    id: makeId('clip'),
    start,
    duration,
    text,
    color: '#ffffff',
    backgroundColor: null,
    fontSize: 5,
    fontWeight: 'bold',
    // alsó harmad — short videónál itt nem takar bele az arcba
    position: { x: 0.5, y: 0.78 },
    animation: 'pop',
    stylePreset: preset,
  });

  const insertClips = (clips: TextClip[]) => {
    // egyetlen commandként — egy undo-lépés az összes felirat
    useEditorStore.getState().dispatch({ type: 'ADD_CLIPS', trackType: 'captions', clips });
  };

  const importSrt = async () => {
    const cues = await pickSrt();
    if (cues === null) {
      return;
    }
    if (cues.length === 0) {
      Alert.alert(t('panels.captions.srtImportFailedTitle'), t('panels.captions.srtImportNoCues'));
      return;
    }
    insertClips(cues.map((cue) => captionClip(cue.text, cue.start, cue.end - cue.start)));
    setPanel(null);
  };

  /**
   * AI-felirat: a videóklipek forrásfájljai a workeren átmennek a Whisperen,
   * majd a forrásidőt trim/sebesség-helyesen képezzük az idővonalra.
   */
  const autoCaptions = async () => {
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const videoClips = trackOf(project, 'video').clips.filter(
      (c): c is VideoClip => c.kind === 'video'
    );
    if (videoClips.length === 0) {
      Alert.alert(t('panels.captions.noVideoTitle'), t('panels.captions.noVideoBody'));
      return;
    }
    // azonos forrásfájl (pl. kettévágott klip) csak egyszer megy át a Whisperen
    const srtByUri = new Map<string, ReturnType<typeof parseSrt>>();
    const uniqueUris = [...new Set(videoClips.map((c) => c.uri))];
    // valódi darabszám-progressz: hányadik videót ismeri fel épp (ETA-val)
    await withProgress(t('panels.captions.aiCaption'), async (report) => {
      for (let i = 0; i < uniqueUris.length; i++) {
        report({
          phase: t('panels.captions.phaseSpeechRecognition'),
          current: i,
          total: uniqueUris.length,
          unit: t('panels.captions.unitVideo'),
        });
        srtByUri.set(uniqueUris[i], parseSrt(await transcribeToSrt(uniqueUris[i])));
        report({
          phase: t('panels.captions.phaseSpeechRecognition'),
          current: i + 1,
          total: uniqueUris.length,
          unit: t('panels.captions.unitVideo'),
        });
      }
      report({ phase: t('panels.captions.phasePlacingCaptions'), ratio: 1 });
    });

    const timelineCues = mapCuesToTimeline(videoClips, srtByUri);
    const clips: TextClip[] = timelineCues.map((cue) =>
      captionClip(cue.text, cue.start, cue.end - cue.start)
    );
    if (clips.length === 0) {
      Alert.alert(t('panels.captions.noSpeechTitle'), t('panels.captions.noSpeechBody'));
      return;
    }
    insertClips(clips);
    setPanel(null);
  };

  const addCaptions = () => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || lines.length === 0) {
      return;
    }
    const from = state.playhead;
    const videoEnd = trackEnd(trackOf(project, 'video'));
    const span = videoEnd - from;
    const per =
      span > MIN_CAPTION
        ? clamp(span / lines.length, MIN_CAPTION, MAX_CAPTION)
        : FALLBACK_CAPTION;

    insertClips(lines.map((text, i) => captionClip(text, from + i * per, per)));
    setRaw('');
    setPanel(null);
  };

  return (
    <View>
      <PanelSection title={t('panels.captions.autoCaptionSectionTitle')}>
        <PrimaryButton
          icon="sparkles-outline"
          label={aiStatus ?? t('panels.captions.captionFromSpeech')}
          onPress={() => {
            if (aiStatus) {
              return; // már fut
            }
            setAiStatus(t('panels.captions.startingStatus'));
            autoCaptions()
              .catch((err: Error) => {
                if (isProRequiredError(err)) {
                  usePaywall.getState().open(err.capability);
                } else {
                  Alert.alert(t('panels.captions.aiCaption'), err.message);
                }
              })
              .finally(() => setAiStatus(null));
          }}
        />
        <Text style={styles.note}>
          {t('panels.captions.autoCaptionNote')}
        </Text>
      </PanelSection>

      <PanelSection title="✨ Caption Studio">
        <PrimaryButton
          icon="flash-outline"
          label={studioStatus ?? t('panels.captions.highlightsEmoji')}
          onPress={() => {
            if (studioStatus) {
              return;
            }
            void runCaptionStudio();
          }}
        />
        <View style={styles.row}>
          <Chip
            label={layoutStatus ?? t('panels.captions.speakerColorsChip')}
            active={false}
            onPress={() => {
              if (!layoutStatus) {
                void runSpeakerColors();
              }
            }}
          />
          <Chip
            label={wordStatus ?? t('panels.captions.wordTimingChip')}
            active={false}
            onPress={() => {
              if (!wordStatus) {
                void runWordTimings();
              }
            }}
          />
          <Chip
            label={layoutStatus ?? t('panels.captions.smartPositionChip')}
            active={false}
            onPress={() => {
              if (!layoutStatus) {
                void runSmartPosition();
              }
            }}
          />
          <Chip
            label={layoutStatus ?? t('panels.captions.speakerLabelsChip')}
            active={false}
            onPress={() => {
              if (!layoutStatus) {
                void runSpeakerLabels();
              }
            }}
          />
        </View>
        <Text style={styles.note}>
          {t('panels.captions.captionStudioNote')}
        </Text>
        <Text style={styles.note}>
          {t('panels.captions.captionStudioNote2')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.captions.styleSectionTitle')}>
        <View style={styles.row}>
          {textStylePresets.map((option) => (
            <Chip
              key={option.id}
              label={t('panels.captions.preset_' + option.id)}
              active={preset === option.id}
              onPress={() => setPreset(option.id)}
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title={t('panels.captions.manualSectionTitle')}>
        <TextInput
          value={raw}
          onChangeText={setRaw}
          multiline
          style={styles.input}
          placeholder={t('panels.captions.manualPlaceholder')}
          placeholderTextColor={palette.textDim}
        />
        <PrimaryButton
          icon="chatbox-ellipses-outline"
          label={
            lines.length > 0
              ? t('panels.captions.addCaptionsFromPlayhead', { count: lines.length })
              : t('panels.captions.writeAtLeastOneLine')
          }
          onPress={addCaptions}
        />
      </PanelSection>

      <PanelSection title={t('panels.captions.srtSectionTitle')}>
        <PrimaryButton
          icon="document-text-outline"
          label={t('panels.captions.importSrtButton')}
          onPress={() => {
            importSrt().catch(() => Alert.alert(t('common.error'), t('panels.captions.srtImportError')));
          }}
        />
        <Text style={styles.note}>
          {t('panels.captions.srtNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.captions.translateSectionTitle')}>
        <View style={styles.row}>
          {TARGET_LANGS.map((l) => (
            <Chip
              key={l.code}
              label={l.label}
              active={false}
              onPress={() => {
                void runTranslate(l.label);
              }}
            />
          ))}
        </View>
        {translateStatus ? <Text style={styles.note}>{translateStatus}</Text> : null}
        <Text style={styles.note}>{t('panels.captions.translateNote')}</Text>
      </PanelSection>

      <Text style={styles.note}>
        {t('panels.captions.footerNote')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    minHeight: 80,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
});
