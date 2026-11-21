/**
 * 🔴 Az élő adás akció-gyárai és kapcsolat-életciklusa (REFACTOR: a src/app/live/[id].tsx-ből):
 * a hálózati hívások pontos argumentumai és sorrendje (egress indítás/leállítás, adás-vége,
 * VOD-import, szívverés, ébren tartás), a hibaágak és a logCaught-ujjlenyomatok — a bontás
 * előtti viselkedést rögzítik.
 */
import { Alert } from 'react-native';

import { createLiveChatActions, createLiveEndActions } from '@/components/live/session/liveSessionActions';
import { startHostEgress } from '@/components/live/session/liveSessionEgress';
import {
  holdScreenAwake,
  openLiveSession,
  startHostHeartbeat,
  stopHostOnUnmount,
} from '@/components/live/session/liveSessionLifecycle';
import { createLiveDoc } from '@/lib/liveDoc';
import type { Project } from '@/types/project';

const calls: unknown[][] = [];
let resp: Record<string, () => Promise<unknown>> = {};
const rec = (name: string) => jest.fn((...a: unknown[]) => { calls.push([name, ...a]); const r = resp[name]; return r ? r() : Promise.resolve(undefined); });

jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => calls.push(['router.push', ...a]) } }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: rec('activateKeepAwake'), deactivateKeepAwake: rec('deactivateKeepAwake') }));
jest.mock('@/lib/storage', () => ({ saveProject: rec('saveProject'), deleteProject: rec('deleteProject'), loadProject: rec('loadProject') }));
jest.mock('@/lib/feed', () => ({ publishLiveVod: rec('publishLiveVod') }));
jest.mock('@/lib/live', () => ({
  endLive: rec('endLive'),
  getLive: rec('getLive'),
  buildLiveSelf: rec('buildLiveSelf'),
  heartbeatLive: rec('heartbeatLive'),
  bumpViewerPeak: rec('bumpViewerPeak'),
  openLiveRoom: (...a: unknown[]) => { calls.push(['openLiveRoom', a[0], a[1]]); (globalThis as any).__h = a[2]; return { stop: () => calls.push(['room.stop']), sendChat: (b: string) => calls.push(['room.sendChat', b]), sendReaction: (e: string) => calls.push(['room.sendReaction', e]) }; },
}));
jest.mock('@/lib/liveDestinations', () => ({
  hasEnabledTargets: rec('hasEnabledTargets'),
  startLiveEgress: rec('startLiveEgress'),
  stopLiveEgress: rec('stopLiveEgress'),
}));
jest.mock('@/lib/logCaught', () => ({ logCaught: (tag: string, e: Error) => calls.push(['logCaught', tag, e.message]) }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: () => calls.push(['goBackOrHome']) }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));

const t = ((k: string, o?: unknown) => (o ? `${k}|${JSON.stringify(o)}` : k)) as never;
const ref = <T,>(current: T) => ({ current });
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
let n = 0;
const live = createLiveDoc('Show', () => `g${++n}`);
const proj = { id: 'p1', name: 'Proj', kind: 'live', aspectRatio: '9:16', fps: 30, tracks: [], media: [], live: { ...live, record: true } } as unknown as Project;
const SESSION = { id: 'L1', hostId: 'h1', title: 'T', status: 'live', hostUsername: null, hostName: null, hostAvatar: null, startedAt: 'T', viewerPeak: 0 } as const;

beforeEach(() => {
  calls.length = 0;
  resp = {};
  jest.spyOn(Alert, 'alert').mockImplementation((...a) => void calls.push(['Alert', a[0], a[1], (a[2] ?? []).map((b) => b.text)]));
  jest.spyOn(Date, 'now').mockReturnValue(100_000);
});
afterEach(() => jest.restoreAllMocks());

describe('createLiveChatActions', () => {
  it('a chat-szöveg vágva megy a szobába, utána a mező kiürül', () => {
    const setText = jest.fn();
    const { onSendChat } = createLiveChatActions({ roomRef: ref({ sendChat: (b: string) => calls.push(['sendChat', b]) } as never), text: '  szia  ', setText });
    onSendChat();
    expect(calls).toEqual([['sendChat', 'szia']]);
    expect(setText).toHaveBeenCalledWith('');
  });
  it('üres / csak szóköz → nincs küldés, a mező marad', () => {
    const setText = jest.fn();
    createLiveChatActions({ roomRef: ref({ sendChat: () => calls.push(['x']) } as never), text: '   ', setText }).onSendChat();
    expect(calls).toEqual([]);
    expect(setText).not.toHaveBeenCalled();
  });
  it('a reakció a szobán megy; szoba nélkül csendben kimarad', () => {
    createLiveChatActions({ roomRef: ref({ sendReaction: (e: string) => calls.push(['sendReaction', e]) } as never), text: '', setText: jest.fn() }).onReact('🔥');
    createLiveChatActions({ roomRef: ref(null), text: 'x', setText: jest.fn() }).onReact('🔥');
    expect(calls).toEqual([['sendReaction', '🔥']]);
  });
});

function endDeps(over: Record<string, unknown> = {}) {
  return {
    isHost: true,
    session: SESSION,
    projectParam: 'p1',
    t,
    dispatchLs: (e: unknown) => calls.push(['dispatchLs', e]),
    endedRef: ref(false),
    egressIdRef: ref<string | null>('eg1'),
    vodUrlRef: ref<string | null>('https://vod'),
    liveProjRef: ref<Project | null>(proj),
    liveDocRef: ref(proj.live ?? null),
    startStampRef: ref(40_000),
    ...over,
  } as never;
}

describe('createLiveEndActions', () => {
  it('host + felvétel: STOP → egress-stop → endLive → STOPPED → VOD mentés → config törlés → Alert 3 gombbal', async () => {
    const deps = endDeps();
    await createLiveEndActions(deps).onEndOrLeave();
    await flush();
    expect(calls.map((c) => c[0])).toEqual(['dispatchLs', 'stopLiveEgress', 'endLive', 'dispatchLs', 'saveProject', 'deleteProject', 'Alert']);
    expect(calls[0]).toEqual(['dispatchLs', { type: 'STOP', at: 100_000 }]);
    expect(calls[1]).toEqual(['stopLiveEgress', 'eg1']);
    expect(calls[2]).toEqual(['endLive', 'L1']);
    expect(calls[3]).toEqual(['dispatchLs', { type: 'STOPPED', at: 100_000 }]);
    const saved = calls[4][1] as Project;
    expect(saved.kind).toBe('video');
    expect(saved.name).toBe('Show');
    expect(saved.tracks[0].clips[0]).toMatchObject({ uri: 'https://vod', duration: 60 });
    expect(calls[5]).toEqual(['deleteProject', 'p1']);
    expect(calls[6][3]).toEqual(['live.vodOpen|{"defaultValue":"Projekt megnyitása"}', 'live.vodShare|{"defaultValue":"Megosztás feedre"}', 'common.done|{"defaultValue":"Kész"}']);
    expect((deps as any).endedRef.current).toBe(true);
    expect((deps as any).egressIdRef.current).toBeNull();
    expect((deps as any).vodUrlRef.current).toBeNull();
  });
  it('a VOD-Alert gombjai: megnyitás → /editor/<id>; megosztás → publishLiveVod + vissza; kész → vissza', async () => {
    await createLiveEndActions(endDeps()).onEndOrLeave();
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    calls.length = 0;
    buttons[0].onPress();
    buttons[1].onPress();
    buttons[2].onPress();
    await flush();
    expect(calls[0]).toEqual(['router.push', '/editor/prj_1']);
    expect(calls[1][0]).toBe('publishLiveVod');
    expect(calls[1][2]).toBe('https://vod');
    expect(calls.slice(2)).toEqual([['goBackOrHome'], ['goBackOrHome']]);
  });
  it('nincs felvétel: config törlés + vissza; hibák az eredeti címkékkel', async () => {
    resp = { endLive: () => Promise.reject(new Error('end')), deleteProject: () => Promise.reject(new Error('del')) };
    await createLiveEndActions(endDeps({ vodUrlRef: ref(null), egressIdRef: ref(null) })).onEndOrLeave();
    await flush();
    expect(calls).toEqual([
      ['dispatchLs', { type: 'STOP', at: 100_000 }],
      ['endLive', 'L1'],
      ['logCaught', 'app/live/[id].tsx:onEndOrLeave', 'end'],
      ['dispatchLs', { type: 'STOPPED', at: 100_000 }],
      ['deleteProject', 'p1'],
      ['goBackOrHome'],
      ['logCaught', 'app/live/[id].tsx:onEndOrLeave', 'del'],
    ]);
  });
  it('néző / már befejezett / session nélkül → csak vissza', async () => {
    await createLiveEndActions(endDeps({ isHost: false })).onEndOrLeave();
    await createLiveEndActions(endDeps({ endedRef: ref(true) })).onEndOrLeave();
    await createLiveEndActions(endDeps({ session: null })).onEndOrLeave();
    expect(calls).toEqual([['goBackOrHome'], ['goBackOrHome'], ['goBackOrHome']]);
  });
  it('importVod: rögzítés nélkül vagy VOD nélkül null; a mentés hibája az importVod-címkével', async () => {
    expect(createLiveEndActions(endDeps({ liveDocRef: ref({ ...live, record: false }) })).importVod()).toBeNull();
    expect(createLiveEndActions(endDeps({ vodUrlRef: ref(null) })).importVod()).toBeNull();
    expect(createLiveEndActions(endDeps({ liveProjRef: ref(null) })).importVod()).toBeNull();
    resp = { saveProject: () => Promise.reject(new Error('save')) };
    const p = createLiveEndActions(endDeps({ startStampRef: ref(0) })).importVod();
    await flush();
    // indulási bélyeg nélkül 0 mp → a buildVodProject egy frame-re (1/30 mp) emeli
    expect(p?.tracks[0].clips[0]).toMatchObject({ duration: 1 / 30 });
    expect(calls.slice(-1)).toEqual([['logCaught', 'app/live/[id].tsx:importVod', 'save']]);
  });
});

describe('stopHostOnUnmount', () => {
  const base = () => ({ isHost: true, session: SESSION as never, projectParam: 'p1', endedRef: ref(false), egressIdRef: ref<string | null>('eg9'), liveDocRef: ref(live as never), importVod: () => { calls.push(['importVod']); return null; } });
  it('hirtelen kilépés rögzítés nélkül: egress-stop → endLive → importVod → config törlés', async () => {
    const d = base();
    stopHostOnUnmount(d);
    await flush();
    expect(calls).toEqual([['stopLiveEgress', 'eg9'], ['endLive', 'L1'], ['importVod'], ['deleteProject', 'p1']]);
    expect(d.endedRef.current).toBe(true);
    expect(d.egressIdRef.current).toBeNull();
  });
  it('rögzítéssel, de VOD-projekt nélkül a config megmarad', () => {
    stopHostOnUnmount({ ...base(), liveDocRef: ref({ ...live, record: true } as never) });
    expect(calls.map((c) => c[0])).toEqual(['stopLiveEgress', 'endLive', 'importVod']);
  });
  it('néző / már befejezett → semmi', () => {
    stopHostOnUnmount({ ...base(), isHost: false });
    stopHostOnUnmount({ ...base(), endedRef: ref(true) });
    expect(calls).toEqual([]);
  });
});

describe('ébren tartás és szívverés', () => {
  it('a keep-awake a remix-live címkével; a hibák az eredeti címkével', async () => {
    resp = { activateKeepAwake: () => Promise.reject(new Error('a')), deactivateKeepAwake: () => Promise.reject(new Error('d')) };
    const stop = holdScreenAwake();
    stop();
    await flush();
    expect(calls).toEqual([
      ['activateKeepAwake', 'remix-live'],
      ['deactivateKeepAwake', 'remix-live'],
      ['logCaught', 'app/live/[id].tsx:LiveRoomScreen', 'a'],
      ['logCaught', 'app/live/[id].tsx:LiveRoomScreen', 'd'],
    ]);
  });
  it('a szívverés azonnal, majd 30 mp-enként; befejezett adásnál kimarad', () => {
    jest.useFakeTimers();
    const ended = ref(false);
    const stop = startHostHeartbeat('L1', ended);
    jest.advanceTimersByTime(29_999);
    expect(calls).toEqual([['heartbeatLive', 'L1']]);
    jest.advanceTimersByTime(1);
    ended.current = true;
    jest.advanceTimersByTime(30_000);
    stop();
    jest.advanceTimersByTime(60_000);
    expect(calls).toEqual([['heartbeatLive', 'L1'], ['heartbeatLive', 'L1']]);
    jest.useRealTimers();
  });
});

describe('startHostEgress', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    liveId: 'L1', wantRecord: false, aspectRatio: '16:9' as const, isActive: () => true, endedRef: ref(false),
    egressIdRef: ref<string | null>(null), vodUrlRef: ref<string | null>(null), setEgress: (s: unknown) => calls.push(['setEgress', s]), tRef: ref(t), ...over,
  }) as never;
  it('nincs cél és nincs rögzítés → nem indul', async () => {
    resp = { hasEnabledTargets: () => Promise.resolve(false) };
    startHostEgress(deps());
    await flush();
    expect(calls).toEqual([['hasEnabledTargets']]);
  });
  it('cél van: starting → startLiveEgress(liveId, record, aspect) → on + kihagyott célok Alertje', async () => {
    resp = { hasEnabledTargets: () => Promise.resolve(true), startLiveEgress: () => Promise.resolve({ egressId: 'e1', destinations: [{}], vodUrl: 'https://v', skipped: [{ label: 'A' }, { label: 'B' }] }) };
    const d = deps();
    startHostEgress(d);
    await flush();
    expect(calls).toEqual([
      ['hasEnabledTargets'],
      ['setEgress', { state: 'starting' }],
      ['startLiveEgress', 'L1', false, '16:9'],
      ['setEgress', { state: 'on', destinations: 1, recording: true, skipped: 2 }],
      ['Alert', 'live.egress.title', 'live.egress.skipped|{"names":"A, B"}', []],
    ]);
    expect((d as any).egressIdRef.current).toBe('e1');
    expect((d as any).vodUrlRef.current).toBe('https://v');
  });
  it('🔐 L15: az adás közben véget ért → az árva egresst azonnal leállítja', async () => {
    resp = { hasEnabledTargets: () => Promise.resolve(false), startLiveEgress: () => Promise.resolve({ egressId: 'orphan', destinations: [] }) };
    const d = deps({ wantRecord: true, endedRef: ref(true) });
    startHostEgress(d);
    await flush();
    expect(calls.slice(-1)).toEqual([['stopLiveEgress', 'orphan']]);
    expect((d as any).egressIdRef.current).toBeNull();
  });
  it('hiba: failed + ok szerinti Alert (élő effektnél), a címke az eredeti', async () => {
    resp = { hasEnabledTargets: () => Promise.resolve(true), startLiveEgress: () => Promise.reject(new Error('egress (402)')) };
    startHostEgress(deps());
    await flush();
    expect(calls.slice(-3)).toEqual([
      ['logCaught', 'app/live/[id].tsx:LiveRoomScreen', 'egress (402)'],
      ['setEgress', { state: 'failed', reason: 'needsPro' }],
      ['Alert', 'live.egress.title', 'live.egress.reason_needsPro', []],
    ]);
  });
  it('hiba a lezárt effekt után: failed, de nincs Alert', async () => {
    resp = { hasEnabledTargets: () => Promise.reject(new Error('(400) nincs sem engedélyezett')) };
    startHostEgress(deps({ isActive: () => false, wantRecord: true }));
    await flush();
    expect(calls.slice(-1)).toEqual([['setEgress', { state: 'failed', reason: 'recordUnavailable' }]]);
  });
});

describe('openLiveSession', () => {
  const setters = () => {
    const s: Record<string, jest.Mock> = {};
    for (const k of ['setNotFound', 'setSession', 'setSelf', 'setChat', 'setViewers', 'setLiveStartMs', 'setHostScenes', 'setMicMuted', 'setFacing', 'setEgress', 'dispatchLs', 'addFloat', 'broadcastScene']) {
      s[k] = jest.fn((...a: unknown[]) => calls.push([k, ...a]));
    }
    return s;
  };
  const refs = () => ({ roomRef: ref(null), liveDocRef: ref(null), liveProjRef: ref(null), startStampRef: ref(0), endedRef: ref(false), egressIdRef: ref(null), vodUrlRef: ref(null), tRef: ref(t) });
  it('host: getLive → self → CONNECT → szoba → projekt → jelenet → egress; a cleanup zárja a szobát', async () => {
    resp = {
      getLive: () => Promise.resolve(SESSION),
      buildLiveSelf: () => Promise.resolve({ id: 'h1', name: 'H', avatar: null }),
      loadProject: () => Promise.resolve(proj),
      hasEnabledTargets: () => Promise.resolve(false),
      startLiveEgress: () => Promise.resolve({ egressId: 'e2', destinations: [], vodUrl: 'https://v2' }),
    };
    const s = setters();
    const r = refs();
    const cleanup = openLiveSession({ id: 'L1', projectParam: 'p1', ...r, ...s } as never);
    await flush();
    await flush();
    expect(calls.map((c) => c[0])).toEqual([
      'getLive', 'setSession', 'buildLiveSelf', 'setSelf', 'dispatchLs', 'openLiveRoom', 'loadProject',
      'setLiveStartMs', 'setHostScenes', 'setMicMuted', 'setFacing', 'broadcastScene', 'hasEnabledTargets',
      'setEgress', 'startLiveEgress', 'setEgress',
    ]);
    expect(calls).toContainEqual(['dispatchLs', { type: 'CONNECT', at: 100_000 }]);
    expect(calls).toContainEqual(['startLiveEgress', 'L1', true, '9:16']);
    expect(r.startStampRef.current).toBe(100_000);
    expect(r.egressIdRef.current).toBe('e2');
    // a host csúcs-nézőszáma; a chat a 80-as ablakkal
    const h = (globalThis as any).__h;
    calls.length = 0;
    h.onViewers(5);
    h.onReaction('🔥');
    h.onChat({ id: 'm', name: 'n', avatar: null, text: 'x', at: 1 });
    expect(calls.map((c) => c[0])).toEqual(['setViewers', 'bumpViewerPeak', 'addFloat', 'setChat']);
    expect(calls[1]).toEqual(['bumpViewerPeak', 'L1', 5]);
    cleanup();
    expect(calls.slice(-1)).toEqual([['room.stop']]);
    expect(r.roomRef.current).toBeNull();
  });
  it('nem létező adás → notFound; a getLive hibája az eredeti címkével', async () => {
    resp = { getLive: () => Promise.reject(new Error('net')) };
    const s = setters();
    openLiveSession({ id: 'L1', projectParam: undefined, ...refs(), ...s } as never);
    await flush();
    expect(calls).toEqual([['getLive', 'L1'], ['logCaught', 'app/live/[id].tsx:LiveRoomScreen', 'net'], ['setNotFound', true]]);
  });
  it('a cleanup a betöltés közben: a késő válasz már nem ír állapotot', async () => {
    let res: (v: unknown) => void = () => {};
    resp = { getLive: () => new Promise((r) => { res = r; }) };
    const s = setters();
    const cleanup = openLiveSession({ id: 'L1', projectParam: 'p1', ...refs(), ...s } as never);
    cleanup();
    res(SESSION);
    await flush();
    expect(calls).toEqual([['getLive', 'L1']]);
  });
});
