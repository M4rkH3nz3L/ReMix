import { audioSpeedOf } from '@/lib/audioTrim';
import { projectDuration } from '@/lib/projectUtils';
import { FX_AUTO_KEYS, type FxAutomation, fxActive, fxUnsupported, voiceFx } from '@/lib/audioDsp';
import type { AudioClip, Project, TrackType } from '@/types/project';
import { AUDIO_TRACKS } from '@/lib/audioTracks';

import { crossfades, edgeFades } from './fades';
import type { OfflineMixClip, OfflineMixPlan, OfflineUnsupported } from './model';
import { pipAudioClips, videoAudioClips } from './visualAudio';

/** a sáv nem nulla küldései egy létező buszra (vagy undefined) */
function sendsOf(project: Project, type: TrackType): Record<string, number> | undefined {
  const ids = new Set((project.audioBuses ?? []).map((b) => b.id));
  const sends = Object.fromEntries(Object.entries(project.audioSends?.[type] ?? {}).filter(([id, v]) => ids.has(id) && v > 0));
  return Object.keys(sends).length > 0 ? sends : undefined;
}

/** a klip hangmagasság-eltolása félhangban, a szerverrel azonosan ±12-re szorítva */
function pitchOf(semitones: number | undefined): number {
  return Math.max(-12, Math.min(12, Math.round(semitones ?? 0)));
}

/** A keverés terve a (`mixForExport` utáni) projektből. */
export function offlineMixPlan(project: Project): OfflineMixPlan {
  const clips: OfflineMixClip[] = [];
  const unsupported = new Set<OfflineUnsupported>();
  for (const track of project.tracks) {
    if (!AUDIO_TRACKS.includes(track.type)) {
      continue;
    }
    const gain = project.trackMix?.[track.type]?.gain ?? 1;
    const audio = track.clips.filter((c): c is AudioClip => c.kind === 'audio');
    const fades = edgeFades(audio);
    const xf = crossfades(audio);
    for (const clip of audio) {
      // 🎛️ a közös DSP-ben már megvalósított effektek szólnak; a többi még csak a szerveren
      if (fxUnsupported(clip.audioFx)) unsupported.add('effects');
      // 🦆 a szerver `isDuckTrigger` tükre: a beszéd-sáv (vagy a master kijelölt sávja) a kulcs
      // (a szerver régi `audio` sávja a kliens típusaiban már nincs)
      const trigger = project.audioMaster?.duckTrigger;
      const isKey = trigger ? track.type === trigger : track.type === 'voiceover';
      const role: OfflineMixClip['role'] = isKey ? 'key' : clip.autoDuck ? 'duck' : undefined;
      // 🎙️ hangjavítás / visszhang-csökkentés: a közös DSP elemeiből (`voiceFx`)
      const fx = voiceFx(clip.audioFx, !!clip.voiceEnhance, !!clip.deReverb);
      // 🎛️ effekt-automáció: csak a nem üres görbék
      const fxKf = Object.fromEntries(FX_AUTO_KEYS.filter((k) => (clip.keyframes?.[k]?.length ?? 0) > 0).map((k) => [k, clip.keyframes![k]])) as FxAutomation;
      const hasAuto = Object.keys(fxKf).length > 0;
      const main: OfflineMixClip = {
        id: clip.id,
        ...(clip.sourceDuration ? { sourceDuration: clip.sourceDuration } : {}),
        ...(fxActive(fx) || clip.deReverb || hasAuto ? { fx: fx ?? {} } : {}),
        ...(hasAuto ? { fxKf } : {}),
        ...(sendsOf(project, track.type) ? { sends: sendsOf(project, track.type) } : {}),
        ...(clip.loopLength && clip.loopLength > 0 ? { loopLength: clip.loopLength, ...(clip.loopOffset ? { loopOffset: clip.loopOffset } : {}) } : {}),
        ...(clip.deReverb ? { deReverb: true } : {}),
        ...(role ? { role } : {}),
        track: track.type,
        uri: clip.uri,
        start: clip.start,
        duration: clip.duration,
        trimIn: clip.trimIn ?? 0,
        volume: clip.volume,
        volumeKf: clip.keyframes?.volume,
        // ✖️ az átfedő szomszéd crossfade-je a nagyobb (a felhasználói fade-nél rövidebb nem vág)
        fadeIn: Math.max(fades.get(clip.id)?.in ?? 0, xf.get(clip.id)?.in ?? 0),
        fadeOut: Math.max(fades.get(clip.id)?.out ?? 0, xf.get(clip.id)?.out ?? 0),
        pan: clip.pan ?? 0,
        panKf: clip.keyframes?.pan,
        gain,
        speed: audioSpeedOf(clip),
        reversed: !!clip.reversed,
        pitch: pitchOf(clip.audioFx?.pitchSemitones),
        ...(clip.audioFx?.formant ? { formant: true } : {}),
      };
      clips.push(main);
      // 🎵 harmónia (a szerver tükre): a klip MELLÉ egy eltolt, 0,7-szeres másodhang, a felhasználói
      // fade-ekkel; a teljes eltolás (klip + harmónia) ±12 félhangra szorítva
      const harm = Math.round(clip.audioFx?.harmony ?? 0);
      if (harm !== 0) {
        clips.push({
          ...main,
          id: `${clip.id}#harmonia`,
          pitch: pitchOf(Math.round(clip.audioFx?.pitchSemitones ?? 0) + harm),
          volume: main.volume * 0.7,
          volumeKf: main.volumeKf?.map((k) => ({ ...k, value: k.value * 0.7 })),
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
        });
      }
    }
  }
  clips.push(...videoAudioClips(project, unsupported));
  clips.push(...pipAudioClips(project));
  const ducking = clips.some((c) => c.role === 'duck') && clips.some((c) => c.role === 'key');
  // 🎚️ V9: csak a valódi csoportok (a forrás és a cél is szól, nem önmaga)
  const sidechains = AUDIO_TRACKS.flatMap((ty) => {
    const sc = project.trackMix?.[ty]?.sidechain;
    if (!sc || sc.from === ty) return [];
    const has = (t: string) => clips.some((c) => c.track === t);
    return has(ty) && has(sc.from) ? [{ target: ty as string, from: sc.from as string, ratio: Math.max(2, Math.min(20, sc.ratio)) }] : [];
  });
  return {
    ...(sidechains.length > 0 ? { sidechains } : {}),
    duration: projectDuration(project),
    clips,
    unsupported: [...unsupported],
    ...(ducking ? { ducking } : {}),
    ...(project.audioMaster ? { master: project.audioMaster } : {}),
    ...((project.audioBuses ?? []).length > 0 ? { buses: project.audioBuses } : {}),
  };
}
