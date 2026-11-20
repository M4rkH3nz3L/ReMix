import { mixForExport } from '@/lib/audioExportMix';
import { sampleChannel } from '@/lib/keyframes';
import { offlineMixPlan, type OfflineMixPlan } from '@/lib/offlineMix';
import { referenceMatchGain, referenceProject } from '@/lib/referenceAB';
import { clamp } from '@/lib/time';
import type { AudioClip, Clip, Project, TrackType } from '@/types/project';

/**
 * 🎧 Az előnézeti hangréteg (`components/preview/AudioLayer.tsx`) expo-mentes magja: a
 * keverési terv, a sáv-monitorozás, a klip-hangerő (automáció × fade × fader × master) és
 * a feldolgozás nélküli A/B-projekt.
 */

/** a referencia-dal a keverési tervhez (a `referenceStore` `ReferenceTrack`-je) */
export interface PreviewReferenceTrack {
  uri: string;
  name: string;
  lufs: number;
  duration: number;
}

export interface PreviewMixInput {
  masterVolume: number;
  muted: TrackType[];
  solo: TrackType[];
  fxBypass: boolean;
  refTrack: PreviewReferenceTrack | null;
  mixLufs: number | null;
}

/** 🎚️ sáv-monitorozás: solo esetén csak a solo-sávok, különben a nem némítottak szólnak */
export function trackAudible(type: TrackType, muted: TrackType[], solo: TrackType[]): boolean {
  return solo.length > 0 ? solo.includes(type) : !muted.includes(type);
}

/**
 * 🎧 az exporttal AZONOS keverési terv (mute/solo/fader/master is) — ezt játssza a motor;
 * 🅰️🅱️ A/B-nél a feldolgozás nélküli eredeti (az exportot nem érinti)
 * 🎧🅰️🅱️ referencia hallgatása: a motor a referenciát játssza a keverés helyett (hangosság-illesztve)
 */
export function previewMixPlan(project: Project | null, input: PreviewMixInput): OfflineMixPlan | null {
  const { masterVolume, muted, solo, fxBypass, refTrack, mixLufs } = input;
  if (!project) {
    return null;
  }
  if (refTrack) {
    return offlineMixPlan(referenceProject(project, refTrack, referenceMatchGain(refTrack.lufs, mixLufs ?? refTrack.lufs)));
  }
  const audible = (t: TrackType) => trackAudible(t, muted, solo);
  const mix = mixForExport(fxBypass ? withoutProcessing(project) : project, audible, masterVolume);
  return mix ? offlineMixPlan(mix) : null;
}

/** 🅰️🅱️ a projekt feldolgozás nélkül: klip-effektek, hangjavítás, visszhang-csökkentés, master nélkül */
export function withoutProcessing(project: Project): Project {
  return {
    ...project,
    audioMaster: undefined,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) =>
        c.kind === 'audio'
          ? ({ ...c, audioFx: undefined, voiceEnhance: false, deReverb: false } as Clip)
          : c.kind === 'video'
            ? ({ ...c, voiceEnhance: false, deReverb: false } as Clip)
            : c
      ),
    })),
  };
}

/** a klip fade-be/fade-ki szorzója a klip-idő `t`-nél (0–1) */
export function fadeFactor(clip: AudioClip, t: number): number {
  let factor = 1;
  if (clip.fadeIn > 0) {
    factor = Math.min(factor, clamp(t / clip.fadeIn, 0, 1));
  }
  if (clip.fadeOut > 0) {
    factor = Math.min(factor, clamp((clip.duration - t) / clip.fadeOut, 0, 1));
  }
  return factor;
}

/**
 * a klip-lejátszó hangereje a klip-idő `t`-nél: hangerő-automáció × fade (0–1 közé vágva),
 * némán 0, utána × sáv-fader × master
 */
export function clipPreviewVolume(clip: AudioClip, t: number, audible: boolean, trackGain: number, masterVolume: number): number {
  // 🎚️ hangerő-automáció: a volume-csatorna a playheadből interpolál
  const automated = sampleChannel(clip.keyframes?.volume, t, clip.volume);
  return (audible ? clamp(automated * fadeFactor(clip, t), 0, 1) : 0) * trackGain * masterVolume;
}
