import { makeId } from '@/lib/id';
import type { Clip, Project, TrackType } from '@/types/project';

/**
 * 🎁 Pre-compose (beágyazott kompozíció) TISZTA magja.
 *
 * A kijelölt klipeket EGY összetett videóklipbe zárja: a klipek a csoport
 * kezdetéhez igazítva, fajtánként saját sávra kerülnek a `comp` mezőbe, az
 * eredeti helyükön pedig egyetlen compound klip marad a videó-sávon.
 *
 * Csak az ÉRINTETT sávokat adja vissza (`REPLACE_TRACKS` patch-formában) a
 * létrejött compound klippel együtt; ha nincs mit becsomagolni, `null`.
 */

const round = (n: number) => Math.round(n * 1000) / 1000;

/** a beágyazott kompozíció legrövidebb értelmes hossza */
const MIN_SPAN = 0.1;

export type PreComposePlan = {
  tracks: { trackType: TrackType; clips: Clip[] }[];
  compound: Clip;
  /** hány klip került be a kompozícióba (a címkéhez) */
  count: number;
};

export function buildPreComposePlan(project: Project, clipIds: Iterable<string>): PreComposePlan | null {
  const ids = new Set(clipIds);
  if (ids.size < 1) {
    return null;
  }

  // a kijelölt klipek + sávjuk begyűjtése, a csoport idő-tartománya
  const picked: { type: TrackType; clip: Clip }[] = [];
  let minStart = Infinity;
  let maxEnd = 0;
  for (const tk of project.tracks) {
    for (const c of tk.clips) {
      if (ids.has(c.id)) {
        picked.push({ type: tk.type, clip: c });
        minStart = Math.min(minStart, c.start);
        maxEnd = Math.max(maxEnd, c.start + c.duration);
      }
    }
  }
  if (picked.length === 0 || !Number.isFinite(minStart)) {
    return null;
  }
  const span = Math.max(MIN_SPAN, round(maxEnd - minStart));

  // beágyazott kompozíció sávjai: a klipek 0-hoz igazítva, fajtánként csoportosítva
  const byType = new Map<TrackType, Clip[]>();
  for (const { type, clip } of picked) {
    const shifted = { ...clip, start: round(clip.start - minStart) } as Clip;
    byType.set(type, [...(byType.get(type) ?? []), shifted]);
  }
  const compTracks = [...byType].map(([type, clips]) => ({ id: makeId('trk'), type, name: type, clips }));

  // durva előnézeti uri: az első videó/kép klip forrása (a pontos előnézet renderelt proxy — follow-up)
  const media = picked.map((p) => p.clip).find((c) => c.kind === 'video' || c.kind === 'image');
  const compound = {
    kind: 'video',
    id: makeId('clip'),
    start: round(minStart),
    duration: span,
    uri: media && 'uri' in media ? (media as { uri: string }).uri : '',
    trimIn: 0,
    sourceDuration: span,
    speed: 1,
    volume: 1,
    filterId: 'none',
    comp: { aspectRatio: project.aspectRatio, assets: project.assets, duration: span, tracks: compTracks },
  } as Clip;

  // a kijelölt klipek eltávolítva minden érintett sávról; a compound a videó-sávra
  const affected = new Set<TrackType>(picked.map((p) => p.type));
  affected.add('video');
  const tracks = project.tracks
    .filter((tk) => affected.has(tk.type))
    .map((tk) => {
      let clips = tk.clips.filter((c) => !ids.has(c.id));
      if (tk.type === 'video') {
        clips = [...clips, compound];
      }
      return { trackType: tk.type, clips };
    });

  return { tracks, compound, count: picked.length };
}
