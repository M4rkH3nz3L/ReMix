import { autoThresholdDb, clipSilences, levelsDb, silenceCutCommands, silentRuns } from '@/lib/audioSilence';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const SR = 16000;
/** beszéd-szerű jel a megadott szakaszokon, köztük halk zaj (−60 dB) */
function speech(sec: number, on: [number, number][], amp = 0.3): Float32Array {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Float32Array.from({ length: sec * SR }, (_, i) => {
    const t = i / SR;
    const voiced = on.some(([a, b]) => t >= a && t < b);
    return voiced ? amp * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) : 0.001 * rnd();
  });
}

describe('🔇 szint és csend-szakaszok', () => {
  it('a csend a beszéd-szakaszok között, 10 ms pontossággal', () => {
    const lv = levelsDb(speech(6, [[0.5, 2], [3.2, 5]]), SR);
    const runs = silentRuns(lv, autoThresholdDb(lv), 0.6);
    expect(runs.map((r) => [r.start, r.end].map((x) => +x.toFixed(2)))).toEqual([[2, 3.2], [5, 6]]);
  });
  it('a küszöb a felvétel szintjéhez igazodik: a halk (−40 dB) beszéd sem csend', () => {
    const quiet = levelsDb(speech(4, [[0, 1.5], [2.5, 4]], 0.01), SR);
    expect(autoThresholdDb(quiet)).toBeLessThan(-50);
    expect(silentRuns(quiet, autoThresholdDb(quiet), 0.6).map((r) => +r.start.toFixed(2))).toEqual([1.5]);
    // fix −35 dB-es küszöbbel az egész felvétel „csend” lenne
    expect(silentRuns(quiet, -35, 0.6)).toEqual([{ start: 0, end: 4 }]);
  });
});

const frames = (r: { start: number; end: number }[]) => r.map((x) => [Math.round(x.start * 30), Math.round(x.end * 30)]);

describe('🔇 csendek a klip idejében', () => {
  const clip = { start: 10, duration: 6, trimIn: 1, speed: 1 } as AudioClip;
  it('forrás → idővonal; a beszéd felőli oldalon levegő, a klip szélén nem; frame-rácson', () => {
    // forrás-ablak 1…7; csendek: 1–1,8 (klip eleje), 3–4,5 (belső)
    const r = clipSilences(clip, 1, [{ start: 0, end: 0.8 }, { start: 2, end: 3.5 }], 30);
    // 10,8 − 0,12 = 10,68 → 320. frame; 12 + 0,12 → 364.; 13,5 − 0,12 → 401.
    expect(frames(r)).toEqual([[300, 320], [364, 401]]);
  });
  it('a túl rövid csend marad; sebesség és visszafelé', () => {
    expect(clipSilences(clip, 1, [{ start: 2, end: 2.5 }], 30)).toEqual([]);
    const fast = { ...clip, speed: 2 } as AudioClip; // forrás-ablak 1…13
    expect(frames(clipSilences(fast, 1, [{ start: 4, end: 8 }], 30))).toEqual([[364, 416]]); // 12–14 s, levegővel
    const rev = { ...clip, reversed: true } as AudioClip; // a forrás 7-es pontja szól a klip elején
    expect(frames(clipSilences(rev, 1, [{ start: 5, end: 6 }], 30))).toEqual([[300, 326]]); // a forrás 6–7-e szól 10–11 s között → 10–10,88
  });
  it('loop-klipre nincs csendvágás', () => {
    expect(clipSilences({ ...clip, loopLength: 1 } as AudioClip, 1, [{ start: 2, end: 4 }], 30)).toEqual([]);
  });
});

describe('🔇 kivágás (ripple, egy undo)', () => {
  const a = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: 'file:///v.wav', ...over }) as AudioClip;
  const base = createEmptyProject('s', '9:16', undefined, 'audio');
  const project: Project = {
    ...base,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [a({ id: 'v', start: 0, duration: 10, sourceDuration: 10 }), a({ id: 'v2', start: 11, duration: 2, sourceDuration: 2, uri: 'file:///b.wav' })] }
        : t.type === 'music'
          ? { ...t, clips: [a({ id: 'm', start: 0, duration: 14, sourceDuration: 14, uri: 'file:///m.wav' })] }
          : t.type === 'sfx'
            ? { ...t, clips: [a({ id: 's', start: 8, duration: 1, sourceDuration: 1, uri: 'file:///s.wav' })] }
            : t
    ),
  };
  const ranges = [{ start: 2, end: 3 }, { start: 5, end: 6.5 }];
  const get = (cmds: ReturnType<typeof silenceCutCommands>, type: string) => cmds.find((c) => c.type === 'REPLACE_TRACK_CLIPS' && c.trackType === type) as { clips: AudioClip[] } | undefined;

  it('csak ez a sáv: a beszéd darabjai összezárnak, a mögötte lévő klip is jön, a többi sáv érintetlen', () => {
    const cmds = silenceCutCommands(project, 'voiceover', ranges, 'track');
    expect(cmds.map((c) => (c as { trackType: string }).trackType)).toEqual(['voiceover']);
    const v = get(cmds, 'voiceover')!.clips;
    expect(v.map((c) => [c.start, c.duration, c.trimIn])).toEqual([[0, 2, 0], [2, 2, 3], [4, 3.5, 6.5], [8.5, 2, 0]]);
  });
  it('minden sáv: az effekt is tolódik, a zene folyamatos (nem vágva)', () => {
    const cmds = silenceCutCommands(project, 'voiceover', ranges, 'all');
    expect(get(cmds, 'sfx')!.clips.map((c) => c.start)).toEqual([5.5]);
    expect(get(cmds, 'music')).toBeUndefined();
  });
  it('frame-határú vágásnál a jobb darab forrás-eltolása pontosan a kivágott idő (nincs fázisugrás)', () => {
    const cmds = silenceCutCommands(project, 'voiceover', [{ start: 49 / 30, end: 86 / 30 }], 'track');
    const right = get(cmds, 'voiceover')!.clips[1];
    // ms-os kerekítésnél ez 0,67 ms-ot csúszott (a hangban hallható)
    expect(Math.abs((right.trimIn ?? 0) - right.start - 37 / 30)).toBeLessThan(2e-6);
  });
  it('zárolt sáv érintetlen', () => {
    const cmds = silenceCutCommands(project, 'voiceover', ranges, 'all', ['sfx']);
    expect(get(cmds, 'sfx')).toBeUndefined();
  });
});
