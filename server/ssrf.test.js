const {
  assertSafeAiBaseUrl,
  assertSafeUrl,
  safeFetch,
  hostAllowed,
  isPrivateAddress,
} = require('./ssrf');

describe('ssrf — BYOK AI-végpont védelem', () => {
  describe('isPrivateAddress', () => {
    it.each([
      ['169.254.169.254', 'felhő-metaadat'],
      ['10.1.2.3', '10/8'],
      ['172.16.0.1', '172.16/12'],
      ['192.168.1.1', '192.168/16'],
      ['127.0.0.1', 'loopback'],
      ['100.64.0.1', 'CGNAT'],
      ['::1', 'IPv6 loopback'],
      ['fd00::1', 'IPv6 unique-local'],
      ['fe80::1', 'IPv6 link-local'],
    ])('privátnak ismeri fel: %s (%s)', (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
      ['8.8.8.8'],
      ['1.1.1.1'],
      ['172.32.0.1'], // a 172.16/12 tartományon KÍVÜL
      ['2606:4700::1111'],
    ])('publikusnak ismeri fel: %s', (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    });
  });

  describe('hostAllowed', () => {
    it('ismert szolgáltatót és al-domainjét engedi', () => {
      expect(hostAllowed('api.openai.com')).toBe(true);
      expect(hostAllowed('eu.api.openai.com')).toBe(true);
    });
    it('⚠️ al-domain-HAMISÍTÁST nem enged át', () => {
      expect(hostAllowed('api.openai.com.evil.com')).toBe(false);
      expect(hostAllowed('evil.com')).toBe(false);
    });
  });

  describe('assertSafeAiBaseUrl — támadási célpontok', () => {
    it.each([
      ['http://169.254.169.254/latest/meta-data/', 'felhő-metaadat'],
      ['https://169.254.169.254/', 'metaadat https-en'],
      ['https://10.0.0.5:8080', 'belső 10/8'],
      ['https://192.168.1.1', 'belső 192.168'],
      ['https://172.20.0.1', 'belső 172.16/12'],
      ['https://localhost:11434', 'localhost'],
      ['https://127.0.0.1:8787', 'loopback IP'],
      ['file:///etc/passwd', 'file séma'],
      ['gopher://127.0.0.1:11211', 'gopher séma'],
      ['https://evil.example.com/v1', 'nem-allowlistás hoszt'],
      ['http://api.openai.com/v1', 'ismert hoszt, de HTTP'],
      ['nem-egy-url', 'érvénytelen URL'],
    ])('BLOKKOLJA: %s (%s)', async (url) => {
      const r = await assertSafeAiBaseUrl(url);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe('string');
    });

    it.each([
      ['https://api.openai.com/v1', 'OpenAI'],
      ['https://api.anthropic.com/v1', 'Anthropic'],
      ['https://openrouter.ai/api/v1', 'OpenRouter'],
      ['https://api.groq.com/openai/v1', 'Groq'],
    ])('ENGEDI: %s (%s)', async (url) => {
      const r = await assertSafeAiBaseUrl(url);
      expect(r.ok).toBe(true);
    });
  });

  // 04 — általános remote-fetch (WebDAV/S3/import): NINCS host-allowlist, de a
  // privát/metadata IP és a nem-http(s) séma tiltott. Determinisztikus: literal
  // IP / localhost (nem függ hálózati DNS-től).
  describe('assertSafeUrl — user-vezérelt remote URL', () => {
    it.each([
      ['http://169.254.169.254/latest/meta-data/', 'felhő-metaadat'],
      ['https://169.254.169.254/', 'metaadat https'],
      ['https://10.0.0.5:9000/bucket', 'belső 10/8 (MinIO)'],
      ['https://192.168.1.10/dav', 'belső 192.168 (NAS)'],
      ['https://172.20.0.1/', 'belső 172.16/12'],
      ['https://127.0.0.1:8787/', 'loopback IP'],
      ['https://localhost/dav', 'localhost név (→127.0.0.1)'],
      ['file:///etc/passwd', 'file séma'],
      ['ftp://10.0.0.1/x', 'ftp séma'],
      ['http://8.8.8.8/x', 'publikus IP, de HTTP (prod: csak https)'],
      ['nem-url', 'érvénytelen URL'],
    ])('BLOKKOLJA: %s (%s)', async (url) => {
      const r = await assertSafeUrl(url);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe('string');
    });

    it.each([
      ['https://8.8.8.8/bucket/file.mp4', 'publikus IP https'],
      ['https://1.1.1.1/dav/clip.mov', 'publikus IP https (2)'],
    ])('ENGEDI: %s (%s)', async (url) => {
      const r = await assertSafeUrl(url);
      expect(r.ok).toBe(true);
    });

    it('allowHttp:true esetén a publikus HTTP is átmegy', async () => {
      const r = await assertSafeUrl('http://8.8.8.8/x', { allowHttp: true });
      expect(r.ok).toBe(true);
    });
  });

  describe('safeFetch — assert + fetch', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('SSRF-blokknál DOB (ssrfBlocked) és NEM hív fetch-et', async () => {
      global.fetch = jest.fn();
      await expect(safeFetch('http://169.254.169.254/')).rejects.toMatchObject({
        ssrfBlocked: true,
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('engedett URL-nél meghívja a fetch-et', async () => {
      global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
      const res = await safeFetch('https://8.8.8.8/file.mp4', { method: 'GET' });
      expect(res.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('https://8.8.8.8/file.mp4', { method: 'GET' });
    });
  });
});
