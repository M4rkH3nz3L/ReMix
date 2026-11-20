import { voiceFx } from '@/lib/audioDsp';
import type { Clip, Project, TrackType, VideoClip } from '@/types/project';

import type { OfflineMixClip, OfflineUnsupported } from './model';

/**
 * 🎬 A videóklipek hangja (PRO-AUDIO 17/20) — a szerver `visualSegments` + videó-hang
 * láncának tükre: a vizuális sáv nem átfedő szakaszokra bomlik (átfedésnél a később kezdődő
 * klip nyer, a képklip is takar), a klip hangja csak a látható szakaszán szól, a hangerő-
 * automáció a klip saját idejében fut, fade és sáv-erősítés nincs. ⏩⏪ A gyorsított vagy
 * visszafelé játszott klip szakasza `speed`/`reversed`-del jön: a kliens előbb kivágja,
 * megfordítja és hangmagasság-tartással nyújtja (`stretchJobs`), mint a szerver areverse/atempo-ja.
 */
export function videoAudioClips(project: Project, _unsupported: Set<OfflineUnsupported>): OfflineMixClip[] {
  const visual = (project.tracks.find((t) => t.type === 'video')?.clips ?? [])
    .slice()
    .sort((a, b) => a.start - b.start || a.start + a.duration - (b.start + b.duration));
  const out: OfflineMixClip[] = [];
  let cursor = 0;
  for (let i = 0; i < visual.length; i++) {
    const clip: Clip = visual[i];
    const next = visual[i + 1];
    const visStart = Math.max(clip.start, cursor);
    const visEnd = Math.min(clip.start + clip.duration, next ? next.start : Infinity);
    if (visEnd <= visStart) {
      continue;
    }
    cursor = visEnd;
    if (clip.kind !== 'video') {
      continue;
    }
    const v = clip as VideoClip;
    const kf = v.keyframes?.volume;
    if (!(v.volume > 0 || (kf ?? []).some((k) => k.value > 0))) {
      continue;
    }
    const vfx = voiceFx(undefined, !!v.voiceEnhance, !!v.deReverb);
    const skip = visStart - v.start;
    const duration = visEnd - visStart;
    const speed = v.speed > 0 ? v.speed : 1;
    out.push({
      id: `${v.id}@${visStart}`,
      sourceDuration: v.sourceDuration,
      track: 'video',
      uri: v.uri,
      start: visStart,
      duration,
      // a szerver `segSourceWindow`-jának tükre: visszafelé a forrás-ablak a klip végéről indul
      trimIn: v.reversed ? v.trimIn + (v.duration - skip - duration) * speed : v.trimIn + skip * speed,
      volume: v.volume,
      // a szakasz a klip közepén is kezdődhet: a görbe a klip saját idejében fut
      volumeKf: kf?.map((k) => ({ ...k, time: k.time - skip })),
      fadeIn: 0,
      fadeOut: 0,
      pan: 0,
      gain: 1,
      speed,
      reversed: !!v.reversed,
      pitch: 0,
      ...(vfx ? { fx: vfx } : {}),
      ...(v.deReverb ? { deReverb: true } : {}),
    });
  }
  return out;
}

/**
 * 🖼️ A PiP-videók hangja (a szerver `pipAudio`-jának tükre): a klip teljes ideje alatt, a
 * forrás-ablakával, sebességével (hangmagasság-tartással) és irányával, statikus hangerővel,
 * fade és sáv-erősítés nélkül.
 */
export function pipAudioClips(project: Project): OfflineMixClip[] {
  const pip = project.tracks.find((t) => t.type === 'pip');
  return (pip?.clips ?? [])
    .filter((c): c is VideoClip => c.kind === 'video' && ((c as VideoClip).volume ?? 1) > 0)
    .map((v) => ({
      id: `pip:${v.id}`,
      sourceDuration: v.sourceDuration,
      track: 'pip' as TrackType,
      uri: v.uri,
      start: v.start,
      duration: v.duration,
      trimIn: v.trimIn ?? 0,
      volume: v.volume ?? 1,
      fadeIn: 0,
      fadeOut: 0,
      pan: 0,
      gain: 1,
      speed: v.speed > 0 ? v.speed : 1,
      reversed: !!v.reversed,
      pitch: 0,
    }));
}
