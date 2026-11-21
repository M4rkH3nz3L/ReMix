import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { aspectValue } from '@/constants/editor';
import { assignSpeakers, captionBand, captionY, speakerColor } from '@/lib/captionLayout';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import type { FaceBoxLike } from '@/lib/faceRegion';
import { activeVisualClip, sourceTimeAt } from '@/lib/projectUtils';
import { getProjectWordCues } from '@/lib/transcripts';
import { alignWordTimings, cuesToCaptionTime } from '@/lib/wordTiming';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { TextClip } from '@/types/project';

/**
 * A felirat-panel elrendezési akciói (REFACTOR: a CaptionsPanel.tsx-ből): szó-szintű
 * karaoke-időzítés, beszélő-színek/-címkék, okos pozíció. Hook nélküli gyár — a gyökér
 * settereit kapja, a store-t a hívás pillanatában olvassa.
 */

export interface CaptionLayoutActionDeps {
  t: TFunction;
  setLayoutStatus: (status: string | null) => void;
  setWordStatus: (status: string | null) => void;
}

export function createCaptionLayoutActions({ t, setLayoutStatus, setWordStatus }: CaptionLayoutActionDeps) {
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
  return { runWordTimings, runSpeakerColors, runSpeakerLabels, runSmartPosition };
}
