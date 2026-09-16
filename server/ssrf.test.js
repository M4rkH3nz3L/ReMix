const { assertSafeAiBaseUrl, hostAllowed, isPrivateAddress } = require('./ssrf');

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
});
