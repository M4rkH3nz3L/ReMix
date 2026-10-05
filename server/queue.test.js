// 💠 Tier-alapú render-sor prioritás (audit §2.6). A queue.js requireolható:
// a Redis-kapcsolat + a Queue lusta (csak connection()/renderQueue() hívásra épül).
const { tierJobPriority } = require('./queue');

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
