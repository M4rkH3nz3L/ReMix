/**
 * 🎚️ A klip-szerkesztő lap akció-csoportjai (REFACTOR: a ClipEditSheet.tsx-ből): a mentések a command
 * buson mennek (updateClip / dispatch / applyBatch 'user'), a lapot bezáró eszközök előbb zárnak, aztán indulnak.
 */
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { createClipCommitActions } from '@/components/studio/audio/clipEdit/clipCommitActions';
import { createClipToolActions } from '@/components/studio/audio/clipEdit/clipToolActions';
import type { ClipEditSettings } from '@/lib/clipEditOps';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

const log: string[] = [];
jest.mock('@/components/studio/audio/SilenceReview', () => ({ startSilenceSearch: jest.fn(async () => 1) }));
jest.mock('@/components/studio/audio/SpeechEditBar', () => ({ startSpeechEdit: jest.fn(async () => 1) }));
jest.mock('@/components/studio/audio/audioSyncAction', () => ({ startAudioSync: jest.fn() }));
jest.mock('@/lib/audioSpectrum', () => ({ renderClipSpectrum: jest.fn() }));
jest.mock('@/lib/stems', () => ({ separateStems: jest.fn() }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));

const { startSilenceSearch } = jest.requireMock('@/components/studio/audio/SilenceReview');
const { startSpeechEdit } = jest.requireMock('@/components/studio/audio/SpeechEditBar');
const { startAudioSync } = jest.requireMock('@/components/studio/audio/audioSyncAction');
const { renderClipSpectrum } = jest.requireMock('@/lib/audioSpectrum');
const { separateStems } = jest.requireMock('@/lib/stems');

const t = ((k: string) => k) as unknown as TFunction;
const clip = {
  kind: 'audio', id: 'c1', uri: 'file:///a.m4a', label: 'a', start: 0, duration: 4, volume: 1, fadeIn: 0, fadeOut: 0, trimIn: 0.2731,
  takes: [{ id: 't2', uri: 'file:///t2.m4a', label: 'T2', start: 0, duration: 3, trimIn: 0, sourceDuration: 3 }],
} as AudioClip;
const base: ClipEditSettings = { volume: 1, fadeIn: 0, fadeOut: 0, duration: 4, trimIn: 0.2731, pan: 0, voiceEnhance: false, deReverb: false, autoDuck: false, fx: {} };

beforeEach(() => {
  log.length = 0;
  jest.clearAllMocks();
  const p = createEmptyProject('t', '9:16', undefined, 'audio');
  useEditorStore.getState().loadProject({ ...p, tracks: p.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)) }, []);
  useEditorStore.setState({ dispatch: (...a: unknown[]) => void log.push(`dispatch ${JSON.stringify(a)}`) } as never);
});

const commit = (dirty: boolean, settings = base) =>
  createClipCommitActions({
    clip,
    fps: 30,
    t,
    settings,
    dirty,
    sourceDuration: 4,
    updateClip: (id, patch) => void log.push(`updateClip ${id} ${JSON.stringify(patch)}`),
    onClose: () => void log.push('onClose'),
  });

describe('createClipCommitActions', () => {
  it('„Kész”: piszkos lapnál egy updateClip (a vágás érintetlen), aztán zár; tisztánál csak zár', () => {
    commit(true, { ...base, volume: 0.5 }).onDone();
    expect(log).toEqual(['updateClip c1 {"volume":0.5,"pan":0,"fadeIn":0,"fadeOut":0,"sourceDuration":4,"voiceEnhance":false,"deReverb":false,"autoDuck":false,"audioFx":{}}', 'onClose']);
    log.length = 0;
    commit(false).onDone();
    expect(log).toEqual(['onClose']);
  });

  it('take-választás: előbb a függő beállítások, aztán a take-parancs (actor nélkül); ismeretlen take-re nincs parancs', () => {
    commit(true, { ...base, pan: 0.5 }).pickTake('t2');
    expect(log).toEqual([
      'updateClip c1 {"volume":1,"pan":0.5,"fadeIn":0,"fadeOut":0,"voiceEnhance":false,"deReverb":false,"autoDuck":false,"audioFx":{}}',
      'dispatch [{"type":"UPDATE_CLIP","clipId":"c1","patch":{"uri":"file:///t2.m4a","label":"T2","start":0,"duration":3,"trimIn":0,"sourceDuration":3,"activeTake":"t2"}}]',
    ]);
    log.length = 0;
    commit(false).pickTake('nincs');
    expect(log).toEqual([]);
  });

  it('tempó: a tartományon kívüli illesztés figyelmeztet és nem ír; a jó patch egy UPDATE_CLIP', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    commit(true).applyTempo(null);
    expect(alert).toHaveBeenCalledWith('studio.audio.tempo.title', 'studio.audio.tempo.outOfRange');
    expect(log).toEqual([]);
    commit(false).applyTempo({ speed: 1.25 });
    expect(log).toEqual(['dispatch [{"type":"UPDATE_CLIP","clipId":"c1","patch":{"speed":1.25}}]']);
    alert.mockRestore();
  });
});

const tools = (over: Partial<Parameters<typeof createClipToolActions>[0]> = {}) =>
  createClipToolActions({
    clip,
    fps: 30,
    t,
    onClose: () => void log.push('onClose'),
    applyBatch: (cmds, actor) => log.push(`applyBatch ${cmds.map((c) => c.type).join(',')} ${actor}`),
    setSeparating: (v) => void log.push(`separating ${v}`),
    specBusy: false,
    setSpecBusy: (v) => void log.push(`specBusy ${v}`),
    setSpectrumUri: (u) => void log.push(`spectrum ${u}`),
    ...over,
  });

describe('createClipToolActions', () => {
  it('csend-keresés / szöveges vágás: a klip sávjával indul, előtte zár; ha a klip nincs a projektben, semmi', () => {
    tools().findSilence();
    tools().openSpeechEdit();
    expect(log).toEqual(['onClose', 'onClose']);
    expect(startSilenceSearch).toHaveBeenCalledWith(clip, 'music', 30, t);
    expect(startSpeechEdit).toHaveBeenCalledWith('music', t);
    log.length = 0;
    tools({ clip: { ...clip, id: 'idegen' } }).findSilence();
    tools({ clip: { ...clip, id: 'idegen' } }).openSpeechEdit();
    expect(log).toEqual([]);
  });

  it('szinkron: zár, aztán indul', () => {
    tools().openAudioSync();
    expect(log).toEqual(['onClose']);
    expect(startAudioSync).toHaveBeenCalledWith(clip, 30, t);
  });

  it('spektrum: foglaltan nem indul; üres eredményre figyelmeztet; a foglaltság mindig visszaáll', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await tools({ specBusy: true }).showSpectrum();
    expect(log).toEqual([]);
    renderClipSpectrum.mockResolvedValueOnce(null);
    await tools().showSpectrum();
    expect(log).toEqual(['specBusy true', 'spectrum null', 'specBusy false']);
    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('stem-szeparáció: egy applyBatch (\'user\') — 4 ADD_CLIP + az eredeti elnémítása —, zár, a jelző visszaáll', async () => {
    separateStems.mockResolvedValueOnce([
      { name: 'vocals', url: 'v' },
      { name: 'drums', url: 'd' },
      { name: 'bass', url: 'b' },
      { name: 'other', url: 'o' },
    ]);
    await tools().onSeparate();
    expect(log).toEqual(['separating true', 'applyBatch ADD_CLIP,ADD_CLIP,ADD_CLIP,ADD_CLIP,UPDATE_CLIP user', 'onClose', 'separating false']);
  });

  it('stem-szeparáció hibája: figyelmeztet, nem ír, a jelző visszaáll', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    separateStems.mockRejectedValueOnce(new Error('boom'));
    await tools().onSeparate();
    expect(alert).toHaveBeenCalledWith('studio.audio.stems', 'boom');
    expect(log).toEqual(['separating true', 'separating false']);
    alert.mockRestore();
  });
});
