import { AI_PROBE_TIMEOUT_MS, aiFetch } from '@/lib/aiFetch';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import {
  buildAutoEditContext,
  fitKeepsToTarget,
  heuristicVariants,
  mapSourcePointsToTimeline,
  mapSourceRangesToTimeline,
} from '@/lib/autoedit';
import type { AutoEditSignals, AutoEditVariant } from '@/lib/autoedit';
import { detectBeats, timelineBeats } from '@/lib/beats';
import { detectScenes, detectSilence } from '@/lib/cutlist';
import { projectDuration } from '@/lib/projectUtils';
import { aiConfigForTask } from '@/lib/aiProviders';
import { ensureCloud } from '@/lib/backend';
import type { ProgressUpdate } from '@/lib/progress';
import { fetchShotScores } from '@/lib/shotScore';
import { getTimelineTranscript } from '@/lib/transcripts';
import type { Project, VideoClip } from '@/types/project';

/**
 * AI Edit Engine hálózati rétege (P0‑1): a meglévő jel-detektorok (csend,
 * jelenet, átirat, beat — mind cache-elt) begyűjtése idővonal-időre képezve,
 * majd a worker /ai/autoedit hívása. AI nélkül heurisztikus fallback — a
 * funkció így is működik.
 */

export interface AutoEditResult {
  variants: AutoEditVariant[];
  source: 'ai' | 'heuristic';
}

async function gatherSignals(
  project: Project,
  targetSeconds: number,
  onProgress?: (u: ProgressUpdate) => void
): Promise<AutoEditSignals> {
  const videoClips = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  const uris = [...new Set(videoClips.map((c) => c.uri))];

  const silencesByUri = new Map<string, { start: number; end: number }[]>();
  const scenesByUri = new Map<string, number[]>();
  for (let i = 0; i < uris.length; i++) {
    onProgress?.({
      phase: tr('lib.autoeditClient.phaseAnalyzeClips'),
      current: i + 1,
      total: uris.length,
      unit: tr('lib.autoeditClient.unitClip'),
    });
    const [silences, scenes] = await Promise.all([
      detectSilence(uris[i]),
      detectScenes(uris[i]),
    ]);
    if (silences) {
      silencesByUri.set(uris[i], silences);
    }
    if (scenes) {
      scenesByUri.set(uris[i], scenes);
    }
  }

  const transcript =
    (await getTimelineTranscript(project, onProgress).catch(() => null)) ?? [];

  let beats: number[] = [];
  let bpm = 0;
  const musicClip = project.tracks
    .filter((t) => t.type === 'music')
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'audio')
    .sort((a, b) => a.start - b.start)[0];
  if (musicClip && musicClip.kind === 'audio') {
    onProgress?.({ phase: tr('lib.autoeditClient.phaseBeatAnalysis') });
    const grid = await detectBeats(musicClip.uri);
    if (grid && grid.beats.length > 0) {
      beats = timelineBeats(musicClip, grid.beats);
      bpm = grid.bpm;
    }
  }

  // 🏆 best-shot: a jelenet-kezdetek utáni fél másodperc reprezentatív kockái
  // (forrás-időben), fájlonként pontozva, majd idővonal-időre képezve
  onProgress?.({ phase: tr('lib.autoeditClient.phaseScoreFrames') });
  const shotScores: { t: number; score: number; faces: number }[] = [];
  for (const uri of uris) {
    const sceneTimes = [0.5, ...(scenesByUri.get(uri) ?? []).map((s) => s + 0.5)];
    const shots = await fetchShotScores(uri, sceneTimes.slice(0, 16));
    if (!shots) {
      continue;
    }
    for (const clip of videoClips.filter((c) => c.uri === uri)) {
      const winStart = clip.trimIn;
      const winEnd = clip.trimIn + clip.duration * clip.speed;
      for (const s of shots) {
        if (s.t >= winStart && s.t < winEnd) {
          shotScores.push({
            t: clip.start + (s.t - winStart) / clip.speed,
            score: s.score,
            faces: s.faces,
          });
        }
      }
    }
  }
  shotScores.sort((a, b) => a.t - b.t);

  return {
    duration: projectDuration(project),
    targetSeconds,
    scenes: mapSourcePointsToTimeline(videoClips, scenesByUri),
    transcript,
    silences: mapSourceRangesToTimeline(videoClips, silencesByUri),
    beats,
    bpm,
    shotScores,
  };
}

/** a modell-válasz normalizálása — hiányzó/rossz típusú mezők nem dönthetik el a UI-t */
function validVariants(body: unknown): AutoEditVariant[] | null {
  const variants = (body as { variants?: AutoEditVariant[] })?.variants;
  if (!Array.isArray(variants) || variants.length === 0) {
    return null;
  }
  const ok = variants
    .filter(
      (v) =>
        v &&
        Array.isArray(v.keep) &&
        v.keep.length > 0 &&
        v.keep.every((k) => typeof k?.start === 'number' && typeof k?.end === 'number')
    )
    .map((v) => ({
      id: v.id === 'viral' || v.id === 'cinematic' || v.id === 'fast' ? v.id : 'fast',
      title: typeof v.title === 'string' && v.title ? v.title.slice(0, 60) : tr('lib.autoeditClient.variantFallbackTitle'),
      rationale: typeof v.rationale === 'string' ? v.rationale.slice(0, 200) : '',
      keep: v.keep,
      captions: Array.isArray(v.captions)
        ? v.captions.filter(
            (c) =>
              c &&
              typeof c.text === 'string' &&
              typeof c.start === 'number' &&
              typeof c.duration === 'number'
          )
        : [],
    }));
  return ok.length > 0 ? ok : null;
}

/** A teljes Auto Edit folyamat: jelek → AI (vagy heurisztika) → változatok. */
export async function runAutoEditFlow(
  project: Project,
  targetSeconds: number,
  onProgress?: (u: ProgressUpdate) => void
): Promise<AutoEditResult> {
  const signals = await gatherSignals(project, targetSeconds, onProgress);

  if (Platform.OS !== 'web') {
    try {
      const base = ensureCloud('autoEdit');
      // a felhasználó saját modellje (BYOK), ha van — ekkor az env-AI nem kell
      const aiConfig = await aiConfigForTask('autoEdit');
      const health = (await (
        await aiFetch(`${base}/health`, {}, AI_PROBE_TIMEOUT_MS)
      ).json()) as { ai?: boolean };
      if (health.ai || aiConfig) {
        onProgress?.({ phase: tr('lib.autoeditClient.phaseAiCutPlanning') });
        const res = await aiFetch(`${base}/ai/autoedit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: buildAutoEditContext(signals), aiConfig }),
        });
        if (res.ok) {
          const variants = validVariants(await res.json());
          if (variants) {
            // cél-hossz guard: a kis modellek hajlamosak túllőni — a story
            // eleje marad, beat-re igazítva
            const fitted = variants.map((v) => {
              const total = v.keep.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
              return total > targetSeconds * 1.25
                ? { ...v, keep: fitKeepsToTarget(v.keep, targetSeconds * 1.15, signals.beats) }
                : v;
            });
            return { variants: fitted, source: 'ai' };
          }
        }
      }
    } catch {
      // worker/AI hiba — heurisztikával megyünk tovább
    }
  }

  onProgress?.({ phase: tr('lib.autoeditClient.phaseCutPlanning') });
  return { variants: heuristicVariants(signals), source: 'heuristic' };
}
