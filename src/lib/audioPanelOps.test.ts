import {
  beatSourceClip,
  clipFxOf,
  dubCaptions,
  dubText,
  formatEqDb,
  panLabel,
  round1,
  stepEqBand,
  stepFade,
  stepHighpass,
  stepLowpass,
  stepPan,
  stepWet,
} from '@/lib/audioPanelOps';
import type { AudioClip, Project, TextClip } from '@/types/project';

const t = ((k: string) => k) as never;

const audio = (id: string, start: number, extra: Partial<AudioClip> = {}) =>
  ({ kind: 'audio', id, start, duration: 4, uri: `file:///${id}.mp3`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...extra }) as AudioClip;
const text = (id: string, start: number, body: string) => ({ kind: 'text', id, start, duration: 1, text: body }) as TextClip;
const tracks = (list: { type: string; clips: unknown[] }[]) => ({ tracks: list.map((x, i) => ({ id: `t${i}`, ...x })) }) as unknown as Pick<Project, 'tracks'>;

describe('audioPanelOps — keverő-léptetők', () => {
  it('a pásztázás 0,2-es lépésben, tizedre kerekítve, -1…1 közé szorítva lép', () => {
    expect(stepPan(undefined, 1)).toBe(0.2);
    expect(stepPan(undefined, -1)).toBe(-0.2);
    expect(stepPan(0.1, 1)).toBe(0.3);
    expect(stepPan(0.96, 1)).toBe(1);
    expect(stepPan(-0.96, -1)).toBe(-1);
    expect(stepPan(0.05, -1)).toBe(-0.2);
  });

  it('a pásztázás felirata 5 % alatt „közép", különben oldal + kerekített százalék', () => {
    expect(panLabel(0.04, t)).toBe('panels.audio.panCenter');
    expect(panLabel(-0.049, t)).toBe('panels.audio.panCenter');
    expect(panLabel(0.05, t)).toBe('panels.audio.panR 5%');
    expect(panLabel(-0.4, t)).toBe('panels.audio.panL 40%');
    expect(panLabel(1, t)).toBe('panels.audio.panR 100%');
  });

  it('a fade 0,5 s-es lépésben, legfeljebb a klip feléig (max 5 s), nem negatív', () => {
    expect(stepFade(1, 20, 1)).toBe(1.5);
    expect(stepFade(4.8, 20, 1)).toBe(5);
    expect(stepFade(1.4, 3, 1)).toBe(1.5);
    expect(stepFade(0.3, 3, -1)).toBe(0);
    expect(stepFade(1.4, 3, -1)).toBeCloseTo(0.9, 12);
    expect(stepFade(0.3, 0.6, 1)).toBe(0.3);
  });

  it('a tizedre kerekítés a lebegőpontos maradékot eltünteti', () => {
    expect(round1(0.30000000000000004)).toBe(0.3);
    expect(round1(-0.25)).toBe(-0.2);
  });
});

describe('audioPanelOps — audio-FX léptetők', () => {
  it('felüláteresztő: ki → 60 Hz → +20 Hz-enként 300-ig; lefelé 60-nál kikapcsol', () => {
    expect(stepHighpass(undefined, 1)).toBe(60);
    expect(stepHighpass(0, 1)).toBe(60);
    expect(stepHighpass(80, 1)).toBe(100);
    expect(stepHighpass(290, 1)).toBe(300);
    expect(stepHighpass(40, 1)).toBe(60);
    expect(stepHighpass(80, -1)).toBe(60);
    expect(stepHighpass(60, -1)).toBe(0);
    expect(stepHighpass(undefined, -1)).toBe(0);
  });

  it('aluláteresztő: ki → lefelé 16 kHz, 2 kHz-es lépés 2 kHz-ig; felfelé 16 kHz-től kikapcsol', () => {
    expect(stepLowpass(undefined, -1)).toBe(16000);
    expect(stepLowpass(8000, -1)).toBe(6000);
    expect(stepLowpass(2000, -1)).toBe(2000);
    expect(stepLowpass(3000, -1)).toBe(2000);
    expect(stepLowpass(8000, 1)).toBe(10000);
    expect(stepLowpass(16000, 1)).toBe(0);
    expect(stepLowpass(18000, 1)).toBe(0);
    expect(stepLowpass(0, 1)).toBe(0);
  });

  it('az EQ-sáv ±3 dB-es lépésben, ±12 dB-en vágva', () => {
    expect(stepEqBand(0, 1)).toBe(3);
    expect(stepEqBand(-6, -1)).toBe(-9);
    expect(stepEqBand(12, 1)).toBe(12);
    expect(stepEqBand(11, 1)).toBe(12);
    expect(stepEqBand(-12, -1)).toBe(-12);
  });

  it('a zengetés / visszhang ±0,2-es lépésben, tizedre kerekítve, 0…1 között', () => {
    expect(stepWet(undefined, 1)).toBe(0.2);
    expect(stepWet(0.4, 1)).toBe(0.6);
    expect(stepWet(0.9, 1)).toBe(1);
    expect(stepWet(0.1, -1)).toBe(0);
    expect(stepWet(0.4, -1)).toBe(0.2);
  });

  it('az EQ felirata előjellel; az alapérték üres FX és EQ', () => {
    expect(formatEqDb(3)).toBe('+3 dB');
    expect(formatEqDb(0)).toBe('0 dB');
    expect(formatEqDb(-12)).toBe('-12 dB');
    expect(clipFxOf(null)).toEqual({ fx: {}, eq: { low: 0, mid: 0, high: 0 } });
    const fx = { reverb: 0.4, eq: { low: 3, mid: 0, high: -3 } };
    const got = clipFxOf(audio('a', 0, { audioFx: fx }));
    expect(got.fx).toBe(fx);
    expect(got.eq).toBe(fx.eq);
  });
});

describe('audioPanelOps — beat-forrás és dub', () => {
  it('a beat-rács forrása a zenesáv legkorábbi hangklipje, különben a kijelölt klip, különben null', () => {
    const sel = audio('sel', 9);
    const p = tracks([{ type: 'voiceover', clips: [audio('vo', 0)] }, { type: 'music', clips: [audio('m2', 5), text('x', 0, 'x'), audio('m1', 1)] }]);
    expect(beatSourceClip(p, sel)?.id).toBe('m1');
    expect(beatSourceClip(tracks([{ type: 'music', clips: [] }]), sel)).toBe(sel);
    expect(beatSourceClip(null, null)).toBeNull();
    expect(beatSourceClip(tracks([{ type: 'sfx', clips: [audio('s', 0)] }]), null)).toBeNull();
  });

  it('a dub a felirat-sáv szöveges klipjeit időrendben fűzi össze, 4000 karakterre vágva', () => {
    const p = tracks([{ type: 'captions', clips: [text('b', 4, ' world '), audio('a', 0), text('a', 2, 'hello')] }]);
    const caps = dubCaptions(p);
    expect(caps.map((c) => c.id)).toEqual(['a', 'b']);
    expect(dubText(caps)).toBe('hello  world');
    expect(dubCaptions(tracks([{ type: 'music', clips: [] }]))).toEqual([]);
    expect(dubCaptions(undefined)).toEqual([]);
    expect(dubText([text('l', 0, 'x'.repeat(5000))])).toHaveLength(4000);
  });
});
