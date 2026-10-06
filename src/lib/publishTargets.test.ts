import {
  PLATFORM_SPECS,
  PUBLISH_PLATFORMS,
  adaptAll,
  adaptForPlatform,
  normalizeHashtag,
  normalizeHashtags,
} from '@/lib/publishTargets';

describe('normalizeHashtag', () => {
  it('egyetlen vezető # + alfanumerikus/_ marad', () => {
    expect(normalizeHashtag('#Hello')).toBe('#Hello');
    expect(normalizeHashtag('hello')).toBe('#hello');
    expect(normalizeHashtag('##multi')).toBe('#multi');
    expect(normalizeHashtag('with spaces!')).toBe('#withspaces');
    expect(normalizeHashtag('a_b-c')).toBe('#a_bc');
  });
  it('unicode betűt megtart', () => {
    expect(normalizeHashtag('kávé')).toBe('#kávé');
  });
  it('üres / csak-szimbólum → null', () => {
    expect(normalizeHashtag('###')).toBeNull();
    expect(normalizeHashtag('   ')).toBeNull();
    expect(normalizeHashtag('!!!')).toBeNull();
  });
});

describe('normalizeHashtags — dedup (case-insensitive)', () => {
  it('az első előfordulás nyer, a kis-nagybetűs duplikátum kiesik', () => {
    expect(normalizeHashtags(['#Tag', '#tag', 'other', '#OTHER'])).toEqual(['#Tag', '#other']);
  });
  it('undefined → []', () => {
    expect(normalizeHashtags(undefined)).toEqual([]);
  });
});

describe('adaptForPlatform — YouTube (külön cím-mező)', () => {
  it('a cím külön marad, a hashtagek a leírásba kerülnek', () => {
    const v = adaptForPlatform(
      { title: 'My Video', description: 'Hello', hashtags: ['#a', '#b'], aspectRatio: '9:16', durationSec: 30 },
      'youtube'
    );
    expect(v.title).toBe('My Video');
    expect(v.description).toBe('Hello\n\n#a #b');
    expect(v.hashtags).toEqual(['#a', '#b']);
    expect(v.warnings).toEqual([]);
  });

  it('a 100-nál hosszabb címet vágja + jelzi', () => {
    const v = adaptForPlatform({ title: 'x'.repeat(150) }, 'youtube');
    expect(v.title).toHaveLength(100);
    expect(v.warnings.find((w) => w.code === 'titleTruncated')?.detail).toBe('150→100');
  });

  it('a 15 fölötti hashtageket levágja', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `#t${i}`);
    const v = adaptForPlatform({ hashtags: tags }, 'youtube');
    expect(v.hashtags).toHaveLength(15);
    expect(v.warnings.find((w) => w.code === 'hashtagsDropped')?.detail).toBe('20→15');
  });

  it('aspect-eltérés + túl hosszú videó → figyelmeztetés (de nem vág)', () => {
    const v = adaptForPlatform({ aspectRatio: '16:9', durationSec: 90 }, 'youtube');
    expect(v.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['aspectMismatch', 'durationExceeds']));
    expect(v.warnings.find((w) => w.code === 'durationExceeds')?.detail).toBe('90s>60s');
  });
});

describe('adaptForPlatform — TikTok (nincs külön cím)', () => {
  it('a cím a leírás elejére kerül, a cím-mező üres', () => {
    const v = adaptForPlatform({ title: 'Cool', description: 'Desc', hashtags: ['#x'] }, 'tiktok');
    expect(v.title).toBe('');
    expect(v.description).toBe('Cool\n\nDesc\n\n#x');
  });
});

describe('adaptForPlatform — leírás-truncation a hashtag-helyet megtartva', () => {
  it('a hashtag-sor befér a limitbe, a leírást vágja', () => {
    const v = adaptForPlatform({ description: 'a'.repeat(2200), hashtags: ['#tag'] }, 'tiktok');
    expect(v.description.length).toBe(PLATFORM_SPECS.tiktok.maxDescription); // pontosan 2200
    expect(v.description.endsWith('#tag')).toBe(true);
    expect(v.warnings.find((w) => w.code === 'descriptionTruncated')?.detail).toBe('2200→2194');
  });

  it('hashtag nélkül egyszerűen a limitre vág', () => {
    const v = adaptForPlatform({ description: 'b'.repeat(2300) }, 'tiktok');
    expect(v.description).toHaveLength(2200);
    expect(v.warnings.find((w) => w.code === 'descriptionTruncated')?.detail).toBe('2300→2200');
  });
});

describe('adaptAll', () => {
  it('minden platformra ad variánst', () => {
    const out = adaptAll({ title: 'T', description: 'D', hashtags: ['#a'] });
    expect(out.map((v) => v.platform)).toEqual(PUBLISH_PLATFORMS);
    expect(out.every((v) => v.description.includes('#a'))).toBe(true);
  });
});
