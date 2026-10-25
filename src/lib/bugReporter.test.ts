import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetBugReporterForTests,
  addBreadcrumb,
  flushBugQueue,
  installGlobalBugHandlers,
  reportBug,
  setBugEditorContextProvider,
  setBugRoute,
  setBugSignedIn,
} from '@/lib/bugReporter';

/**
 * 🐞 A hibajelentő KÉZBESÍTÉSI GARANCIÁI + SZERVER-KÍMÉLÉSE (mockolt hálózattal
 * + memória-AsyncStorage-dzsel): nem vész el jelentés (hálózati hiba, egyidejű
 * jelentés+ürítés, fatális crash), a sor kötegekben ürül, hiba után visszalép
 * (nincs hálózati kísérlet a bajban lévő szerver felé), a Retry-After-t tiszteli.
 */

jest.mock('@/lib/backend', () => ({ cloudBaseUrl: () => 'http://worker.test' }));
jest.mock('@/lib/workerAuth', () => ({ workerAuthHeaders: async () => ({}) }));

const QUEUE_KEY = 'remix.bugQueue.v1';
const fetchMock = jest.fn();

type Store = Map<string, string>;
const store = (AsyncStorage as unknown as { __store: Store }).__store;

async function queue(): Promise<Record<string, unknown>[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];
}

/** a kérések teste: { items: [...] } */
function requests(): Record<string, unknown>[][] {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body).items);
}
function sentItems(): Record<string, unknown>[] {
  return requests().flat();
}

function respond(status: number, retryAfter: string | null = null) {
  return () =>
    Promise.resolve({
      status,
      headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? retryAfter : null) },
    } as unknown as Response);
}
const ok = respond(200);
function offline() {
  return Promise.reject(new TypeError('Network request failed'));
}

let now = 1_761_400_000_000;

beforeEach(() => {
  __resetBugReporterForTests();
  store.clear();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  now += 24 * 60 * 60_000; // minden teszt friss ablakban
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // determinista jitter
  setBugEditorContextProvider(() => ({ projectId: 'prj_test', recent: ['user:SPLIT_CLIP'] }));
  setBugSignedIn(true);
});

afterEach(() => {
  __resetBugReporterForTests(); // a függő újrapróba-időzítő is törlődik
  jest.restoreAllMocks();
});

describe('reportBug — alap kézbesítés', () => {
  it('siker: EGY kötegelt POST a /bugs-ra, teljes kontextussal', async () => {
    fetchMock.mockImplementation(ok);
    setBugRoute('/editor/prj_test');
    addBreadcrumb('render: local 1080p');
    const res = await reportBug(new TypeError('rossz típus'), { kind: 'handled', extra: { where: 'renderLocal' } });
    expect(res).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://worker.test/bugs');
    const body = sentItems()[0];
    expect(body).toMatchObject({
      kind: 'handled',
      name: 'TypeError',
      message: 'rossz típus',
      route: '/editor/prj_test',
      projectId: 'prj_test',
      repeat: 1,
    });
    expect(typeof body.qid).toBe('string');
    expect((body.breadcrumbs as string[]).join('\n')).toContain('render: local 1080p');
    expect((body.breadcrumbs as string[]).join('\n')).toContain('user:SPLIT_CLIP');
    expect((body.extra as Record<string, unknown>).where).toBe('renderLocal');
    expect((body.extra as Record<string, unknown>).signedIn).toBe(true);
    expect(await queue()).toEqual([]);
  });

  it('a kontextus-szolgáltató hibája / hiánya nem akasztja meg a jelentést', async () => {
    fetchMock.mockImplementation(ok);
    setBugEditorContextProvider(() => {
      throw new Error('store nem elérhető');
    });
    expect(await reportBug(new Error('provider-hiba'))).toBe('sent');
    setBugEditorContextProvider(null);
    expect(await reportBug(new Error('nincs-provider'))).toBe('sent');
    expect(sentItems().map((b) => b.projectId)).toEqual(['', '']);
  });

  it('hálózati hiba → sorba; a visszalépés lejárta után az ürítés kézbesíti, ugyanazzal a qid-del', async () => {
    fetchMock.mockImplementation(offline);
    expect(await reportBug(new Error('offline-hiba'))).toBe('queued');
    const q = await queue();
    expect(q).toHaveLength(1);

    fetchMock.mockImplementation(ok);
    now += 10 * 60_000; // a visszalépés letelt
    await flushBugQueue();
    expect(await queue()).toEqual([]);
    expect(sentItems().at(-1)!.qid).toBe(q[0].qid); // a szerver így szűri a duplikátumot
  });

  it('végleges elutasítás (4xx) → nem kerül vissza a sorba (újraküldve is bukna)', async () => {
    fetchMock.mockImplementation(respond(400));
    expect(await reportBug(new Error('rossz-jelentés'))).toBe('sent');
    expect(await queue()).toEqual([]);
  });

  it('throttle: ugyanaz a hiba egyre ritkábban megy, de a következő a számot viszi', async () => {
    fetchMock.mockImplementation(ok);
    expect(await reportBug(new Error('ciklus-hiba (clip_aaaa11)'))).toBe('sent');
    expect(await reportBug(new Error('ciklus-hiba (clip_bbbb22)'))).toBe('throttled');
    expect(await reportBug(new Error('ciklus-hiba (clip_cccc33)'))).toBe('throttled');
    now += 61_000;
    expect(await reportBug(new Error('ciklus-hiba (clip_dddd44)'))).toBe('sent');
    now += 61_000; // a 2. küldés után már 5 perces az ablak
    expect(await reportBug(new Error('ciklus-hiba (clip_eeee55)'))).toBe('throttled');
    expect(sentItems().map((b) => b.repeat)).toEqual([1, 3]);
  });
});

describe('szerver-kímélés', () => {
  it('a sor KÖTEGEKBEN ürül: 25 várakozó jelentés = 2 kérés (20 + 5), nem 25', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ qid: `q${i}aaaa`, message: `m${i}` }));
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    fetchMock.mockImplementation(ok);
    await flushBugQueue();
    expect(requests().map((r) => r.length)).toEqual([20, 5]);
    expect(await queue()).toEqual([]);
  });

  it('hiba után VISSZALÉP: a bajban lévő szerver felé nincs újabb kísérlet, az új jelentés csak sorba kerül', async () => {
    fetchMock.mockImplementation(respond(503));
    expect(await reportBug(new Error('első'))).toBe('queued');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await reportBug(new Error('második'))).toBe('queued');
    expect(await reportBug(new Error('harmadik'))).toBe('queued');
    await flushBugQueue(); // előtérbe lépés is csak ennyi
    expect(fetchMock).toHaveBeenCalledTimes(1); // nincs több kérés a visszalépés alatt
    expect(await queue()).toHaveLength(3);

    // a visszalépés után EGY köteggel megy ki mind
    fetchMock.mockImplementation(ok);
    now += 31_000;
    await flushBugQueue();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requests()[1].map((x) => x.message)).toEqual(['első', 'második', 'harmadik']);
    expect(await queue()).toEqual([]);
  });

  it('a szerver Retry-After-jét tiszteli (ha hosszabb a saját visszalépésnél)', async () => {
    fetchMock.mockImplementation(respond(503, '120'));
    await reportBug(new Error('terhelt-szerver'));
    fetchMock.mockImplementation(ok);
    now += 60_000; // a saját 30 mp-es visszalépés letelt, de a szerver 120 mp-et kért
    await flushBugQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 61_000;
    await flushBugQueue();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await queue()).toEqual([]);
  });

  it('egymás utáni hibáknál a visszalépés exponenciálisan nő (30 mp → 60 mp)', async () => {
    fetchMock.mockImplementation(offline);
    await reportBug(new Error('x1'));
    now += 31_000;
    await flushBugQueue(); // 2. hiba → 60 mp visszalépés
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now += 40_000;
    await flushBugQueue(); // még a 60 mp-en belül
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now += 21_000;
    await flushBugQueue();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('sor-zár — egyidejű jelentés és ürítés', () => {
  it('ürítés KÖZBEN érkező új jelentés NEM vész el (és a kézbesített kikerül)', async () => {
    fetchMock.mockImplementation(offline);
    await reportBug(new Error('régi-hiba'));
    const [old] = await queue();
    now += 10 * 60_000;

    // lassú kézbesítés a régire; közben egy új jelentés érkezik
    let releaseOld!: () => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOld = () => resolve({ status: 200, headers: { get: () => null } } as unknown as Response);
        }),
    );
    fetchMock.mockImplementation(offline); // az új köteg már nem megy át
    const flushing = flushBugQueue();
    await new Promise((r) => setTimeout(r, 0));
    const pending = reportBug(new Error('új-hiba'));
    await new Promise((r) => setTimeout(r, 0));
    releaseOld();
    await flushing;
    expect(await pending).toBe('queued');
    const q = await queue();
    expect(q.map((x) => x.message)).toEqual(['új-hiba']); // a régi kézbesítve, az új megvan
    expect(q.find((x) => x.qid === old.qid)).toBeUndefined();
  });

  it('két egyidejű ürítés nem küldi kétszer ugyanazt', async () => {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([{ qid: 'once0001', message: 'egyszer' }]));
    fetchMock.mockImplementation(ok);
    await Promise.all([flushBugQueue(), flushBugQueue(), flushBugQueue()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await queue()).toEqual([]);
  });

  it('a régi formátumú (qid nélküli) sor-elem is kikerül kézbesítés után (nincs végtelen újraküldés)', async () => {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([{ message: 'régi formátum', kind: 'js-error' }]));
    fetchMock.mockImplementation(ok);
    await flushBugQueue();
    expect(await queue()).toEqual([]);
    await flushBugQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('globális kezelők', () => {
  interface FakeErrorUtils {
    handler: (e: unknown, isFatal?: boolean) => void;
    getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void;
    setGlobalHandler: jest.Mock;
  }

  function fakeErrorUtils(prev: jest.Mock): FakeErrorUtils {
    const eu: FakeErrorUtils = {
      handler: prev,
      getGlobalHandler: () => eu.handler,
      setGlobalHandler: jest.fn((h) => {
        eu.handler = h;
      }),
    };
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = eu;
    return eu;
  }

  afterEach(() => {
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  });

  it('FATÁLIS hiba: az eredeti kezelő (crash) csak a jelentés LEMEZRE ÍRÁSA UTÁN fut', async () => {
    fetchMock.mockImplementation(offline);
    const prev = jest.fn();
    const eu = fakeErrorUtils(prev);
    installGlobalBugHandlers();

    let queuedWhenPrevRan: Record<string, unknown>[] | null = null;
    prev.mockImplementation(() => {
      queuedWhenPrevRan = JSON.parse(store.get(QUEUE_KEY) ?? '[]');
    });
    eu.handler(new Error('végzetes'), true);
    expect(prev).not.toHaveBeenCalled(); // még nem — előbb lemezre
    await new Promise((r) => setTimeout(r, 50));
    expect(prev).toHaveBeenCalledWith(expect.any(Error), true);
    expect(queuedWhenPrevRan!.map((x) => x.message)).toEqual(['végzetes']);
    expect(queuedWhenPrevRan![0].kind).toBe('js-fatal');
  });

  it('nem-fatális hiba: jelentés + az eredeti kezelő azonnal fut', async () => {
    fetchMock.mockImplementation(ok);
    const prev = jest.fn();
    const eu = fakeErrorUtils(prev);
    installGlobalBugHandlers();
    eu.handler(new Error('soft'), false);
    expect(prev).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(sentItems().some((b) => b.message === 'soft' && b.kind === 'js-error')).toBe(true);
  });

  it('dupla telepítés (Fast Refresh) → a kezelő csak egyszer csomagolódik', () => {
    const eu = fakeErrorUtils(jest.fn());
    installGlobalBugHandlers();
    installGlobalBugHandlers();
    expect(eu.setGlobalHandler).toHaveBeenCalledTimes(1);
  });
});
