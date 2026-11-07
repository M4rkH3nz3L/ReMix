import { formatTime } from '@/lib/time';
import { MixAnalyzer, signalIssues, sortIssues, structuralIssues, type MixStats } from '@/lib/audioCheck';
import { integratedLoudness } from '@/lib/loudness';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip } from '@/types/project';

const SR = 44100;
/** jel egyenetlen darabokban (a darabolás nem hagyhat nyomot) */
function analyze(l: Float32Array, r: Float32Array): MixStats {
  const a = new MixAnalyzer(SR);
  const sizes = [1000, 4410, 777, 11025, 3];
  for (let i = 0, k = 0; i < l.length; k++) {
    const n = Math.min(l.length - i, sizes[k % sizes.length]);
    a.push(l.subarray(i, i + n), r.subarray(i, i + n));
    i += n;
  }
  return a.finish();
}
const tone = (sec: number, amp: (t: number) => number, f = 440) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp(i / SR) * Math.sin((2 * Math.PI * f * i) / SR));

describe('🩺 MixAnalyzer', () => {
  it('a hangosság = az integratedLoudness (BS.1770), darabolva is', () => {
    const l = tone(6, (t) => (t < 2 ? 0.1 : 0.4), 330);
    const r = tone(6, (t) => (t < 3 ? 0.2 : 0.05), 550);
    const s = analyze(l, r);
    expect(s.lufs).toBeCloseTo(integratedLoudness(l, r, SR), 6);
    expect(s.duration).toBeCloseTo(6, 6);
  });
  it('túlvezérlés: csak a plafonon lévő szakasz (2,0–2,5 s)', () => {
    const x = tone(5, (t) => (t >= 2 && t < 2.5 ? 1.3 : 0.5));
    const s = analyze(x, x);
    expect(s.clipping).toHaveLength(1);
    expect(s.clipping[0].start).toBeCloseTo(2, 1);
    expect(s.clipping[0].end).toBeCloseTo(2.5, 1);
  });
  it('csend: a 3 s-os szünet igen, az 1,5 s-os nem', () => {
    const x = tone(10, (t) => ((t >= 2 && t < 5) || (t >= 7 && t < 8.5) ? 0 : 0.3));
    const s = analyze(x, x);
    expect(s.silence).toEqual([{ start: 2, end: 5 }]);
  });
  it('fázis-kioltás: ahol a jobb csatorna a bal ellentéte (3–5 s)', () => {
    const l = tone(7, () => 0.3);
    const r = l.map((v, i) => (i >= 3 * SR && i < 5 * SR ? -v : v));
    const s = analyze(l, r);
    expect(s.phase).toEqual([{ start: 3, end: 5 }]);
  });
  it('rendben lévő keverésre nincs jel-hiba', () => {
    const x = tone(8, () => 0.25);
    const s = analyze(x, x);
    expect(signalIssues(s, s.lufs)).toEqual([]);
  });
});

describe('🩺 hibák', () => {
  it('hangosság: a céltól 2 LU-nál messzebb → figyelmeztetés iránnyal', () => {
    const base: MixStats = { duration: 10, peak: 0.5, lufs: -23.4, clipping: [], silence: [], phase: [] };
    expect(signalIssues(base, -16)).toEqual([{ kind: 'loudness', severity: 'warn', params: { lufs: -23.4, target: -16, dir: 'quiet' } }]);
    expect(signalIssues({ ...base, lufs: -17.5 }, -16)).toEqual([]);
  });
  it('szerkezeti: hiányzó fájl, némított és szóló, néma klip, vágási maradék', () => {
    const p = createEmptyProject('x', '9:16', undefined, 'audio');
    const c = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'a', uri: 'file:///a.wav', label: 'a', start: 0, duration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;
    const project = {
      tracks: p.tracks.map((t) =>
        t.type === 'music' ? { ...t, clips: [c({ id: 'm', uri: 'file:///gone.wav' }), c({ id: 's', start: 3, duration: 0.04 })] } : t.type === 'sfx' ? { ...t, clips: [c({ id: 'z', volume: 0, start: 5 })] } : t
      ),
    };
    const audio = (t: string) => ['music', 'voiceover', 'sfx'].includes(t);
    const issues = sortIssues(structuralIssues(project, { missing: new Set(['file:///gone.wav']), muted: ['sfx'], solo: [], audio }));
    expect(issues.map((i) => `${i.kind}@${i.start ?? '-'}`)).toEqual(['missing@0', 'muted@-', 'sliver@3', 'zeroVolume@5']);
    // szóló mellett a többi sáv „kimarad”
    const solo = structuralIssues(project, { missing: new Set(), muted: [], solo: ['music'], audio });
    expect(solo.filter((i) => i.kind === 'solo').map((i) => i.params?.track)).toEqual(['sfx']);
  });
});

describe('⏱️ formatTime', () => {
  it('a lebegőpontos maradék nem viszi el a tizedet (10,2 s → 0:10.2, 4,0 → 0:04.0)', () => {
    expect(formatTime(10.2)).toBe('0:10.2');
    expect(formatTime(3.9999999)).toBe('0:04.0');
    expect(formatTime(0.29)).toBe('0:00.2');
    expect(formatTime(125.75)).toBe('2:05.7');
  });
});
