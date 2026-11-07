import { applyCommand } from '@/lib/commands';
import { mixForExport } from '@/lib/audioExportMix';
import { mixRange, offlineMixPlan, type DecodedSource } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project, TrackType } from '@/types/project';

const SR = 44100;
const base = createEmptyProject('busz', '1:1', undefined, 'audio');
const clip = (over: Partial<AudioClip>): AudioClip =>
  ({ kind: 'audio', id: 'c', uri: 'file:///imp.wav', label: 'c', start: 0, duration: 1, trimIn: 0, sourceDuration: 1, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;

describe('🎚️ sávok és buszok — parancsok', () => {
  it('sáv hozzáadása, átnevezése, törlése (csak üresen)', () => {
    let p = applyCommand(base, { type: 'ADD_TRACK', track: { id: 't4', type: 'aux1', name: 'Sáv 4', clips: [] } })!;
    expect(p.tracks.some((t) => t.type === 'aux1')).toBe(true);
    expect(applyCommand(p, { type: 'ADD_TRACK', track: { id: 'x', type: 'aux1', name: 'dupla', clips: [] } })).toBeNull();
    p = applyCommand(p, { type: 'RENAME_TRACK', trackType: 'aux1', name: 'Gitár' })!;
    expect(p.tracks.find((t) => t.type === 'aux1')?.name).toBe('Gitár');
    const withClip = applyCommand(p, { type: 'ADD_CLIP', trackType: 'aux1', clip: clip({}) })!;
    expect(applyCommand(withClip, { type: 'REMOVE_TRACK', trackType: 'aux1' })).toBeNull();
    expect(applyCommand(p, { type: 'REMOVE_TRACK', trackType: 'aux1' })?.tracks.some((t) => t.type === 'aux1')).toBe(false);
    // az alap sáv nem törölhető
    expect(applyCommand(base, { type: 'REMOVE_TRACK', trackType: 'music' })).toBeNull();
  });
  it('buszok és küldések; a törölt busz küldései is eltűnnek', () => {
    let p = applyCommand(base, { type: 'SET_AUDIO_BUSES', buses: [{ id: 'b1', name: 'Zengés', fx: { reverb: 0.5 }, gain: 1 }] })!;
    p = applyCommand(p, { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'b1', amount: 0.4 })!;
    expect(p.audioSends?.music?.b1).toBe(0.4);
    expect(applyCommand(p, { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'nincs', amount: 0.4 })).toBeNull();
    p = applyCommand(p, { type: 'SET_AUDIO_BUSES', buses: [] })!;
    expect(p.audioSends?.music?.b1).toBeUndefined();
  });
});

describe('🎚️ sávok és buszok — keverés', () => {
  const impulse = new Float32Array(SR);
  impulse[2000] = 1; // a klip eleji 10 ms-os mikro-fade után
  const sources = new Map<string, DecodedSource>([['file:///imp.wav', { channels: [impulse], sampleRate: SR }]]);
  const withTrack = (type: TrackType, extra: Partial<Project> = {}): Project => {
    const p = applyCommand(base, { type: 'ADD_TRACK', track: { id: 't', type, name: 'Sáv 4', clips: [clip({})] } })!;
    return { ...p, ...extra };
  };
  const render = (p: Project, chunk = SR) => {
    const plan = offlineMixPlan(p);
    const out: [Float32Array, Float32Array] = [new Float32Array(SR), new Float32Array(SR)];
    const st = new Map();
    for (let a = 0; a < SR; a += chunk) {
      const b = Math.min(SR, a + chunk);
      mixRange(plan, sources, [out[0].subarray(a, b), out[1].subarray(a, b)], a, b, 1, st);
    }
    return out[0];
  };

  it('az új sáv (Sáv 4) klipje szól, a némítás hat rá', () => {
    const p = withTrack('aux1');
    expect(render(p)[2000]).toBeCloseTo(1, 5);
    const muted = mixForExport(p, (t) => t !== 'aux1', 1);
    expect(muted === null || render(muted)[2000] === 0).toBe(true);
  });

  it('a zengés-buszra küldött impulzus: visszaverődések a 40 / 75 ms-nál, a küldés és a busz-szint szerint', () => {
    const buses = [{ id: 'b1', name: 'Zengés', fx: { reverb: 0.5 }, gain: 1 }];
    const p = withTrack('aux1', { audioBuses: buses, audioSends: { aux1: { b1: 0.5 } } });
    const y = render(p);
    // reverb 0,5 → csillapítás 0,55 / (0,55·0,7).toFixed(2) = 0,39 (a szerver képlete); in 0,8 · out 0,9; a küldés 0,5
    expect(y[2000]).toBeCloseTo(1 + 0.5 * 0.72, 4);
    expect(y[2000 + Math.round(0.04 * SR)]).toBeCloseTo(0.5 * 0.9 * 0.55, 4);
    expect(y[2000 + Math.round(0.075 * SR)]).toBeCloseTo(0.5 * 0.9 * 0.39, 4);
    // küldés nélkül / némított busszal nincs visszaverődés
    expect(render(withTrack('aux1', { audioBuses: buses }))[2000 + Math.round(0.04 * SR)]).toBe(0);
    expect(render(withTrack('aux1', { audioBuses: [{ ...buses[0], gain: 0 }], audioSends: { aux1: { b1: 0.5 } } }))[2000 + Math.round(0.04 * SR)]).toBe(0);
    // szeletelés-független
    const z = render(p, 5512);
    let maxDiff = 0;
    for (let i = 0; i < SR; i++) maxDiff = Math.max(maxDiff, Math.abs(y[i] - z[i]));
    expect(maxDiff).toBeLessThan(1e-6);
  });
});
