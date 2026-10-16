// 💠 Tier-alapú render-sor prioritás (audit §2.6). A queue.js requireolható:
// a Redis-kapcsolat + a Queue lusta (csak connection()/renderQueue() hívásra épül).
const { tierJobPriority, renderJobOptions, workerOptions, renderConcurrency } = require('./queue');

describe('tierJobPriority — BullMQ sor-prioritás (kisebb = előbb fut)', () => {
  test('Ultra > Pro > Basic > Free (szigorúan csökkenő prioritás-szám)', () => {
    expect(tierJobPriority('ultra')).toBe(1);
    expect(tierJobPriority('pro')).toBe(2);
    expect(tierJobPriority('basic')).toBe(3);
    expect(tierJobPriority('free')).toBe(4);
    // rangsor: ultra a legkisebb szám (leghamarabb fut), free a legnagyobb
    expect(tierJobPriority('ultra')).toBeLessThan(tierJobPriority('pro'));
    expect(tierJobPriority('pro')).toBeLessThan(tierJobPriority('basic'));
    expect(tierJobPriority('basic')).toBeLessThan(tierJobPriority('free'));
  });

  test('ismeretlen / hiányzó szint → free (legalacsonyabb prioritás)', () => {
    expect(tierJobPriority(undefined)).toBe(4);
    expect(tierJobPriority(null)).toBe(4);
    expect(tierJobPriority('enterprise')).toBe(4);
    expect(tierJobPriority('')).toBe(4);
  });
});

describe('renderJobOptions — enqueue idempotencia + retry/backoff (02-render §02.3)', () => {
  test('a jobId determinisztikusan átmegy (idempotencia: ugyanaz az id → ugyanaz a slot)', () => {
    expect(renderJobOptions('job-abc', {}).jobId).toBe('job-abc');
    // ugyanaz az input → ugyanaz az opció-objektum (nincs véletlen-komponens)
    expect(renderJobOptions('job-abc', { tier: 'pro' })).toEqual(renderJobOptions('job-abc', { tier: 'pro' }));
  });

  test('retry: attempts 2 + fix 3 s backoff (tranziens S3/hálózat-hibára)', () => {
    const o = renderJobOptions('j', {});
    expect(o.attempts).toBe(2);
    expect(o.backoff).toEqual({ type: 'fixed', delay: 3000 });
  });

  test('a lezárt jobok ~1 óra után kikerülnek (removeOnComplete/Fail age 3600)', () => {
    const o = renderJobOptions('j', {});
    expect(o.removeOnComplete).toEqual({ age: 3600, count: 200 });
    expect(o.removeOnFail).toEqual({ age: 3600, count: 200 });
  });

  test('a prioritás a tier-ből jön (ultra=1 … free=4)', () => {
    expect(renderJobOptions('j', { tier: 'ultra' }).priority).toBe(1);
    expect(renderJobOptions('j', { tier: 'free' }).priority).toBe(4);
    expect(renderJobOptions('j', {}).priority).toBe(4); // tier nélkül → free
  });
});

describe('workerOptions — crash-recovery (stalled-job) + concurrency (02-render §02.4/§02.5)', () => {
  const OLD = process.env.RENDER_CONCURRENCY;
  afterEach(() => {
    if (OLD === undefined) {
      delete process.env.RENDER_CONCURRENCY;
    } else {
      process.env.RENDER_CONCURRENCY = OLD;
    }
  });

  test('crash-recovery: lockDuration + stalledInterval + maxStalledCount ép (a crash-elt worker lockja lejár → stalled→waiting)', () => {
    const o = workerOptions();
    expect(o.lockDuration).toBeGreaterThanOrEqual(o.stalledInterval); // a lock tovább él, mint a sweep-periódus
    expect(o.stalledInterval).toBeGreaterThan(0);
    expect(o.maxStalledCount).toBe(1); // 1 újra-vétel crash után, utána failed (poison-védelem)
  });

  test('concurrency = renderConcurrency() (RENDER_CONCURRENCY env tükre, min 1)', () => {
    delete process.env.RENDER_CONCURRENCY;
    expect(workerOptions().concurrency).toBe(renderConcurrency());
    process.env.RENDER_CONCURRENCY = '4';
    expect(workerOptions().concurrency).toBe(4);
    process.env.RENDER_CONCURRENCY = '0';
    expect(workerOptions().concurrency).toBe(1); // min 1 (sosem 0 szál)
  });
});
