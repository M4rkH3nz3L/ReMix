import {
  fetchRead,
  isAbortError,
  isRetryableStatus,
  readJson,
  retryAfterMs,
  retryRead,
  TimeoutError,
} from '@/lib/netRetry';

/** azonnali „alvás", hogy a teszt ne várjon valós backoffot */
const noSleep = () => Promise.resolve();

const res = (status: number, headers: Record<string, string> = {}) =>
  ({
    status,
    ok: status < 400,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  }) as unknown as Response;

describe('netRetry — újrapróbálkozás CSAK idempotens olvasásra', () => {
  describe('mit tekintünk múlékony hibának', () => {
    it('5xx, 408, 425, 429 → újrapróbálható', () => {
      [408, 425, 429, 500, 502, 503, 504].forEach((s) =>
        expect(isRetryableStatus(s)).toBe(true)
      );
    });

    it('a 4xx NEM (a kérés hibás — ismétléstől nem javul)', () => {
      [400, 401, 403, 404, 409, 422].forEach((s) => expect(isRetryableStatus(s)).toBe(false));
    });

    it('a siker sem', () => {
      [200, 201, 204, 304].forEach((s) => expect(isRetryableStatus(s)).toBe(false));
    });
  });

  describe('retryRead', () => {
    it('elsőre sikerül → PONTOSAN egy hívás (nincs rejtett extra kérés)', async () => {
      const run = jest.fn().mockResolvedValue(res(200));
      await retryRead(run, { sleep: noSleep });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('hálózati hiba után a második próbálkozás átmegy', async () => {
      const run = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('Network request failed'))
        .mockResolvedValueOnce(res(200));
      const out = await retryRead(run, { sleep: noSleep });
      expect(out.status).toBe(200);
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('503 után újrapróbál', async () => {
      const run = jest.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
      expect((await retryRead(run, { sleep: noSleep })).status).toBe(200);
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('404-nél NEM próbál újra, és a választ VÁLTOZATLANUL adja vissza', async () => {
      const run = jest.fn().mockResolvedValue(res(404));
      const out = await retryRead(run, { sleep: noSleep });
      expect(out.status).toBe(404); // a hívó ugyanazt látja, mintha nem lenne retry
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('alapból legfeljebb KETTŐ próbálkozás (nem ostromolja a szervert)', async () => {
      const run = jest.fn().mockResolvedValue(res(500));
      const out = await retryRead(run, { sleep: noSleep });
      expect(out.status).toBe(500); // a végén az utolsó választ kapjuk vissza
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('tartós hálózati hiba → az EREDETI hibát dobja (nem nyeli el)', async () => {
      const boom = new TypeError('Network request failed');
      const run = jest.fn().mockRejectedValue(boom);
      await expect(retryRead(run, { sleep: noSleep })).rejects.toBe(boom);
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('ABORT-nál azonnal feladja — a megszakítás a felhasználó döntése', async () => {
      const run = jest.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
      await expect(retryRead(run, { sleep: noSleep })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('már megszakított jellel EL SEM indul', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const run = jest.fn();
      await expect(retryRead(run, { sleep: noSleep, signal: ctrl.signal })).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    });

    it('a próbálkozások száma felülírható', async () => {
      const run = jest.fn().mockResolvedValue(res(502));
      await retryRead(run, { sleep: noSleep, attempts: 4 });
      expect(run).toHaveBeenCalledTimes(4);
    });

    it('a backoff NÖVEKVŐ (nem fix), és nem nulla', async () => {
      const waits: number[] = [];
      const run = jest.fn().mockResolvedValue(res(500));
      await retryRead(run, { attempts: 4, sleep: (ms) => (waits.push(ms), Promise.resolve()) });
      expect(waits).toHaveLength(3);
      expect(waits[0]).toBeGreaterThan(0);
      expect(waits[2]).toBeGreaterThan(waits[0]); // exponenciális, szórással
    });
  });

  describe('Retry-After — a szerver tudja jobban, mikor ér rá', () => {
    it('másodperc-formát ért', () => {
      expect(retryAfterMs(res(429, { 'retry-after': '2' }))).toBe(2000);
    });

    it('nincs fejléc → null (marad a saját backoff)', () => {
      expect(retryAfterMs(res(429))).toBeNull();
    });

    it('értelmetlen értéket eldob', () => {
      expect(retryAfterMs(res(429, { 'retry-after': 'holnap' }))).toBeNull();
    });

    it('irreálisan hosszú várakozást eldob (nem fagyasztjuk le a UI-t)', () => {
      expect(retryAfterMs(res(503, { 'retry-after': '3600' }))).toBeNull();
    });

    it('a 429 tényleg a szerver kért idejét várja ki', async () => {
      const waits: number[] = [];
      const run = jest
        .fn()
        .mockResolvedValueOnce(res(429, { 'retry-after': '1' }))
        .mockResolvedValueOnce(res(200));
      await retryRead(run, { sleep: (ms) => (waits.push(ms), Promise.resolve()) });
      expect(waits).toEqual([1000]);
    });
  });

  describe('fetchRead — timeout ≠ felhasználói megszakítás', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    it('az IDŐTÚLLÉPÉS újrapróbálható (ez a retry létezésének oka)', async () => {
      let call = 0;
      globalThis.fetch = jest.fn((_u: unknown, init: { signal?: AbortSignal } = {}) => {
        call += 1;
        if (call === 1) {
          // sosem válaszol → a belső timeout megszakítja
          return new Promise((_ok, fail) => {
            init.signal?.addEventListener('abort', () =>
              fail(new DOMException('Aborted', 'AbortError'))
            );
          });
        }
        return Promise.resolve(res(200));
      }) as never;

      const out = await fetchRead('http://x/health', { timeoutMs: 10 }, { sleep: noSleep });
      expect(out.status).toBe(200);
      expect(call).toBe(2);
    });

    it('a timeout saját hibatípust kap, ha minden próbálkozás lejár', async () => {
      globalThis.fetch = jest.fn((_u: unknown, init: { signal?: AbortSignal } = {}) =>
        new Promise((_ok, fail) => {
          init.signal?.addEventListener('abort', () =>
            fail(new DOMException('Aborted', 'AbortError'))
          );
        })
      ) as never;

      await expect(
        fetchRead('http://x/health', { timeoutMs: 10 }, { sleep: noSleep })
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    it('a HÍVÓ megszakítása viszont végleges — nincs második kérés', async () => {
      const ctrl = new AbortController();
      globalThis.fetch = jest.fn((_u: unknown, init: { signal?: AbortSignal } = {}) =>
        new Promise((_ok, fail) => {
          init.signal?.addEventListener('abort', () =>
            fail(new DOMException('Aborted', 'AbortError'))
          );
        })
      ) as never;

      const p = fetchRead(
        'http://x/health',
        { timeoutMs: 5000, signal: ctrl.signal },
        { sleep: noSleep }
      );
      ctrl.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });


  describe('readJson — a proxy HTML-je ne „JSON Parse error" legyen', () => {
    const resWith = (status: number, text: string) =>
      ({ status, ok: status < 400, text: () => Promise.resolve(text) }) as unknown as Response;

    it('érvényes JSON-t normálisan visszaad', async () => {
      await expect(readJson(resWith(200, '{"id":"abc"}'), 'hiba')).resolves.toEqual({ id: 'abc' });
    });

    it('502 + HTML-hibaoldal → a HÍVÓ üzenete, nem parse-hiba', async () => {
      const html = '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>';
      await expect(readJson(resWith(502, html), 'A render indítása nem sikerült.')).rejects.toThrow(
        'A render indítása nem sikerült. (HTTP 502)'
      );
    });

    it('a nyers HTML-t SOHA nem mutatja meg', async () => {
      const html = '<html><script>alert(1)</script></html>';
      await expect(readJson(resWith(500, html), 'hiba')).rejects.toThrow(
        expect.not.stringContaining('<')
      );
    });

    it('Cloudflare-ellenőrzés (200 + HTML) is beszédes hibát ad', async () => {
      await expect(readJson(resWith(200, '<html>Just a moment…</html>'), 'baj')).rejects.toThrow(
        'baj (HTTP 200)'
      );
    });

    it('204 No Content → üres objektum (a `body.x ?? alap` minta működjön)', async () => {
      await expect(readJson(resWith(204, ''), 'hiba')).resolves.toEqual({});
    });

    it('üres törzs HIBA-státusszal viszont dob', async () => {
      await expect(readJson(resWith(503, ''), 'nem elérhető')).rejects.toThrow(
        'nem elérhető (HTTP 503)'
      );
    });

    it('a szerver saját JSON-hibáját ÉRINTETLENÜL adja tovább (a hívó olvassa ki)', async () => {
      const body = await readJson<{ error?: string }>(
        resWith(400, '{"error":"a projekt túl hosszú"}'),
        'általános'
      );
      expect(body.error).toBe('a projekt túl hosszú');
    });
  });

  it('isAbortError felismeri a DOMException-t és a natív RN-hibát is', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('The operation was aborted'))).toBe(true);
    expect(isAbortError(new TypeError('Network request failed'))).toBe(false);
  });
});
