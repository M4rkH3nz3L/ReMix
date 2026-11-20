/**
 * 🎥 A Live Studio akció-gyárai (REFACTOR: a src/app/live/studio/[id].tsx-ből): a hálózati hívások
 * pontos argumentumai, a sorrend (mentés → kamera elengedése → 350 ms → startLive → navigáció), a
 * hibaágak és a logCaught-ujjlenyomatok — a bontás előtti viselkedést rögzítik.
 */
import { Alert } from 'react-native';

import { createRtmpActions, createStudioActions } from '@/components/live/studio/liveStudioActions';
import { createLiveDoc } from '@/lib/liveDoc';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

const calls: unknown[][] = [];
const rec = (name: string) => jest.fn((...a: unknown[]) => { calls.push([name, ...a]); const r = resp[name]; return r ? r() : Promise.resolve(undefined); });
let resp: Record<string, () => Promise<unknown>> = {};

jest.mock('expo-router', () => ({ router: { replace: (...a: unknown[]) => calls.push(['router.replace', ...a]) } }));
jest.mock('@/lib/storage', () => ({ saveProject: rec('saveProject'), deleteProject: rec('deleteProject') }));
jest.mock('@/lib/live', () => ({ startLive: rec('startLive') }));
jest.mock('@/lib/liveDestinations', () => ({
  addDestination: rec('addDestination'),
  removeDestination: rec('removeDestination'),
  setDestinationEnabled: rec('setDestinationEnabled'),
}));
jest.mock('@/lib/logCaught', () => ({ logCaught: (tag: string, e: Error) => calls.push(['logCaught', tag, e.message]) }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: () => calls.push(['goBackOrHome']) }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));

const t = ((k: string, o?: unknown) => (o ? `${k}|${JSON.stringify(o)}` : k)) as never;
let n = 0;
const live = createLiveDoc('Show', () => `g${++n}`);
const project = { id: 'p1', kind: 'live', live } as unknown as Project;
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
  calls.length = 0;
  resp = {};
  jest.spyOn(Alert, 'alert').mockImplementation((...a) => void calls.push(['Alert', ...a]));
});
afterEach(() => jest.restoreAllMocks());

const studio = (over: Partial<Parameters<typeof createStudioActions>[0]> = {}) => {
  const set = (name: string) => (v: unknown) => calls.push([name, v]);
  return createStudioActions({
    id: 'p1',
    project,
    live,
    scene: live.scenes[0],
    titleDraft: '  Hello  ',
    facing: 'back',
    commit: (doc, label) => calls.push(['commit', label, doc.scenes.length]),
    t,
    setAdding: set('setAdding'),
    setStarting: set('setStarting'),
    setReleasingCamera: set('setReleasingCamera'),
    ...over,
  });
};

describe('createStudioActions', () => {
  it('onStart: mentés a kamera-iránnyal → elengedés → 350 ms → startLive(cím, láthatóság) → /live/<id>?project=', async () => {
    jest.useFakeTimers();
    useEditorStore.setState({ project });
    resp = { startLive: () => Promise.resolve({ id: 'sess' }) };
    const done = studio().onStart();
    await flush();
    expect(calls.map((c) => c[0])).toEqual(['setStarting', 'saveProject', 'setReleasingCamera']);
    expect((calls[1][1] as Project).live?.cameraFacing).toBe('back');
    await jest.advanceTimersByTimeAsync(349);
    expect(calls.some((c) => c[0] === 'startLive')).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await done;
    expect(calls.slice(3)).toEqual([['startLive', 'Hello', 'public'], ['router.replace', '/live/sess?project=p1']]);
    jest.useRealTimers();
  });

  it('onStart hiba: logCaught(onStart) → visszaállítás → Alert a hibaszöveggel', async () => {
    useEditorStore.setState({ project: null });
    resp = { startLive: () => Promise.reject(new Error('nope')) };
    jest.useFakeTimers();
    const done = studio({ titleDraft: '' }).onStart();
    await jest.advanceTimersByTimeAsync(350);
    await done;
    jest.useRealTimers();
    expect(calls).toEqual([
      ['setStarting', true],
      ['setReleasingCamera', true],
      ['startLive', 'Show', 'public'],
      ['logCaught', 'app/live/studio/[id].tsx:onStart', 'nope'],
      ['setStarting', false],
      ['setReleasingCamera', false],
      ['Alert', 'live.error|{"defaultValue":"Live"}', 'nope'],
    ]);
  });

  it('onCancel: csak live-projektet töröl, a hibát a saját címkéjével naplózza, mindig visszalép', async () => {
    resp = { deleteProject: () => Promise.reject(new Error('del')) };
    studio().onCancel();
    await flush();
    studio({ project: { ...project, kind: 'video' } as Project }).onCancel();
    expect(calls).toEqual([['deleteProject', 'p1'], ['goBackOrHome'], ['logCaught', 'app/live/studio/[id].tsx:onCancel', 'del'], ['goBackOrHome']]);
  });

  it('onAddSource / onAddScene: undo-címkék („+ <címke>”, „+ scene”), jelenet nélkül no-op', () => {
    studio().onAddSource('text');
    studio().onAddScene();
    studio({ scene: undefined }).onAddSource('camera');
    expect(calls).toEqual([
      ['commit', '+ live.studio.source.text|{"defaultValue":"text"}', 1],
      ['setAdding', false],
      ['commit', '+ scene', 2],
    ]);
  });
});

describe('createRtmpActions', () => {
  const rtmp = (label: string, url: string, key: string) =>
    createRtmpActions({
      rtmpLabel: label,
      rtmpUrl: url,
      rtmpKey: key,
      setRtmpLabel: (v) => calls.push(['setRtmpLabel', v]),
      setRtmpUrl: (v) => calls.push(['setRtmpUrl', v]),
      setRtmpKey: (v) => calls.push(['setRtmpKey', v]),
      setRtmpOpen: (v) => calls.push(['setRtmpOpen', v]),
      loadDests: () => calls.push(['loadDests']),
      t,
    });

  it('mentés: vágott mezők, custom + bekapcsolva; siker → mezők ürítése, zárás, újratöltés', async () => {
    rtmp('  ', ' rtmp://a/live ', ' k1 ').onSubmitRtmp();
    await flush();
    expect(calls).toEqual([
      ['addDestination', { platform: 'custom', label: 'RTMP', rtmpUrl: 'rtmp://a/live', streamKey: 'k1', enabled: true }],
      ['setRtmpLabel', ''],
      ['setRtmpUrl', ''],
      ['setRtmpKey', ''],
      ['setRtmpOpen', false],
      ['loadDests'],
    ]);
  });

  it('mentési hiba: a live.dest.* kulcs fordítva, a többi nyersen; a mezők maradnak', async () => {
    resp = { addDestination: () => Promise.reject(new Error('live.dest.badUrl')) };
    rtmp('L', 'u', 'k').onSubmitRtmp();
    await flush();
    resp = { addDestination: () => Promise.reject(new Error('db says no')) };
    rtmp('L', 'u', 'k').onSubmitRtmp();
    await flush();
    expect(calls.filter((c) => c[0] !== 'addDestination')).toEqual([
      ['logCaught', 'app/live/studio/[id].tsx:LiveStudioScreen', 'live.dest.badUrl'],
      ['Alert', 'common.error', 'live.dest.badUrl'],
      ['logCaught', 'app/live/studio/[id].tsx:LiveStudioScreen', 'db says no'],
      ['Alert', 'common.error', 'db says no'],
    ]);
  });

  it('be/ki és törlés: a sor id-jével, siker → újratöltés, hiba → logCaught', async () => {
    const d = { id: 'd1', platform: 'custom', label: 'x', rtmpUrl: 'u', enabled: true, hasKey: true } as never;
    rtmp('', '', '').onToggleDest(d);
    await flush();
    resp = { removeDestination: () => Promise.reject(new Error('rm')) };
    await rtmp('', '', '').onRemoveDest(d);
    expect(calls).toEqual([
      ['setDestinationEnabled', 'd1', false],
      ['loadDests'],
      ['removeDestination', 'd1'],
      ['logCaught', 'app/live/studio/[id].tsx:LiveStudioScreen', 'rm'],
    ]);
  });
});
