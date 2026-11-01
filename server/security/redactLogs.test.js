const { redactSecrets } = require('./redact');

describe('a naplózott hibaüzenet nem szivárogtat', () => {
  it.each([
    ['Authorization: Bearer abc123titok', 'abc123titok'],
    ['fetch failed eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk', 'eyJzdWIi'],
    ['kulcs sk-ant-api03-AbCdEfGhIjKlMnOp', 'AbCdEfGh'],
    ['GET /x?access_token=titkos123&a=1', 'titkos123'],
    ['{"password":"jelszo12"}', 'jelszo12'],
    ['api_key=abc-def', 'abc-def'],
    ['user h3nz3l@gmail.com failed', 'h3nz3l@gmail.com'],
  ])('%s', (input, secret) => {
    expect(redactSecrets(input)).not.toContain(secret);
  });
  it('a hibakereséshez kellő szöveg megmarad', () => {
    const msg = 'TypeError: Network request failed at render line 42';
    expect(redactSecrets(msg)).toBe(msg);
  });
});

describe('Supabase-kérések naplója a workerben', () => {
  it('a sikertelen választ átengedi, a sikeres csendes', async () => {
    const { loggedFetch } = require('../lib/caught');
    const bad = { status: 500, clone: () => ({ text: async () => 'x' }) };
    await expect(loggedFetch(async () => bad)('https://x.supabase.co/rest/v1/a?b=1')).resolves.toBe(bad);
    const ok = { status: 200 };
    await expect(loggedFetch(async () => ok)('https://x.supabase.co/rest/v1/a')).resolves.toBe(ok);
  });
});
