/**
 * 🔀 C3 (AUDIO-PROD) — a hang-poszt remixe a SÁVOKAT kapja, ha az alkotó engedi (expo-mentes, tiszta mag).
 *
 * Döntés 2026-11-15: posztoláskor kapcsoló („A remix a sávokat kapja”), alapból KI — a nyers sávok értékesek.
 * Bekapcsolva a hang-sávok forrásfájljai feltöltődnek (az alkotó kvótáját terhelik), és a poszt
 * `project_snapshot`-ja egy sáv-leírást (`RemixTracksManifest`) hordoz: a hang-sávok klipjei a feltöltött
 * fájlok címével, a hangszer-minták, a keverés és a tempó. A remix ebből szerkeszthető hang-projekt.
 *
 * A manifest a poszt minden nézője számára olvasható (az RLS a posztot követi) → csak a hang-sávok kerülnek
 * bele, más projekt-adat (videó, kép, szöveg, interaktív, mappa, szinkron-beállítás) nem; a vevő oldalon a
 * `parseRemixManifest` mindent ellenőriz (idegen adat).
 */
import type { AudioClip, InstrumentDoc, Project, Track, TrackType } from '@/types/project';

export const REMIX_AUDIO_TRACKS: readonly TrackType[] = ['music', 'voiceover', 'sfx', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5'];
export const REMIX_MAX_CLIPS = 200;

export interface RemixTracksManifest {
  v: 1;
  bpm?: number;
  timeSignature?: Project['timeSignature'];
  tempoMap?: Project['tempoMap'];
  tracks: Track[];
  instrumentDocs?: InstrumentDoc[];
  trackMix?: Project['trackMix'];
  audioMaster?: Project['audioMaster'];
  audioBuses?: Project['audioBuses'];
  audioSends?: Project['audioSends'];
}

const isLocal = (uri: string | undefined): uri is string => !!uri && !/^https?:\/\//i.test(uri);

/** a feltöltendő helyi fájlok: a hang-sávok klipjei + a sampler-minták (egyszer) */
export function remixUploadUris(project: Project): string[] {
  const out = new Set<string>();
  for (const tr of project.tracks) {
    if (!REMIX_AUDIO_TRACKS.includes(tr.type)) continue;
    for (const c of tr.clips) if (c.kind === 'audio' && isLocal(c.uri)) out.add(c.uri);
  }
  for (const d of project.instrumentDocs ?? []) if (isLocal(d.sampler?.sampleUri)) out.add(d.sampler!.sampleUri);
  return [...out];
}

/**
 * A manifest a feltöltött címekkel (`remote`: helyi uri → https cím). A cím nélkül maradt klip kimarad (nem
 * kerülhet a posztba helyi útvonal); a csak távoli klip marad.
 */
export function buildRemixManifest(project: Project, remote: ReadonlyMap<string, string>): RemixTracksManifest {
  const url = (uri: string) => (isLocal(uri) ? remote.get(uri) : uri);
  const tracks: Track[] = project.tracks
    .filter((tr) => REMIX_AUDIO_TRACKS.includes(tr.type))
    .map((tr) => ({
      id: tr.id,
      type: tr.type,
      name: tr.name,
      clips: tr.clips.flatMap((c) => {
        if (c.kind !== 'audio') return [];
        const u = url(c.uri);
        // az asset-hivatkozás helyi — a remix saját assetet kap
        return u ? [{ ...c, uri: u, assetId: undefined } as AudioClip] : [];
      }),
    }));
  const instrumentDocs = (project.instrumentDocs ?? []).flatMap((d) => {
    if (!d.sampler) return [d];
    const u = url(d.sampler.sampleUri);
    return u ? [{ ...d, sampler: { ...d.sampler, sampleUri: u } }] : [];
  });
  return {
    v: 1,
    ...(project.bpm ? { bpm: project.bpm } : {}),
    ...(project.timeSignature ? { timeSignature: project.timeSignature } : {}),
    ...(project.tempoMap?.length ? { tempoMap: project.tempoMap } : {}),
    tracks,
    ...(instrumentDocs.length ? { instrumentDocs } : {}),
    ...(project.trackMix ? { trackMix: project.trackMix } : {}),
    ...(project.audioMaster ? { audioMaster: project.audioMaster } : {}),
    ...(project.audioBuses?.length ? { audioBuses: project.audioBuses } : {}),
    ...(project.audioSends ? { audioSends: project.audioSends } : {}),
  };
}

const httpsUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) && v.length < 2048;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanClip(raw: unknown): AudioClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'audio' || !httpsUrl(c.uri) || typeof c.id !== 'string') return null;
  for (const k of ['start', 'duration', 'trimIn', 'sourceDuration', 'volume', 'fadeIn', 'fadeOut'] as const) {
    if (!finite(c[k]) || (c[k] as number) < 0) return null;
  }
  if ((c.duration as number) <= 0 || (c.start as number) > 6 * 3600 || (c.volume as number) > 4) return null;
  // a helyi útvonalat hordozható mezők (asset, felvétel-eredet) eldobva
  const { assetId: _a, ...rest } = c;
  return { ...(rest as unknown as AudioClip), label: typeof c.label === 'string' ? c.label.slice(0, 120) : undefined } as AudioClip;
}

/** idegen (poszt) manifest → ellenőrzött; `null`, ha nem az, vagy nincs benne használható klip */
export function parseRemixManifest(raw: unknown): RemixTracksManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.v !== 1 || !Array.isArray(m.tracks)) return null;
  let budget = REMIX_MAX_CLIPS;
  const seen = new Set<TrackType>();
  const tracks: Track[] = [];
  for (const t of m.tracks) {
    if (!t || typeof t !== 'object') continue;
    const tr = t as Record<string, unknown>;
    const type = tr.type as TrackType;
    if (!REMIX_AUDIO_TRACKS.includes(type) || seen.has(type) || !Array.isArray(tr.clips)) continue;
    seen.add(type);
    const clips = tr.clips.slice(0, budget).map(cleanClip).filter((c): c is AudioClip => c !== null);
    budget -= clips.length;
    tracks.push({ id: typeof tr.id === 'string' ? tr.id : `trk_${type}`, type, name: typeof tr.name === 'string' ? tr.name.slice(0, 60) : type, clips });
  }
  if (!tracks.some((t) => t.clips.length > 0)) return null;
  const docs = Array.isArray(m.instrumentDocs)
    ? (m.instrumentDocs as unknown[]).filter((d): d is InstrumentDoc => {
        const x = d as InstrumentDoc | null;
        return !!x && typeof x.id === 'string' && ['synth', 'drums', 'sampler'].includes(x.kind) && (!x.sampler || httpsUrl(x.sampler.sampleUri));
      })
    : [];
  const bpm = finite(m.bpm) && m.bpm >= 20 && m.bpm <= 400 ? m.bpm : undefined;
  return {
    v: 1,
    ...(bpm ? { bpm } : {}),
    ...(m.timeSignature && typeof m.timeSignature === 'object' ? { timeSignature: m.timeSignature as Project['timeSignature'] } : {}),
    ...(Array.isArray(m.tempoMap) ? { tempoMap: m.tempoMap as Project['tempoMap'] } : {}),
    tracks,
    ...(docs.length ? { instrumentDocs: docs } : {}),
    ...(m.trackMix && typeof m.trackMix === 'object' ? { trackMix: m.trackMix as Project['trackMix'] } : {}),
    ...(m.audioMaster && typeof m.audioMaster === 'object' ? { audioMaster: m.audioMaster as Project['audioMaster'] } : {}),
    ...(Array.isArray(m.audioBuses) ? { audioBuses: m.audioBuses as Project['audioBuses'] } : {}),
    ...(m.audioSends && typeof m.audioSends === 'object' ? { audioSends: m.audioSends as Project['audioSends'] } : {}),
  };
}

/** a manifest távoli címei (a remix ezeket tölti le a projekt mappájába) */
export function manifestUris(m: RemixTracksManifest): string[] {
  const out = new Set<string>();
  for (const tr of m.tracks) for (const c of tr.clips) if (c.kind === 'audio') out.add(c.uri);
  for (const d of m.instrumentDocs ?? []) if (d.sampler) out.add(d.sampler.sampleUri);
  return [...out];
}

/**
 * A remix-projekt a sávokkal: a `base` (üres hang-projekt) sávjai a manifestéi, a klipek a letöltött helyi
 * fájlokra mutatnak (`local`: távoli → helyi; a hiányzó letöltésű klip kimarad).
 */
export function remixProjectFromManifest(base: Project, m: RemixTracksManifest, local: ReadonlyMap<string, string>, ids: (prefix: string) => string): Project {
  const assets: Project['assets'] = [];
  const assetOf = new Map<string, string>();
  const assetFor = (uri: string, name: string | undefined, duration: number) => {
    let id = assetOf.get(uri);
    if (!id) {
      id = ids('ast');
      assetOf.set(uri, id);
      assets.push({ id, kind: 'audio', uri, provider: 'local', name: name ?? 'remix', duration });
    }
    return id;
  };
  const byType = new Map(m.tracks.map((t) => [t.type, t]));
  const tracks: Track[] = [
    ...base.tracks.map((t) => {
      const src = byType.get(t.type);
      if (!src) return t;
      byType.delete(t.type);
      return { ...t, name: src.name || t.name, clips: remixClips(src.clips) };
    }),
    ...[...byType.values()].map((src) => ({ id: ids('trk'), type: src.type, name: src.name || src.type, clips: remixClips(src.clips) })),
  ];
  function remixClips(clips: Track['clips']): AudioClip[] {
    return clips.flatMap((c) => {
      if (c.kind !== 'audio') return [];
      const uri = local.get(c.uri);
      if (!uri) return [];
      return [{ ...c, id: ids('clip'), uri, assetId: assetFor(uri, c.label, c.sourceDuration ?? c.duration) }];
    });
  }
  const instrumentDocs = (m.instrumentDocs ?? []).flatMap((d) => {
    if (!d.sampler) return [d];
    const uri = local.get(d.sampler.sampleUri);
    return uri ? [{ ...d, sampler: { ...d.sampler, sampleUri: uri } }] : [];
  });
  return {
    ...base,
    ...(m.bpm ? { bpm: m.bpm } : {}),
    ...(m.timeSignature ? { timeSignature: m.timeSignature } : {}),
    ...(m.tempoMap ? { tempoMap: m.tempoMap } : {}),
    ...(m.trackMix ? { trackMix: m.trackMix } : {}),
    ...(m.audioMaster ? { audioMaster: m.audioMaster } : {}),
    ...(m.audioBuses ? { audioBuses: m.audioBuses } : {}),
    ...(m.audioSends ? { audioSends: m.audioSends } : {}),
    ...(instrumentDocs.length ? { instrumentDocs } : {}),
    tracks,
    assets: [...base.assets, ...assets],
  };
}
