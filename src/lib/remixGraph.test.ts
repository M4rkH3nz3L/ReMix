import {
  ancestorChain,
  attribution,
  buildRemixGraph,
  descendantCount,
  descendants,
  directRemixCount,
  remixDepth,
  type RemixLink,
} from '@/lib/remixGraph';

// A → B → C lánc + A → D (A-nak két ága), E önálló eredeti.
const links: RemixLink[] = [
  { id: 'A', remixOfId: null, creatorId: 'alice' },
  { id: 'B', remixOfId: 'A', creatorId: 'bob' },
  { id: 'C', remixOfId: 'B', creatorId: 'cara' },
  { id: 'D', remixOfId: 'A', creatorId: 'dan' },
  { id: 'E', remixOfId: null, creatorId: 'eve' },
];

describe('buildRemixGraph', () => {
  it('gyökerek + gyerek-élek (a halmazon kívüli szülő is gyökér)', () => {
    const g = buildRemixGraph(links);
    expect(g.roots.sort()).toEqual(['A', 'E']);
    expect(g.children.get('A')).toEqual(['B', 'D']);
    expect(g.children.get('B')).toEqual(['C']);
    // a halmazban nem létező szülőre hivatkozó poszt gyökér lesz
    const g2 = buildRemixGraph([{ id: 'X', remixOfId: 'missing' }]);
    expect(g2.roots).toEqual(['X']);
  });
});

describe('ancestorChain / remixDepth / attribution', () => {
  const g = buildRemixGraph(links);
  it('C őslánca a gyökérig: B, A', () => {
    expect(ancestorChain(g, 'C')).toEqual(['B', 'A']);
    expect(remixDepth(g, 'C')).toBe(2);
    expect(remixDepth(g, 'A')).toBe(0);
  });
  it('attribúció: C eredetije A/alice, mélység 2', () => {
    expect(attribution(g, 'C')).toEqual({ originalId: 'A', originalCreatorId: 'alice', depth: 2 });
    expect(attribution(g, 'A')).toEqual({ originalId: 'A', originalCreatorId: 'alice', depth: 0 });
    expect(attribution(g, 'nincs')).toBeNull();
  });
});

describe('descendants / counts', () => {
  const g = buildRemixGraph(links);
  it('A alatt B, C, D (3 leszármazott); közvetlen 2', () => {
    expect(descendants(g, 'A').sort()).toEqual(['B', 'C', 'D']);
    expect(descendantCount(g, 'A')).toBe(3);
    expect(directRemixCount(g, 'A')).toBe(2);
    expect(descendantCount(g, 'C')).toBe(0);
  });
});

describe('ciklus-biztonság', () => {
  it('köröző remixOf nem okoz végtelen ciklust', () => {
    const cyc = buildRemixGraph([
      { id: 'P', remixOfId: 'Q' },
      { id: 'Q', remixOfId: 'P' },
    ]);
    expect(ancestorChain(cyc, 'P')).toEqual(['Q']); // Q-ig megy, majd a P-t már látta → megáll
    expect(descendants(cyc, 'P').sort()).toEqual(['Q']);
  });
  it('önmagára mutató → gyökér, nincs önhurok', () => {
    const self = buildRemixGraph([{ id: 'S', remixOfId: 'S' }]);
    expect(self.roots).toEqual(['S']);
    expect(descendantCount(self, 'S')).toBe(0);
  });
});
