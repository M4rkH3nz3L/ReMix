import { buildRemixManifest, manifestUris, parseRemixManifest, remixProjectFromManifest, remixUploadUris, REMIX_MAX_CLIPS } from '@/lib/remixTracks';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const clip = (id: string, uri: string, extra: Partial<AudioClip> = {}): AudioClip => ({ kind: 'audio', id, uri, label: id, start: 0, duration: 4, trimIn: 0, sourceDuration: 8, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', assetId: `ast_${id}`, ...extra });

function source(): Project {
  const base = createEmptyProject('Dal', '9:16', undefined, 'audio');
  return {
    ...base,
    bpm: 96,
    trackMix: { music: { gain: -3 } },
    instrumentDocs: [
      { id: 'd1', kind: 'drums', bpm: 96, bars: 1, drums: { pattern: { kick: [true], snare: [], hihat: [], clap: [], tom: [], rim: [], crash: [], perc: [] } } },
      { id: 's1', kind: 'sampler', bpm: 96, bars: 1, sampler: { sampleUri: 'file:///p/sample.wav', pattern: [true] } },
    ],
    tracks: [
      ...base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip('a', 'file:///p/a.wav'), clip('b', 'file:///p/a.wav', { start: 4 })] } : t.type === 'voiceover' ? { ...t, clips: [clip('v', 'file:///p/v.wav'), clip('r', 'https://cdn.x/r.wav')] } : t)),
      { id: 'trk_v', type: 'video', name: 'Videó', clips: [] },
    ],
  };
}

describe('remixTracks — C3: a remix a sávokat kapja', () => {
  test('a feltöltendő fájlok: a hang-sávok helyi klipjei + a sampler-minta, egyszer', () => {
    expect(remixUploadUris(source()).sort()).toEqual(['file:///p/a.wav', 'file:///p/sample.wav', 'file:///p/v.wav']);
  });

  test('manifest: csak hang-sávok, távoli címek, asset-hivatkozás nélkül; a fel nem töltött klip kimarad', () => {
    const remote = new Map([['file:///p/a.wav', 'https://cdn.x/a.wav'], ['file:///p/sample.wav', 'https://cdn.x/s.wav']]);
    const m = buildRemixManifest(source(), remote);
    expect(m.tracks.map((t) => t.type)).not.toContain('video');
    const music = m.tracks.find((t) => t.type === 'music')!;
    expect(music.clips.map((c) => (c as AudioClip).uri)).toEqual(['https://cdn.x/a.wav', 'https://cdn.x/a.wav']);
    expect((music.clips[0] as AudioClip).assetId).toBeUndefined();
    // a v.wav nincs feltöltve → kimarad; a már távoli r.wav marad
    expect(m.tracks.find((t) => t.type === 'voiceover')!.clips.map((c) => c.id)).toEqual(['r']);
    expect(JSON.stringify(m)).not.toContain('file://');
    expect(m.bpm).toBe(96);
    expect(m.instrumentDocs?.find((d) => d.kind === 'sampler')?.sampler?.sampleUri).toBe('https://cdn.x/s.wav');
  });

  test('oda-vissza: JSON → ellenőrző → remix-projekt a letöltött helyi fájlokkal, új azonosítókkal', () => {
    const remote = new Map([['file:///p/a.wav', 'https://cdn.x/a.wav'], ['file:///p/v.wav', 'https://cdn.x/v.wav'], ['file:///p/sample.wav', 'https://cdn.x/s.wav']]);
    const m = parseRemixManifest(JSON.parse(JSON.stringify(buildRemixManifest(source(), remote))))!;
    expect(manifestUris(m).sort()).toEqual(['https://cdn.x/a.wav', 'https://cdn.x/r.wav', 'https://cdn.x/s.wav', 'https://cdn.x/v.wav']);
    const local = new Map(manifestUris(m).map((u) => [u, u.replace('https://cdn.x/', 'file:///remix/')]));
    let n = 0;
    const p = remixProjectFromManifest(createEmptyProject('Remix', '9:16', undefined, 'audio'), m, local, (pre) => `${pre}_${n++}`);
    const music = p.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
    expect(music.map((c) => c.uri)).toEqual(['file:///remix/a.wav', 'file:///remix/a.wav']);
    expect(music[0].id).not.toBe('a');
    // egy fájl → egy asset (a két klip közös)
    expect(music[0].assetId).toBe(music[1].assetId);
    expect(p.assets.filter((a) => a.uri === 'file:///remix/a.wav')).toHaveLength(1);
    expect(p.bpm).toBe(96);
    expect(p.trackMix?.music?.gain).toBe(-3);
    expect(p.instrumentDocs?.find((d) => d.kind === 'sampler')?.sampler?.sampleUri).toBe('file:///remix/s.wav');
  });

  test('idegen manifest: helyi / nem https cím, rossz számok, ismeretlen sáv eldobva; plafon', () => {
    expect(parseRemixManifest(null)).toBeNull();
    expect(parseRemixManifest({ v: 2, tracks: [] })).toBeNull();
    const evil = {
      v: 1,
      bpm: 9999,
      tracks: [
        { type: 'video', clips: [clip('x', 'https://cdn.x/x.wav')] },
        { type: 'music', clips: [clip('ok', 'https://cdn.x/ok.wav'), clip('loc', 'file:///etc/passwd'), clip('http', 'http://cdn.x/h.wav'), clip('neg', 'https://cdn.x/n.wav', { duration: -1 }), clip('big', 'https://cdn.x/b.wav', { volume: 99 })] },
        { type: 'music', clips: [clip('dup', 'https://cdn.x/d.wav')] },
      ],
      instrumentDocs: [{ id: 's', kind: 'sampler', bpm: 1, bars: 1, sampler: { sampleUri: 'file:///x', pattern: [] } }],
    };
    const m = parseRemixManifest(evil)!;
    expect(m.tracks.map((t) => t.type)).toEqual(['music']);
    expect(m.tracks[0].clips.map((c) => c.id)).toEqual(['ok']);
    expect((m.tracks[0].clips[0] as AudioClip).assetId).toBeUndefined();
    expect(m.bpm).toBeUndefined();
    expect(m.instrumentDocs).toBeUndefined();
    const many = { v: 1, tracks: [{ type: 'music', clips: Array.from({ length: 500 }, (_, i) => clip(`c${i}`, `https://cdn.x/${i}.wav`)) }] };
    expect(parseRemixManifest(many)!.tracks[0].clips).toHaveLength(REMIX_MAX_CLIPS);
  });
});
