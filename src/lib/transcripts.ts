import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { transcribeToSrt } from '@/lib/render';
import type { ProgressUpdate } from '@/lib/progress';
import { mapCuesToTimeline, parseSrt } from '@/lib/srt';
import type { SrtCue } from '@/lib/srt';
import type { Project, VideoClip } from '@/types/project';

/**
 * Idővonal-átirat az AI-kontextushoz (full-plan F3, szemantikus index): a
 * videók beszéde Whisperrel átírva, a klipek trim/sebesség-ablakain át az
 * idővonalra képezve. Fájlonként cache-elve — egy hosszabb projektnél is csak
 * egyszer fut le a felismerés.
 */

/** e fölött nem indítunk automatikus átirat-készítést (mp, összes videó) */
const MAX_AUTO_TRANSCRIBE_SECONDS = 15 * 60;
/** ennyi sort adunk az AI-kontextusba legfeljebb */
const MAX_CONTEXT_LINES = 200;

const cueCache = new Map<string, SrtCue[]>();
const wordCueCache = new Map<string, SrtCue[]>();

/**
 * Szó-szintű cue-k a projekt videóihoz (text-based editing, P0‑3) —
 * fájlonként cache-elve. Best-effort: a nem átírható fájlok kimaradnak.
 */
export async function getProjectWordCues(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void
): Promise<Map<string, SrtCue[]>> {
  const cuesByUri = new Map<string, SrtCue[]>();
  if (Platform.OS === 'web') {
    return cuesByUri;
  }
  const uris = [
    ...new Set(
      project.tracks
        .filter((t) => t.type === 'video')
        .flatMap((t) => t.clips)
        .filter((c): c is VideoClip => c.kind === 'video')
        .map((c) => c.uri)
    ),
  ];
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    const cached = wordCueCache.get(uri);
    if (cached) {
      cuesByUri.set(uri, cached);
      continue;
    }
    onProgress?.({
      phase: tr('lib.transcripts.wordLevelTranscriptPhase'),
      current: i + 1,
      total: uris.length,
      unit: tr('lib.transcripts.videoUnit'),
    });
    try {
      const cues = parseSrt(await transcribeToSrt(uri, 'word'));
      wordCueCache.set(uri, cues);
      cuesByUri.set(uri, cues);
    } catch {
      // nincs worker / Whisper / hang — a többi fájllal megyünk tovább
    }
  }
  return cuesByUri;
}

export interface TranscriptLine {
  /** idővonal-mp */
  start: number;
  end: number;
  text: string;
}

/**
 * A projekt idővonal-átirata. Best-effort: null, ha weben fut, nincs worker /
 * Whisper, vagy az anyag túl hosszú az automatikus felismeréshez — a hívó
 * átirat nélkül megy tovább.
 */
export async function getTimelineTranscript(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void
): Promise<TranscriptLine[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const videoClips = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  if (videoClips.length === 0) {
    return null;
  }
  const totalSeconds = videoClips.reduce((sum, c) => sum + c.duration, 0);
  if (totalSeconds > MAX_AUTO_TRANSCRIBE_SECONDS) {
    return null;
  }

  const uniqueUris = [...new Set(videoClips.map((c) => c.uri))];
  const cuesByUri = new Map<string, SrtCue[]>();
  for (let i = 0; i < uniqueUris.length; i++) {
    const uri = uniqueUris[i];
    const cached = cueCache.get(uri);
    if (cached) {
      cuesByUri.set(uri, cached);
      continue;
    }
    onProgress?.({
      phase: tr('lib.transcripts.transcribePhase'),
      current: i + 1,
      total: uniqueUris.length,
      unit: tr('lib.transcripts.videoUnit'),
    });
    try {
      const cues = parseSrt(await transcribeToSrt(uri));
      cueCache.set(uri, cues);
      cuesByUri.set(uri, cues);
    } catch {
      // nincs worker / Whisper / hang — a többi fájllal megyünk tovább
    }
  }
  if (cuesByUri.size === 0) {
    return null;
  }

  const lines = mapCuesToTimeline(videoClips, cuesByUri, 0.2).map((cue) => ({
    start: Math.round(cue.start * 10) / 10,
    end: Math.round(cue.end * 10) / 10,
    text: cue.text,
  }));
  return lines.slice(0, MAX_CONTEXT_LINES);
}
