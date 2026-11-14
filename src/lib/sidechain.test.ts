import { applyCommand } from '@/lib/commands';
import { mixRange, offlineMixPlan, OFFLINE_SAMPLE_RATE, type DecodedSource } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

/** 🎚️ V9: sávonkénti sidechain — a parancs, a terv és a telefonos keverés. */
const SR = OFFLINE_SAMPLE_RATE;
const clip = (id: string, uri: string, dur: number): AudioClip => ({ kind: 'audio', id, label: id, uri, start: 0, duration: dur, trimIn: 0, sourceDuration: dur, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
const base = createEmptyProject('sc', '9:16', undefined, 'audio');
const project: Project = {
  ...base,
  tracks: [...base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip('pad', 'pad', 4)] } : t)), { id: 'a1', type: 'aux1', name: 'Dob', clips: [clip('kick', 'kick', 4)] }],
};

describe('🎚️ V9 sidechain', () => {
  it('a parancs: be, arány-szorítás, önmaga alatt nem, a sávhangerő megtartja; ki', () => {
    const p1 = applyCommand(project, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'aux1', ratio: 40 } })!;
    expect(p1.trackMix?.music).toEqual({ gain: 1, sidechain: { from: 'aux1', ratio: 20 } });
    const p2 = applyCommand(p1, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 })!;
    expect(p2.trackMix?.music).toEqual({ gain: 0.5, sidechain: { from: 'aux1', ratio: 20 } });
    expect(applyCommand(p2, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'music', ratio: 8 } })!.trackMix?.music).toEqual({ gain: 0.5 });
    expect(applyCommand(p2, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'aux1', ratio: 20 } })).toBeNull();
  });

  it('a keverés: a pad a lábdob alatt halkul (−6 dB-nél jobban), a dobütések között visszajön; a dob maga változatlan', () => {
    const p = applyCommand(project, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'aux1', ratio: 10 } })!;
    const plan = offlineMixPlan(p);
    expect(plan.sidechains).toEqual([{ target: 'music', from: 'aux1', ratio: 10 }]);
    const n = 4 * SR;
    const pad = Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR));
    // lábdob: 0,1 s-os 60 Hz-es ütés minden másodperc elején
    const kick = Float32Array.from({ length: n }, (_, i) => (i % SR < 0.1 * SR ? 0.8 * Math.sin((2 * Math.PI * 60 * i) / SR) : 0));
    const sources = new Map<string, DecodedSource>([
      ['pad', { channels: [pad, pad], sampleRate: SR }],
      ['kick', { channels: [kick, kick], sampleRate: SR }],
    ]);
    const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    mixRange(plan, sources, out, 0, n);
    const rmsPad = (a: number, b: number) => {
      // a pad (220 Hz) szintje: a keverékből a dob (60 Hz) nélkül — a dob a 0,1 s-os ablakon kívül néma
      let e = 0;
      for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += out[0][i] ** 2;
      return 10 * Math.log10(e / ((b - a) * SR));
    };
    const during = rmsPad(1.12, 1.2); // közvetlenül az ütés után (a halkítás elengedése alatt)
    const between = rmsPad(1.7, 1.9);
    // a szerveres render ugyanerre: 25,0 dB (valódi ffmpeg, sidechaincompress)
    expect(between - during).toBeGreaterThan(6);
    // a dob nincs halkítva: az ütés csúcsa ≈ 0,8 + a pad (halkítva)
    let pk = 0;
    for (let i = SR; i < SR + 0.1 * SR; i++) pk = Math.max(pk, Math.abs(out[0][i]));
    expect(pk).toBeGreaterThan(0.75);
  });
});
