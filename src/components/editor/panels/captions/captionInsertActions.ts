import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { captionClip as presetCaptionClip, quickCaptionDuration } from '@/lib/captionPanelOps';
import { pickSrt } from '@/lib/media';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { transcribeToSrt } from '@/lib/render';
import { mapCuesToTimeline, parseSrt } from '@/lib/srt';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { TextClip, TextStylePreset, VideoClip } from '@/types/project';

/**
 * A felirat-panel beszúró akciói (REFACTOR: a CaptionsPanel.tsx-ből): SRT-import,
 * AI-felirat (beszédfelismerés) és a gyors kézi felirat. Hook nélküli gyár — a
 * gyökér állapotát/settereit kapja, a store-t a hívás pillanatában olvassa.
 */

export interface CaptionInsertActionDeps {
  t: TFunction;
  preset: TextStylePreset;
  lines: string[];
  setRaw: (raw: string) => void;
  setPanel: (panel: null) => void;
}

export function createCaptionInsertActions({ t, preset, lines, setRaw, setPanel }: CaptionInsertActionDeps) {
  const captionClip = (
    text: string,
    start: number,
    duration: number
  ): TextClip => presetCaptionClip(text, start, duration, preset);

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
    const per = quickCaptionDuration(span, lines.length);

    insertClips(lines.map((text, i) => captionClip(text, from + i * per, per)));
    setRaw('');
    setPanel(null);
  };
  return { importSrt, autoCaptions, addCaptions };
}
