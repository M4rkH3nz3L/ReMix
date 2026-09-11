import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { mapSourcePointsToTimeline, mapSourceRangesToTimeline } from '@/lib/autoedit';
import { ensureCloud } from '@/lib/backend';
import { detectScenes, detectSilence } from '@/lib/cutlist';
import type { SilenceRange } from '@/lib/cutlist';
import { projectDuration } from '@/lib/projectUtils';
import { clamp, formatRuler } from '@/lib/time';
import { getTimelineTranscript } from '@/lib/transcripts';
import type { Project, VideoClip } from '@/types/project';

/**
 * 📈 AI Pacing (Phase 1.2): a videó TEMPÓ-térképe VALÓS worker-jelekből —
 * beszéd-sűrűség (Whisper-átirat), csend-arány (ffmpeg silencedetect) és
 * vizuális változás (jelenet- + klip-vágások). Az energiát idő-ablakonként
 * számoljuk (determinisztikus, nincs LLM-hallucináció), és megnevezzük a lassú
 * szakaszokat egy kimondott javaslattal.
 *
 * Pro-funkció: `ensureCloud('pacingAnalyze')` — nincs Pro → ProRequiredError,
 * amit a hívó `guardPro`-val paywallra fordít. A jelek best-effort (web / nincs
 * worker → nincs elemzés).
 */

export interface PacingInsight {
  /** lassú (alacsony energiájú) szakaszok az idővonalon (mp) */
  slow: { start: number; end: number }[];
  /** rövid, kimondott összefoglaló a felhasználónak */
  summary: string;
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Tempó-elemzés. `null`, ha nincs értékelhető jel (pl. web / worker nélkül). */
export async function analyzePacing(project: Project): Promise<PacingInsight | null> {
  // Pro-kapu (a felhő-jelek — átirat/csend/jelenet — lekérése előtt)
  ensureCloud('pacingAnalyze');
  if (Platform.OS === 'web') {
    return null;
  }
  const duration = projectDuration(project);
  if (duration <= 1) {
    return null;
  }

  const videoClips = project.tracks
    .filter((tk) => tk.type === 'video')
    .flatMap((tk) => tk.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  if (videoClips.length === 0) {
    return null;
  }

  // worker-jelek klipenként (fájlonként egyszer), majd idővonal-időre képezve
  const uris = [...new Set(videoClips.map((c) => c.uri))];
  const silencesByUri = new Map<string, SilenceRange[]>();
  const scenesByUri = new Map<string, number[]>();
  for (const uri of uris) {
    const [sil, sc] = await Promise.all([detectSilence(uri), detectScenes(uri)]);
    if (sil) {
      silencesByUri.set(uri, sil);
    }
    if (sc) {
      scenesByUri.set(uri, sc);
    }
  }
  const silences = mapSourceRangesToTimeline(videoClips, silencesByUri);
  const scenes = mapSourcePointsToTimeline(videoClips, scenesByUri);
  const transcript = (await getTimelineTranscript(project).catch(() => null)) ?? [];

  // ha SEMMI jel nem jött (nincs worker / minden null), nincs értelmes elemzés
  if (silences.length === 0 && scenes.length === 0 && transcript.length === 0) {
    return null;
  }

  const clipBounds = [
    ...videoClips.map((c) => c.start),
    ...videoClips.map((c) => c.start + c.duration),
  ];

  // idő-ablakok: ~20 db, 2–4 mp
  const windowSec = clamp(duration / 20, 2, 4);
  const n = Math.max(1, Math.ceil(duration / windowSec));
  const energies: number[] = [];
  for (let i = 0; i < n; i++) {
    const w0 = i * windowSec;
    const w1 = Math.min(duration, (i + 1) * windowSec);
    const wLen = Math.max(0.001, w1 - w0);
    const speechCov = clamp(
      transcript.reduce((s, l) => s + overlap(w0, w1, l.start, l.end), 0) / wLen,
      0,
      1
    );
    const silenceCov = clamp(
      silences.reduce((s, r) => s + overlap(w0, w1, r.start, r.end), 0) / wLen,
      0,
      1
    );
    const sceneCuts = scenes.filter((x) => x >= w0 && x < w1).length;
    const clipCuts = clipBounds.filter((x) => x > w0 + 0.01 && x < w1 - 0.01).length;
    const visual = clamp((sceneCuts + clipCuts) / 2, 0, 1); // ~2 vágás/ablak = teli
    const energy = clamp(0.55 * speechCov + 0.45 * visual - 0.5 * silenceCov, 0, 1);
    energies.push(energy);
  }

  // lassú szakaszok: egymást követő alacsony-energiájú ablakok, ≥3 mp hosszban
  const SLOW = 0.3;
  const slow: { start: number; end: number }[] = [];
  let run = -1;
  for (let i = 0; i <= n; i++) {
    const low = i < n && energies[i] < SLOW;
    if (low && run < 0) {
      run = i;
    } else if (!low && run >= 0) {
      const start = run * windowSec;
      const end = Math.min(duration, i * windowSec);
      if (end - start >= 3) {
        slow.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
      }
      run = -1;
    }
  }

  const summary = buildSummary(slow);
  return { slow, summary };
}

/** A lassú szakaszokból kimondott összefoglaló (a leghosszabbat nevezi meg). */
function buildSummary(slow: { start: number; end: number }[]): string {
  if (slow.length === 0) {
    return tr('editor.pacing.aiGood');
  }
  const longest = [...slow].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  const from = formatRuler(longest.start);
  const to = formatRuler(longest.end);
  return slow.length === 1
    ? tr('editor.pacing.aiSlowOne', { from, to })
    : tr('editor.pacing.aiSlowMany', { from, to, count: slow.length });
}
