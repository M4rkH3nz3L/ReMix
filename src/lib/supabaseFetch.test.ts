import { setCaughtSink } from '@/lib/logCaught';
import { loggedSupabaseFetch } from '@/lib/supabaseFetch';

const response = (status: number, body = '') => ({ status, clone: () => ({ text: async () => body }) }) as unknown as Response;

describe('Supabase-kérések naplója', () => {
  const got: [string, string][] = [];
  beforeEach(() => {
    got.length = 0;
    setCaughtSink((e, where) => got.push([where, (e as Error).message]));
  });
  afterEach(() => setCaughtSink(null));

  it('a sikertelen válasz nyomot hagy, a lekérdezés nélkül', async () => {
    const f = loggedSupabaseFetch(async () => response(403, '{"message":"permission denied for table posts"}'));
    const res = await f('https://x.supabase.co/rest/v1/posts?user_id=eq.123', { method: 'PATCH' });
    expect(res.status).toBe(403);
    expect(got[0][0]).toBe('supabase:/rest/v1/posts');
    expect(got[0][1]).toContain('Supabase 403 PATCH');
    expect(got[0][1]).toContain('permission denied');
    expect(got[0][0]).not.toContain('123');
  });
  it('a sikeres válasz csendes', async () => {
    const f = loggedSupabaseFetch(async () => response(200));
    await f('https://x.supabase.co/rest/v1/posts');
    expect(got).toHaveLength(0);
  });
  it('a hálózati hiba továbbmegy a hívóhoz', async () => {
    const f = loggedSupabaseFetch(async () => {
      throw new Error('Network request failed');
    });
    await expect(f('https://x.supabase.co/a')).rejects.toThrow('Network');
  });
});
