// 🎧 AUDIO-PROD S18: a csak-hang export (podcast, album) nem rövid videó — a 10 perces videó-plafon
// alól kivéve, a telefonos export 3 órás határával egyezően. A döntés pure (a route ezt hívja).
const { MAX_RENDER_DURATION_SEC, MAX_AUDIO_RENDER_DURATION_SEC, maxRenderSecFor } = require('./render');

describe('render hossz-plafon (videó 10 perc, csak-hang 3 óra)', () => {
  test('a videó plafonja 600 mp, a hangé legalább 3 óra (és sosem kisebb a videóénál)', () => {
    expect(MAX_RENDER_DURATION_SEC).toBe(600);
    expect(MAX_AUDIO_RENDER_DURATION_SEC).toBeGreaterThanOrEqual(10800);
    expect(MAX_AUDIO_RENDER_DURATION_SEC).toBeGreaterThanOrEqual(MAX_RENDER_DURATION_SEC);
  });

  test('csak-hang kérés (audioFormat) → a hang plafonja; videó / üres / hiányzó beállítás → a videóé', () => {
    expect(maxRenderSecFor({ audioFormat: 'wav' })).toBe(MAX_AUDIO_RENDER_DURATION_SEC);
    expect(maxRenderSecFor({ audioFormat: 'mp3', resolution: 480 })).toBe(MAX_AUDIO_RENDER_DURATION_SEC);
    expect(maxRenderSecFor({ resolution: 1080, quality: 'high' })).toBe(MAX_RENDER_DURATION_SEC);
    expect(maxRenderSecFor({})).toBe(MAX_RENDER_DURATION_SEC);
    expect(maxRenderSecFor(undefined)).toBe(MAX_RENDER_DURATION_SEC);
    // egy 60 perces podcast: hangként átmegy, videóként nem
    const podcastSec = 3600;
    expect(podcastSec > maxRenderSecFor({ audioFormat: 'wav' })).toBe(false);
    expect(podcastSec > maxRenderSecFor({})).toBe(true);
  });
});
