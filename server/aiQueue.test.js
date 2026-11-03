// 🧠 Kapacitás-sor (C5.3): párhuzamossági korlát, prioritás, túlterhelés.
const { createAiQueue, AiOverloadedError } = require('./aiQueue');

const deferred = () => {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
};

test('legfeljebb `concurrency` fut egyszerre, a Vállalati/Profi előzi az Amatőrt', async () => {
  const q = createAiQueue({ concurrency: 1, maxQueue: 10 });
  const order = [];
  const gate = deferred();
  const first = q.run('basic', async () => { order.push('first'); await gate.p; });
  const a = q.run('basic', async () => order.push('basic'));
  const b = q.run('pro', async () => order.push('pro'));
  const c = q.run('business', async () => order.push('business'));
  const d = q.run('ultra', async () => order.push('ultra'));
  expect(q.stats()).toMatchObject({ active: 1, waiting: 4 });
  gate.resolve();
  await Promise.all([first, a, b, c, d]);
  expect(order).toEqual(['first', 'business', 'ultra', 'basic', 'pro']);
  expect(q.stats()).toMatchObject({ active: 0, waiting: 0 });
});

test('tele sor → AiOverloadedError azonnal, becsült várakozással és a felajánlott kerülőutakkal', async () => {
  const q = createAiQueue({ concurrency: 1, maxQueue: 1, avgMs: 10000 });
  const gate = deferred();
  const running = q.run('basic', () => gate.p);
  const queued = q.run('basic', async () => 'ok');
  await expect(q.run('basic', async () => 'x')).rejects.toMatchObject({
    message: 'ai_overloaded', status: 503, payload: { etaSec: 20, fallback: ['on_device', 'byok'] },
  });
  gate.resolve();
  await expect(queued).resolves.toBe('ok');
  await running;
});

test('a hibás feladat is felszabadítja a helyet', async () => {
  const q = createAiQueue({ concurrency: 1 });
  await expect(q.run('pro', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  await expect(q.run('pro', async () => 1)).resolves.toBe(1);
  expect(AiOverloadedError).toBeDefined();
});
