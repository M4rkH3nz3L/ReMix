import { isAudioTrack } from '@/lib/audioTracks';
import type { AudioClip, Project, TrackType } from '@/types/project';
import { norm } from '@/lib/intent/audio/text';
import type { AudioIntentContext } from '@/lib/intent/audio/types';

/** 🎚️ A célpont feloldása: a megnevezett sávok és a célklipek (különben a kijelölt klip). */

const AUDIO_TRACK_WORDS: [RegExp, TrackType][] = [
  [/\b(zene\w*|music|musik\w*|alap\w*|dal\w*|song)\b/, 'music'],
  [/\b(besz\w*|narr\w*|voice\w*|vo|hangalam\w*|alamond\w*|szoveg\w*|speech|dialog\w*|stimme\w*|sprach\w*|sprecher\w*)\b/, 'voiceover'],
  [/\b(effekt\w*|sfx|hanghatas\w*|zorej\w*|effects?)\b/, 'sfx'],
];
const EXTRA: TrackType[] = ['aux1', 'aux2', 'aux3', 'aux4', 'aux5'];

/** a tagmondatban megnevezett sávok (csak a projektben létező, hangos sávok) */
export function tracksIn(t: string, ctx: AudioIntentContext): TrackType[] {
  const exists = (type: TrackType) => ctx.project.tracks.some((tr) => tr.type === type);
  if (/\b(minden sav\w*|osszes sav\w*|mindent|all tracks|everything|every track)\b/.test(t)) {
    return ctx.project.tracks.filter((tr) => isAudioTrack(tr.type) && tr.clips.length > 0).map((tr) => tr.type);
  }
  const out = new Set<TrackType>();
  for (const [type, name] of Object.entries(ctx.trackNames) as [TrackType, string][]) {
    const n = norm(name ?? '');
    if (n.length > 2 && exists(type) && t.includes(n)) out.add(type);
  }
  for (const [re, type] of AUDIO_TRACK_WORDS) if (re.test(t) && exists(type)) out.add(type);
  const nth = t.match(/\b(\d)\.? ?sav\w*|\bsav\w* ?(\d)\b|\btrack ?(\d)\b/);
  if (nth) {
    const n = Number(nth[1] ?? nth[2] ?? nth[3]);
    const type = n >= 4 ? EXTRA[n - 4] : (['music', 'voiceover', 'sfx'] as TrackType[])[n - 1];
    if (type && exists(type)) out.add(type);
  }
  return out.size > 0 ? [...out] : (ctx.inherited ?? []);
}

/** csak a tagmondatban megnevezett sávok (öröklés nélkül) */
export const ownTracks = (t: string, ctx: AudioIntentContext) => tracksIn(t, { ...ctx, inherited: [] });

export const audioClipsOn = (project: Project, types: TrackType[]): AudioClip[] =>
  project.tracks.filter((t) => types.includes(t.type)).flatMap((t) => t.clips.filter((c): c is AudioClip => c.kind === 'audio'));

export const selectedClip = (ctx: AudioIntentContext): AudioClip | null => {
  for (const t of ctx.project.tracks) {
    const c = t.clips.find((x) => x.id === ctx.selectedClipId);
    if (c && c.kind === 'audio') return c;
  }
  return null;
};

/** a célklipek: a megnevezett sávok klipjei, különben a kijelölt klip */
export function targetClips(t: string, ctx: AudioIntentContext): AudioClip[] {
  const tracks = tracksIn(t, ctx);
  if (tracks.length > 0) return audioClipsOn(ctx.project, tracks);
  const sel = selectedClip(ctx);
  return sel ? [sel] : [];
}
