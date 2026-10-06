import { filterBlocked, isBlockedByMe, isCommentVisible, isMuted } from '@/lib/blocks';

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

describe('blocks — filterBlocked (feed/komment szint)', () => {
  type Item = { id: string; author: string };
  const items: Item[] = [
    { id: 'p1', author: 'u1' },
    { id: 'p2', author: 'u2' },
    { id: 'p3', author: 'u1' },
  ];
  const by = (i: Item) => i.author;

  it('a blokkolt szerző elemeit elrejti, a sorrend marad', () => {
    expect(filterBlocked(items, by, ['u1']).map((i) => i.id)).toEqual(['p2']);
  });
  it('üres blokk-lista → változatlan', () => {
    expect(filterBlocked(items, by, []).map((i) => i.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('blocks — isCommentVisible (restrict)', () => {
  it('nem korlátozott szerzőt mindenki lát', () => {
    expect(isCommentVisible('u2', 'u9', 'owner', [])).toBe(true);
    expect(isCommentVisible('u2', null, 'owner', ['u3'])).toBe(true);
  });
  it('korlátozott szerző kommentje csak neki + a tulajnak', () => {
    expect(isCommentVisible('u3', 'u3', 'owner', ['u3'])).toBe(true); // maga
    expect(isCommentVisible('u3', 'owner', 'owner', ['u3'])).toBe(true); // tulaj
    expect(isCommentVisible('u3', 'u9', 'owner', ['u3'])).toBe(false); // más néző
    expect(isCommentVisible('u3', null, 'owner', ['u3'])).toBe(false); // kijelentkezve
  });
});
