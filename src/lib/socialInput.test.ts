import { socialUrl } from '@/lib/creatorProfile';
import { orFilterValue } from '@/lib/feed';
import { isValidActionUrl } from '@/lib/url';

describe('S24: közösségi link', () => {
  it('https átmegy', () => {
    expect(socialUrl({ platform: 'custom', username: '', url: 'https://x.hu/a' })).toBe('https://x.hu/a');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'intent://x'])('%s nem lesz link', (url) => {
    expect(socialUrl({ platform: 'custom', username: '', url })).toBe('');
  });
});

describe('S21: hotspot-cím', () => {
  it('csak http(s)', () => {
    expect(isValidActionUrl('https://x.hu')).toBe(true);
    expect(isValidActionUrl('javascript:alert(1)')).toBe(false);
    expect(isValidActionUrl('remix://x')).toBe(false);
  });
});

describe('S28: keresési szűrő', () => {
  it('a vessző és a zárójel az idézőjelen belül marad', () => {
    expect(orFilterValue('%a,b)%')).toBe('"%a,b)%"');
  });

  it('az idézőjel és a visszaper escape-elt', () => {
    expect(orFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
