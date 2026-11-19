// 🛑 Render-sor: a várakozó job megszakítása és a sor-lista. Minden render-job PRIORITÁSSAL kerül a sorba
// (tier szerint 1–4), amit a BullMQ `prioritized` állapotban tart — nem `waiting`-ben. Hamis BullMQ-val.
let mockJobs;
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ set: jest.fn(async () => 'OK'), exists: jest.fn(async () => 0) })));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    getJob: async (id) => mockJobs.find((j) => j.id === id) || null,
    getActive: async () => mockJobs.filter((j) => j.state === 'active'),
    getWaiting: async () => mockJobs.filter((j) => j.state === 'waiting'),
    getPrioritized: async () => mockJobs.filter((j) => j.state === 'prioritized').sort((a, b) => a.opts.priority - b.opts.priority),
    getCompleted: async () => [],
    getFailed: async () => [],
  })),
}));

function job(id, state, priority = 2) {
  return { id, state, opts: { priority }, data: { userId: 'u1', projectId: 'p' }, timestamp: 1, getState: async () => state, remove: jest.fn(async () => {}) };
}

let queue;
beforeEach(() => {
  jest.resetModules();
  process.env.REDIS_URL = 'redis://localhost:6379';
  queue = require('./queue');
});
afterAll(() => {
  delete process.env.REDIS_URL;
});

test('a sorban várakozó (prioritized) render-job megszakítható', async () => {
  mockJobs = [job('j1', 'prioritized')];
  await expect(queue.cancelRenderJob('j1')).resolves.toEqual({ found: true, userId: 'u1', removed: true, active: false });
  expect(mockJobs[0].remove).toHaveBeenCalled();
});

test('waiting és delayed job is törlődik; a futó csak abort-jelzést kap', async () => {
  mockJobs = [job('w', 'waiting'), job('d', 'delayed'), job('a', 'active'), job('c', 'completed')];
  await expect(queue.cancelRenderJob('w')).resolves.toMatchObject({ removed: true });
  await expect(queue.cancelRenderJob('d')).resolves.toMatchObject({ removed: true });
  await expect(queue.cancelRenderJob('a')).resolves.toEqual({ found: true, userId: 'u1', removed: false, active: true });
  await expect(queue.cancelRenderJob('c')).resolves.toEqual({ found: true, userId: 'u1', removed: false, active: false });
  await expect(queue.cancelRenderJob('nincs')).resolves.toEqual({ found: false, userId: null, removed: false, active: false });
});

test('a sor-lista a prioritásos várakozókat is mutatja, feldolgozási sorrendben', async () => {
  mockJobs = [job('p3', 'prioritized', 3), job('p1', 'prioritized', 1), job('a', 'active')];
  const list = await queue.listRenderJobs();
  expect(list.active.map((j) => j.id)).toEqual(['a']);
  expect(list.waiting.map((j) => j.id)).toEqual(['p1', 'p3']);
  expect(list.waiting.every((j) => j.state === 'waiting')).toBe(true);
});
