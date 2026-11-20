/**
 * 🎧 A Hang Stúdió törzséből kiemelt műveletek (REFACTOR): a lap-kezelők, a hangszer-nyitás, a görgetés →
 * látható ablak, valamint a kilépés / tempó-felismerés / forrás-beillesztés útjai. A bontás előtti
 * viselkedést rögzíti (parancs-típusok, Alert-ek, logCaught-címke).
 */
import { Alert } from 'react-native';

import { openInstrumentOf, studioSheetHandlers } from '@/components/studio/audio/body/sheetHandlers';
import { studioActions } from '@/components/studio/audio/body/studioActions';
import { timelineScrollHandlers } from '@/components/studio/audio/body/useTimelineView';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, AudioClip, Project } from '@/types/project';

const mockLog: string[] = [];
jest.mock('@/lib/beats', () => ({ detectBeats: jest.fn() }));
jest.mock('@/lib/media', () => ({ probeAudioDuration: jest.fn() }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: (tag: string, e: Error) => mockLog.push(`${tag}:${e.message}`) }));

const { detectBeats } = jest.requireMock('@/lib/beats') as { detectBeats: jest.Mock };
const { probeAudioDuration } = jest.requireMock('@/lib/media') as { probeAudioDuration: jest.Mock };

type Inst = Parameters<typeof openInstrumentOf>[0];
type Ai = Parameters<typeof studioSheetHandlers>[0]['ai'];

/** minden meghívott függvény a naplóba (név + argumentumok) */
function recorder<T>(names: string[], log: string[]): T {
  return Object.fromEntries(names.map((n) => [n, (...a: unknown[]) => void log.push(`${n}(${JSON.stringify(a)})`)])) as T;
}
const INST = ['setPianoRoll', 'setDrumMachine', 'setSampler', 'setLoopsOpen', 'setChordsOpen', 'setEditDocId', 'setSamplerMelody', 'bakeSynth', 'bakeDrums', 'editInstrument', 'bakeSamplerPads', 'bakeSampler'];
const AI = ['applyTune', 'humMelody', 'stemsOnDevice', 'applyAiDenoise', 'resetAiDenoise', 'resetTune'];

const clip = (id: string, uri: string): AudioClip =>
  ({ kind: 'audio', id, uri, label: id, start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' }) as AudioClip;
const project = (clips: AudioClip[]) => ({ id: 'p', tracks: [{ id: 'tm', type: 'music', clips }] }) as unknown as Project;
const t = ((k: string) => k) as unknown as Parameters<typeof studioActions>[0]['t'];

describe('sheetHandlers — a lapok hangszer- és AI-kezelői', () => {
  it('a hangszer-lap bezárása a szerkesztett dokumentumot is elengedi, a nyitás nem', () => {
    const log: string[] = [];
    const h = studioSheetHandlers({ inst: recorder<Inst>(INST, log), ai: recorder<Ai>(AI, log), setEditing: (v) => log.push(`setEditing(${v})`) });
    h.setPianoRoll?.(true);
    h.setPianoRoll?.(false);
    h.setDrumMachine?.(false);
    h.setSampler?.(true);
    expect(log).toEqual(['setPianoRoll([true])', 'setPianoRoll([false])', 'setEditDocId([null])', 'setDrumMachine([false])', 'setEditDocId([null])', 'setSampler([true])']);
  });

  it('hangolás / visszaállítás előbb bezárja a klip-szerkesztőt; a sampler-dallam a samplert zárja', () => {
    const log: string[] = [];
    const h = studioSheetHandlers({ inst: recorder<Inst>(INST, log), ai: recorder<Ai>(AI, log), setEditing: (v) => log.push(`setEditing(${v})`) });
    h.onTune?.('c1', { root: 0, minor: false, strength: 1 });
    h.onResetTune?.('c1');
    h.onSamplerMelody?.('file:///s.wav', 'S', 60);
    h.onOpenLoops?.();
    h.onStemsOnDevice?.('c1');
    h.onAiDenoise?.('c1', 0.5);
    expect(log).toEqual([
      'setEditing(false)',
      'applyTune(["c1",{"root":0,"minor":false,"strength":1}])',
      'setEditing(false)',
      'resetTune(["c1"])',
      'setSampler([false])',
      'setSamplerMelody([{"sampleUri":"file:///s.wav","sampleName":"S","rootMidi":60}])',
      'setLoopsOpen([true])',
      'stemsOnDevice(["c1"])',
      'applyAiDenoise(["c1",0.5])',
    ]);
  });

  it('openInstrumentOf: minden transzport-hangszer a saját lapját nyitja (a többi = akkordok)', () => {
    const log: string[] = [];
    const open = openInstrumentOf(recorder<Inst>(INST, log));
    (['pianoRoll', 'drums', 'sampler', 'loops', 'chords'] as const).forEach((w) => open(w));
    expect(log).toEqual(['setPianoRoll([true])', 'setDrumMachine([true])', 'setSampler([true])', 'setLoopsOpen([true])', 'setChordsOpen([true])']);
  });
});

describe('timelineScrollHandlers — görgetés → látható ablak', () => {
  it('a szélesség csak változáskor ír; az ablak csak negyed-képernyőnyi elmozdulásnál', () => {
    let view = { x: 0, w: 400 };
    const setView = jest.fn((u: (v: typeof view) => typeof view) => {
      view = u(view);
    });
    const scrollXRef = { current: 0 };
    const viewXRef = { current: 0 };
    const h = timelineScrollHandlers({ setView: setView as never, scrollXRef, viewXRef, viewW: 400 });
    h.onLayout({ nativeEvent: { layout: { width: 400, height: 1, x: 0, y: 0 } } } as never);
    expect(view).toEqual({ x: 0, w: 400 });
    h.onScroll({ nativeEvent: { contentOffset: { x: 100, y: 0 } } } as never);
    expect([scrollXRef.current, viewXRef.current, view.x]).toEqual([100, 0, 0]);
    h.onScroll({ nativeEvent: { contentOffset: { x: 101, y: 0 } } } as never);
    expect([scrollXRef.current, viewXRef.current, view.x]).toEqual([101, 101, 101]);
    h.onLayout({ nativeEvent: { layout: { width: 320, height: 1, x: 0, y: 0 } } } as never);
    expect(view).toEqual({ x: 101, w: 320 });
  });
});

describe('studioActions — kilépés, tempó-felismerés, forrás', () => {
  const alerts: unknown[][] = [];
  const dispatched: unknown[] = [];
  const added: unknown[] = [];
  beforeEach(() => {
    alerts.length = 0;
    dispatched.length = 0;
    added.length = 0;
    mockLog.length = 0;
    jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
    useEditorStore.setState({
      dispatch: ((c: unknown) => void dispatched.push(c)) as never,
      addClip: ((type: string, c: AudioClip) => void added.push([type, c.id, c.start, c.duration, c.label])) as never,
    });
  });
  const make = (over: Partial<Parameters<typeof studioActions>[0]> = {}) => {
    const calls: string[] = [];
    const a = studioActions({
      t,
      project: project([clip('c1', 'file:///a.mp3')]),
      playhead: 1.01,
      grid: 10,
      selClip: null,
      bpmBusy: false,
      setBpmBusy: (v) => calls.push(`busy(${v})`),
      setDetectedBeats: (v) => calls.push(`beats(${JSON.stringify(v)})`),
      setSource: (v) => calls.push(`source(${v})`),
      finishIfRecording: () => Promise.resolve(),
      onExit: () => calls.push('exit'),
      ...over,
    });
    return { a, calls };
  };

  it('kilépés: a felvétel lezárása után lép ki; hibánál is, az eredeti logCaught-címkével', async () => {
    const ok = make();
    ok.a.exitStudio();
    await new Promise((r) => setTimeout(r, 0));
    expect(ok.calls).toEqual(['exit']);
    const bad = make({ finishIfRecording: () => Promise.reject(new Error('x')) });
    bad.a.exitStudio();
    await new Promise((r) => setTimeout(r, 0));
    expect(bad.calls).toEqual(['exit']);
    expect(mockLog).toEqual(['components/studio/audio/AudioStudioBody.tsx:exitStudio:x']);
  });

  it('tempó: foglaltan nem fut; klip nélkül Alert; siker → kerekített SET_BPM + beatek; 0 bpm → Alert', async () => {
    const busy = make({ bpmBusy: true });
    await busy.a.autoDetectBpm();
    expect(busy.calls).toEqual([]);
    const none = make({ project: project([]) });
    await none.a.autoDetectBpm();
    expect(alerts.map((x) => x[1])).toEqual(['studio.audio.autoBpmNoClip']);
    detectBeats.mockResolvedValueOnce({ bpm: 121.6, beats: [0, 0.5] });
    const ok = make({ selClip: clip('s1', 'file:///sel.mp3') });
    await ok.a.autoDetectBpm();
    expect(detectBeats).toHaveBeenLastCalledWith('file:///sel.mp3');
    expect(dispatched).toEqual([{ type: 'SET_BPM', bpm: 122 }]);
    expect(ok.calls).toEqual(['busy(true)', 'beats({"uri":"file:///sel.mp3","beats":[0,0.5]})', 'busy(false)']);
    detectBeats.mockResolvedValueOnce({ bpm: 0 });
    const zero = make();
    await zero.a.autoDetectBpm();
    expect(alerts.map((x) => x[1])).toEqual(['studio.audio.autoBpmNoClip', 'studio.audio.autoBpmFail']);
    expect(zero.calls).toEqual(['busy(true)', 'busy(false)']);
  });

  it('forrás: csak hang; ismert hossz → a playhead rácsra igazítva a music sávra; ismeretlen hossz → Alert', async () => {
    const m = make();
    await m.a.insertSource({ id: 'i', kind: 'image', uri: 'file:///i.png' } as Asset);
    await m.a.insertSource({ id: 'a', kind: 'audio', uri: 'file:///a.mp3', name: 'A', duration: 3 } as Asset);
    probeAudioDuration.mockResolvedValueOnce(0);
    await m.a.insertSource({ id: 'z', kind: 'audio', uri: 'file:///z.mp3' } as Asset);
    probeAudioDuration.mockResolvedValueOnce(4);
    await m.a.insertSource({ id: 'p', kind: 'audio', uri: 'file:///p.mp3' } as Asset);
    expect(added).toEqual([
      ['music', 'clip_1', 1, 3, 'A'],
      ['music', 'clip_1', 1, 4, 'studio.kind.audio'],
    ]);
    expect(alerts.map((x) => x[1])).toEqual(['studio.audio.intake.unknownDuration']);
    expect(m.calls).toEqual(['source(false)', 'source(false)']);
  });
});
