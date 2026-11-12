import type { EditorCommand } from '@/lib/commands';
import type { DrumPattern, DrumVelocity } from '@/lib/drums';
import type { SynthNote, SynthWave } from '@/lib/synth';
import type { Asset, AudioClip, InstrumentDoc, Project } from '@/types/project';

/**
 * 🎹🥁 Hangszer-minta (MU1) — pure mag. A dobgép és a piano roll eredménye nem csak egy sütött
 * hangfájl: a minta (`InstrumentDoc`) a projektben marad, a klip `instrumentDocId`-vel hivatkozik
 * rá. Az újrasütés egy kötegben (egy visszavonás) írja a mintát és frissíti az összes rá hivatkozó
 * klipet; a klip helye, hangereje és effektjei maradnak.
 */

export interface BakeResult {
  uri: string;
  durationSec: number;
}

export function synthDoc(id: string, bpm: number, bars: number, wave: SynthWave, notes: SynthNote[]): InstrumentDoc {
  return { id, kind: 'synth', bpm, bars, synth: { wave, notes: notes.map((n) => ({ ...n })) } };
}

export function drumsDoc(id: string, bpm: number, bars: number, pattern: DrumPattern, velocity: DrumVelocity = {}, swing = 0): InstrumentDoc {
  return {
    id,
    kind: 'drums',
    bpm,
    bars,
    drums: { pattern, ...(Object.keys(velocity).length ? { velocity } : {}), ...(swing > 0 ? { swing } : {}) },
  };
}

export const instrumentDocOf = (project: Project | null | undefined, id: string | undefined): InstrumentDoc | null =>
  (id && project?.instrumentDocs?.find((d) => d.id === id)) || null;

/** a mintára hivatkozó hang-klipek */
export function clipsOfDoc(project: Project, docId: string): AudioClip[] {
  const out: AudioClip[] = [];
  for (const t of project.tracks) {
    for (const c of t.clips) if (c.kind === 'audio' && c.instrumentDocId === docId) out.push(c);
  }
  return out;
}

/**
 * az újrasütött klip hossza: a vágatlan klip az új minta teljes hosszát kapja; a megvágott vagy
 * hurkolt klip a hosszát tartja, de nem nyúlhat túl az új forráson (a hurok a forrásnál rövidebb is lehet)
 */
export function rebakedDuration(clip: AudioClip, newSourceSec: number): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const trimIn = clip.trimIn ?? 0;
  const untrimmed = trimIn === 0 && Math.abs(clip.duration * speed - (clip.sourceDuration ?? clip.duration * speed)) < 1e-3;
  if (clip.loopLength) return clip.duration;
  if (untrimmed) return newSourceSec / speed;
  return Math.max(0.01, Math.min(clip.duration, (newSourceSec - trimIn) / speed));
}

/** új minta sütése: a minta + a klip egy kötegben */
export function bakeNewCommands(doc: InstrumentDoc, trackType: 'music', clip: AudioClip, asset: Asset): EditorCommand[] {
  return [
    { type: 'UPSERT_INSTRUMENT_DOC', doc },
    { type: 'ADD_CLIP', trackType, clip: { ...clip, instrumentDocId: doc.id }, asset },
  ];
}

/** egy meglévő minta újrasütése: a minta + minden hivatkozó klip új hangja (egy kötegben) */
export function rebakeCommands(project: Project, doc: InstrumentDoc, result: BakeResult, asset: Asset): EditorCommand[] {
  const out: EditorCommand[] = [{ type: 'UPSERT_INSTRUMENT_DOC', doc }, { type: 'ADD_ASSET', asset }];
  for (const clip of clipsOfDoc(project, doc.id)) {
    out.push({
      type: 'UPDATE_CLIP',
      clipId: clip.id,
      patch: {
        uri: result.uri,
        assetId: asset.id,
        trimIn: clip.loopLength ? (clip.trimIn ?? 0) : Math.min(clip.trimIn ?? 0, Math.max(0, result.durationSec - 0.01)),
        sourceDuration: result.durationSec,
        duration: rebakedDuration(clip, result.durationSec),
      },
    });
  }
  return out;
}
