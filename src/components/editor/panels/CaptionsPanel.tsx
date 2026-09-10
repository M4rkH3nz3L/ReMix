import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { aspectValue, palette, textStylePresets } from '@/constants/editor';
import { isProRequiredError } from '@/lib/backend';
import { assignSpeakers, captionBand, captionY, speakerColor } from '@/lib/captionLayout';
import { applyCaptionSuggestions, heuristicSuggestions } from '@/lib/captionStudio';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import type { FaceBoxLike } from '@/lib/faceRegion';
import { fetchCaptionSuggestions } from '@/lib/captionStudioClient';
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
import { usePaywall } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { TextClip, TextStylePreset, VideoClip } from '@/types/project';

/** feliratonkénti hossz-korlátok (mp) */
const MIN_CAPTION = 1;
const MAX_CAPTION = 5;
const FALLBACK_CAPTION = 2.5;

/**
 * Gyors felirat: soronként egy caption, a lejátszófejtől a videósáv végéig
 * egyenletesen elosztva. Ugyanez a belépési pont fogadja majd a beszédfelismerés
 * (auto-caption) eredményét is.
 */
export function CaptionsPanel() {
  const [raw, setRaw] = useState('');
  const [preset, setPreset] = useState<TextStylePreset>('bubble');
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [studioStatus, setStudioStatus] = useState<string | null>(null);
  const [layoutStatus, setLayoutStatus] = useState<string | null>(null);
  const [wordStatus, setWordStatus] = useState<string | null>(null);

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
      Alert.alert('Szó-időzítés', 'Nincs felirat a sávon.');
      return;
    }
    setWordStatus('Szó-átirat…');
    try {
      const cuesByUri = await withProgress('Szó-időzítés', (report) =>
        getProjectWordCues(state.project!, report)
      );
      if (cuesByUri.size === 0) {
        Alert.alert(
          'Szó-időzítés',
          'Nem érhető el szó-szintű átirat — fut a worker (Whisper)?'
        );
        return;
      }
      setWordStatus('Igazítás…');
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
          'Szó-időzítés',
          'Egy feliratot sem sikerült megbízhatóan igazítani — maradt az ' +
            'egyenletes elosztás. (A felirat szövege nagyon eltérhet az elhangzottaktól.)'
        );
        return;
      }
      state.dispatch(
        { type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips },
        'ai'
      );
      Alert.alert(
        'Szó-időzítés kész',
        `${aligned} felirat kapott valódi szó-időzítést` +
          (skipped > 0 ? ` (${skipped} maradt egyenletesen)` : '') +
          '.\n\nA karaoke-kiemelés mostantól a tényleges kimondáshoz igazodik — ' +
          'előnézetben és a renderelt videóban is.'
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
      setLayoutStatus(`Arcok keresése… (${Math.min(i + 4, items.length)}/${items.length})`);
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
      Alert.alert('Beszélő-színek', 'Legalább két felirat kell hozzá.');
      return;
    }
    setLayoutStatus('Elemzés…');
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
        'Beszélő-színek',
        'Egyetlen beszélőt találtam — több kamera/nézőpont kell a szétválasztáshoz.'
      );
      return;
    }
    const clips = track.clips.map((c) => {
      const idx = speakers.get(c.id);
      return c.kind === 'text' && idx != null ? { ...c, color: speakerColor(idx) } : c;
    });
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
    Alert.alert(
      'Beszélő-színek kész',
      `${count} beszélő, mindegyik saját színnel. A szín a Szöveg panelen bármikor átírható.`
    );
  };

  /** 📐 okos pozíció: a felirat kikerüli az arcot (fölé/alá ugrik) */
  const runSmartPosition = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((t) => t.type === 'captions');
    const captions = (track?.clips ?? []).filter(
      (c): c is TextClip => c.kind === 'text'
    );
    if (!track || captions.length === 0) {
      Alert.alert('Okos pozíció', 'Nincs felirat a sávon.');
      return;
    }
    setLayoutStatus('Elemzés…');
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
        'Okos pozíció',
        samples.size === 0
          ? 'Nem érhető el az arc-detektor — fut a worker?'
          : 'Egyik felirat sem takart arcot — minden marad a helyén.'
      );
      return;
    }
    state.dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips }, 'ai');
    Alert.alert(
      'Okos pozíció kész',
      `${moved} felirat került arrébb, hogy ne takarja az arcot. Visszavonható egy lépésben.`
    );
  };

  // ✨ Caption Studio: kiemelt szavak + emoji a meglévő feliratokra — AI-val,
  // AI nélkül heurisztikával; egy undo-lépés (REPLACE_TRACK_CLIPS)
  const runCaptionStudio = async () => {
    const state = useEditorStore.getState();
    const track = state.project?.tracks.find((t) => t.type === 'captions');
    const captions = (track?.clips ?? []).filter((c) => c.kind === 'text');
    if (!track || captions.length === 0) {
      Alert.alert('Caption Studio', 'Nincs felirat a sávon — előbb készíts feliratokat.');
      return;
    }
    setStudioStatus('Elemzés…');
    const segments = captions.map((c) => ({ id: c.id, text: (c as TextClip).text }));
    const ai = await fetchCaptionSuggestions(segments);
    const suggestions = ai ?? heuristicSuggestions(segments);
    setStudioStatus(null);
    const { clips, changed } = applyCaptionSuggestions(track.clips, suggestions);
    if (changed === 0) {
      Alert.alert('Caption Studio', 'Nem találtam kiemelésre érdemes szót.');
      return;
    }
    state.dispatch(
      { type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips },
      'ai'
    );
    Alert.alert(
      'Caption Studio kész',
      `${changed} felirat kapott kiemelést${ai ? ' (AI)' : ' (heurisztika — worker nélkül)'}. ` +
        'A kiemelt szavak nagyobbak és színesek — előnézetben és a renderelt videóban is.'
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
      Alert.alert('Nem sikerült', 'A fájlban nem találtam értelmezhető SRT-feliratot.');
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
      Alert.alert('Nincs videó', 'Az AI-felirathoz előbb adj hozzá videót hanggal.');
      return;
    }
    // azonos forrásfájl (pl. kettévágott klip) csak egyszer megy át a Whisperen
    const srtByUri = new Map<string, ReturnType<typeof parseSrt>>();
    const uniqueUris = [...new Set(videoClips.map((c) => c.uri))];
    // valódi darabszám-progressz: hányadik videót ismeri fel épp (ETA-val)
    await withProgress('AI-felirat', async (report) => {
      for (let i = 0; i < uniqueUris.length; i++) {
        report({
          phase: 'Beszédfelismerés',
          current: i,
          total: uniqueUris.length,
          unit: 'videó',
        });
        srtByUri.set(uniqueUris[i], parseSrt(await transcribeToSrt(uniqueUris[i])));
        report({
          phase: 'Beszédfelismerés',
          current: i + 1,
          total: uniqueUris.length,
          unit: 'videó',
        });
      }
      report({ phase: 'Feliratok elhelyezése', ratio: 1 });
    });

    const timelineCues = mapCuesToTimeline(videoClips, srtByUri);
    const clips: TextClip[] = timelineCues.map((cue) =>
      captionClip(cue.text, cue.start, cue.end - cue.start)
    );
    if (clips.length === 0) {
      Alert.alert('Nincs beszéd', 'A videókban nem találtam felismerhető beszédet.');
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
      <PanelSection title="Automatikus felirat (AI)">
        <PrimaryButton
          icon="sparkles-outline"
          label={aiStatus ?? 'Felirat a beszédből (Whisper)'}
          onPress={() => {
            if (aiStatus) {
              return; // már fut
            }
            setAiStatus('Indítás…');
            autoCaptions()
              .catch((err: Error) => {
                if (isProRequiredError(err)) {
                  usePaywall.getState().open(err.capability);
                } else {
                  Alert.alert('AI-felirat', err.message);
                }
              })
              .finally(() => setAiStatus(null));
          }}
        />
        <Text style={styles.note}>
          A videóid hangja a render workeren (Whisper) átírásra kerül, és időzített,
          stílusozott feliratsáv lesz belőle. Vágás és sebesség figyelembe véve.
        </Text>
      </PanelSection>

      <PanelSection title="✨ Caption Studio">
        <PrimaryButton
          icon="flash-outline"
          label={studioStatus ?? 'Kiemelések + emoji (AI)'}
          onPress={() => {
            if (studioStatus) {
              return;
            }
            void runCaptionStudio();
          }}
        />
        <View style={styles.row}>
          <Chip
            label={layoutStatus ?? '🗣️ Beszélő-színek'}
            active={false}
            onPress={() => {
              if (!layoutStatus) {
                void runSpeakerColors();
              }
            }}
          />
          <Chip
            label={wordStatus ?? '🎤 Szó-időzítés'}
            active={false}
            onPress={() => {
              if (!wordStatus) {
                void runWordTimings();
              }
            }}
          />
          <Chip
            label={layoutStatus ?? '📐 Okos pozíció'}
            active={false}
            onPress={() => {
              if (!layoutStatus) {
                void runSmartPosition();
              }
            }}
          />
        </View>
        <Text style={styles.note}>
          A fontos szavak kiemelést kapnak (nagyobb, színes — karaoke-val
          kombinálva is), és ahol illik, emoji kerül a felirat végére. AI nélkül
          konzervatív heurisztika megy. Egy lépésben visszavonható.
        </Text>
        <Text style={styles.note}>
          A beszélő-színek a kamera-váltás és az arc helye alapján csoportosítják
          a sorokat, és mindegyik beszélő saját színt kap. Az okos pozíció
          megnézi, takarja-e a felirat az arcot, és ha igen, az arc másik
          oldalára viszi. A szó-időzítés a beszédfelismerés szó-szintű
          átiratához igazítja a karaoke-kiemelést, hogy a szó pont akkor
          gyulladjon fel, amikor elhangzik.
        </Text>
      </PanelSection>

      <PanelSection title="Stílus">
        <View style={styles.row}>
          {textStylePresets.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              active={preset === option.id}
              onPress={() => setPreset(option.id)}
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title="Kézi feliratok — soronként egy">
        <TextInput
          value={raw}
          onChangeText={setRaw}
          multiline
          style={styles.input}
          placeholder={'Ez a hook, ami megfog\nEz a második mondat\nKövess a többiért!'}
          placeholderTextColor={palette.textDim}
        />
        <PrimaryButton
          icon="chatbox-ellipses-outline"
          label={
            lines.length > 0
              ? `${lines.length} felirat hozzáadása a lejátszófejtől`
              : 'Írj legalább egy sort'
          }
          onPress={addCaptions}
        />
      </PanelSection>

      <PanelSection title="SRT-import">
        <PrimaryButton
          icon="document-text-outline"
          label="SRT-felirat importálása"
          onPress={() => {
            importSrt().catch(() => Alert.alert('Hiba', 'Az SRT-import nem sikerült.'));
          }}
        />
        <Text style={styles.note}>
          Whisper / YouTube / CapCut által generált .srt fájlból kész, időzített
          feliratsáv lesz — a kiválasztott stílussal.
        </Text>
      </PanelSection>

      <Text style={styles.note}>
        A beírt sorok a lejátszófejtől a videó végéig egyenletesen oszlanak el, utána
        egyenként igazíthatod őket az idővonalon.
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
