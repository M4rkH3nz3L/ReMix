import { isBlockedByMe, isMuted } from '@/lib/blocks';

describe('blocks — isBlockedByMe (pure)', () => {
  it('a letiltott id → true', () => {
    expect(isBlockedByMe(['u2', 'u3'], 'u2')).toBe(true);
  });
  it('nem letiltott id → false', () => {
    expect(isBlockedByMe(['u2'], 'u9')).toBe(false);
    expect(isBlockedByMe([], 'u2')).toBe(false);
  });
  it('üres id → false', () => {
    expect(isBlockedByMe(['u2'], '')).toBe(false);
  });
});

describe('blocks — isMuted (pure)', () => {
  it('némított beszélgetés → true', () => {
    expect(isMuted(['c1', 'c2'], 'c1')).toBe(true);
  });
  it('nem némított → false', () => {
    expect(isMuted(['c1'], 'c2')).toBe(false);
    expect(isMuted([], 'c1')).toBe(false);
  });
});
