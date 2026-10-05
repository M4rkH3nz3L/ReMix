import {
  createAliveGuard,
  createGenerationGuard,
  latestOnly,
  StaleResponseError,
} from '@/lib/asyncGuard';

describe('createGenerationGuard (audit §12.5)', () => {
  it('a friss token aktuális, a korábbi elavul', () => {
    const g = createGenerationGuard();
    const t1 = g.begin();
    expect(g.isCurrent(t1)).toBe(true);
    const t2 = g.begin();
    expect(g.isCurrent(t2)).toBe(true);
    expect(g.isCurrent(t1)).toBe(false); // t1 már elavult
  });

  it('cancel minden függőben lévő tokent elavulttá tesz', () => {
    const g = createGenerationGuard();
    const t1 = g.begin();
    g.cancel();
    expect(g.isCurrent(t1)).toBe(false);
  });

  it('cancel után egy új begin friss tokent ad', () => {
    const g = createGenerationGuard();
    g.begin();
    g.cancel();
    const t = g.begin();
    expect(g.isCurrent(t)).toBe(true);
  });

  it('tipikus minta: csak a legutolsó async válasz megy át', async () => {
    const g = createGenerationGuard();
    const applied: string[] = [];
    const load = async (q: string, delay: number) => {
      const token = g.begin();
      await new Promise((r) => setTimeout(r, delay));
      if (!g.isCurrent(token)) {
        return;
      }
      applied.push(q);
    };
    // a lassú 'a' ELŐBB indul, de KÉSŐBB ér be → el kell dobni; 'b' nyer
    await Promise.all([load('a', 30), load('b', 5)]);
    expect(applied).toEqual(['b']);
  });
});

describe('createAliveGuard', () => {
  it('kezdetben él, cancel után nem (idempotens)', () => {
    const g = createAliveGuard();
    expect(g.alive()).toBe(true);
    g.cancel();
    expect(g.alive()).toBe(false);
    g.cancel();
    expect(g.alive()).toBe(false);
  });

  it('a cancel utáni késői válasz eldobható', async () => {
    const g = createAliveGuard();
    let wrote = false;
    const p = Promise.resolve().then(() => {
      if (g.alive()) {
        wrote = true;
      }
    });
    g.cancel(); // „unmount" mielőtt a microtask lefut
    await p;
    expect(wrote).toBe(false);
  });
});

describe('latestOnly', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('a legfrissebb hívás nyer, a korábbi StaleResponseError-ral rejectel', async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const calls = [d1, d2];
    let i = 0;
    const wrapped = latestOnly(async () => calls[i++].promise);

    const p1 = wrapped();
    const p2 = wrapped();
    // a KORÁBBI (p1) resolve-ja fut be előbb, de már nem ő a legfrissebb
    d1.resolve('régi');
    d2.resolve('friss');

    await expect(p2).resolves.toBe('friss');
    await expect(p1).rejects.toBeInstanceOf(StaleResponseError);
  });

  it('egyetlen hívás normálisan feloldódik', async () => {
    const wrapped = latestOnly(async (x: number) => x * 2);
    await expect(wrapped(21)).resolves.toBe(42);
  });
});
