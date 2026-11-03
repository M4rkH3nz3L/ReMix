import { AiOverloadedError, aiPostJson } from '@/lib/aiFetch';

jest.mock('@/lib/workerAuth', () => ({ workerAuthHeaders: async () => ({}) }));

describe('aiPostJson — a saját AI túlterhelése (C5.3)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('503 ai_overloaded → AiOverloadedError a becsült várakozással', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'ai_overloaded', etaSec: 42 }) })) as never;
    const err = (await aiPostJson('http://w/ai/x', {}, 'hiba').catch((e: unknown) => e)) as AiOverloadedError;
    expect(err).toBeInstanceOf(AiOverloadedError);
    expect(err.etaSec).toBe(42);
  });

  it('más hiba → a szerver üzenete', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'valami' }) })) as never;
    await expect(aiPostJson('http://w/ai/x', {}, 'hiba')).rejects.toThrow('valami');
  });
});
