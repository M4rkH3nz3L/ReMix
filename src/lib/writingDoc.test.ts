import { addFact, emptyMemory } from '@/lib/creatorMemory';
import {
  applyWritingCommand,
  buildWritingContext,
  createWritingDoc,
  writingStats,
  type WritingDoc,
} from '@/lib/writingDoc';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

/** determinisztikus id-generátor a tesztekhez */
const mkIder = () => {
  let n = 0;
  return () => `id${++n}`;
};

const seedDoc = (): WritingDoc => {
  const id = mkIder();
  let doc = createWritingDoc('A regényem', id, T0);
  // egy fejezet van létrehozáskor; töltsük fel + adjunk hozzá kettőt
  doc = applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: doc.chapters[0].id, patch: { title: 'Nyitány', body: 'Egyszer volt.' } }, id, T0);
  doc = applyWritingCommand(doc, { type: 'ADD_CHAPTER', title: 'Bonyodalom' }, id, T0);
  doc = applyWritingCommand(doc, { type: 'ADD_CHAPTER', title: 'Tetőpont' }, id, T0);
  return doc;
};

describe('writingDoc — createWritingDoc', () => {
  it('címet + egy üres fejezetet ad', () => {
    const doc = createWritingDoc('  Cím  ', mkIder(), T0);
    expect(doc.title).toBe('Cím');
    expect(doc.chapters).toHaveLength(1);
    expect(doc.bible).toEqual([]);
  });
});

describe('writingDoc — fejezet-parancsok', () => {
  it('ADD_CHAPTER a végére, atIndex-szel a megadott helyre', () => {
    const id = mkIder();
    let doc = createWritingDoc('K', id, T0);
    doc = applyWritingCommand(doc, { type: 'ADD_CHAPTER', title: 'B' }, id, T0);
    doc = applyWritingCommand(doc, { type: 'ADD_CHAPTER', title: 'A', atIndex: 0 }, id, T0);
    expect(doc.chapters.map((c) => c.title)).toEqual(['A', '', 'B']);
  });

  it('UPDATE_CHAPTER módosít; ismeretlen id → ugyanaz a referencia', () => {
    const id = mkIder();
    let doc = createWritingDoc('K', id, T0);
    const cid = doc.chapters[0].id;
    doc = applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: cid, patch: { body: 'szöveg' } }, id, T1);
    expect(doc.chapters[0].body).toBe('szöveg');
    expect(doc.updatedAt).toBe(T1);
    expect(applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: 'nope', patch: { body: 'x' } }, id, T1)).toBe(doc);
  });

  it('MOVE_CHAPTER átrendez, a toIndex a tartományba vág', () => {
    let doc = seedDoc();
    const id = mkIder();
    const last = doc.chapters[2].id;
    doc = applyWritingCommand(doc, { type: 'MOVE_CHAPTER', chapterId: last, toIndex: 0 }, id, T1);
    expect(doc.chapters.map((c) => c.title)).toEqual(['Tetőpont', 'Nyitány', 'Bonyodalom']);
  });

  it('MOVE_CHAPTER azonos helyre / ismeretlen id → no-op', () => {
    const doc = seedDoc();
    const id = mkIder();
    expect(applyWritingCommand(doc, { type: 'MOVE_CHAPTER', chapterId: doc.chapters[0].id, toIndex: 0 }, id, T1)).toBe(doc);
    expect(applyWritingCommand(doc, { type: 'MOVE_CHAPTER', chapterId: 'nope', toIndex: 1 }, id, T1)).toBe(doc);
  });

  it('REMOVE_CHAPTER töröl; ismeretlen id → no-op', () => {
    let doc = seedDoc();
    const id = mkIder();
    const cid = doc.chapters[1].id;
    doc = applyWritingCommand(doc, { type: 'REMOVE_CHAPTER', chapterId: cid }, id, T1);
    expect(doc.chapters.map((c) => c.title)).toEqual(['Nyitány', 'Tetőpont']);
    expect(applyWritingCommand(doc, { type: 'REMOVE_CHAPTER', chapterId: 'nope' }, id, T1)).toBe(doc);
  });

  it('immutábilis — az eredeti doc nem változik', () => {
    const doc = seedDoc();
    const before = doc.chapters.length;
    applyWritingCommand(doc, { type: 'ADD_CHAPTER' }, mkIder(), T1);
    expect(doc.chapters).toHaveLength(before);
  });
});

describe('writingDoc — meta + story bible', () => {
  it('SET_META cím+logline; üres cím megtartja a régit; no-op ugyanaz a ref', () => {
    const id = mkIder();
    let doc = createWritingDoc('Régi', id, T0);
    doc = applyWritingCommand(doc, { type: 'SET_META', patch: { title: 'Új', logline: 'Egy hős útja.' } }, id, T1);
    expect(doc.title).toBe('Új');
    expect(doc.logline).toBe('Egy hős útja.');
    doc = applyWritingCommand(doc, { type: 'SET_META', patch: { title: '   ' } }, id, T1);
    expect(doc.title).toBe('Új'); // üres → marad
    expect(applyWritingCommand(doc, { type: 'SET_META', patch: {} }, id, T1)).toBe(doc);
  });

  it('bible: hozzáad / módosít / töröl', () => {
    const id = mkIder();
    let doc = createWritingDoc('K', id, T0);
    doc = applyWritingCommand(doc, { type: 'ADD_BIBLE_ENTRY', kind: 'character', name: 'Anna' }, id, T0);
    const eid = doc.bible[0].id;
    doc = applyWritingCommand(doc, { type: 'UPDATE_BIBLE_ENTRY', entryId: eid, patch: { description: 'a főhős' } }, id, T1);
    expect(doc.bible[0]).toMatchObject({ kind: 'character', name: 'Anna', description: 'a főhős' });
    doc = applyWritingCommand(doc, { type: 'REMOVE_BIBLE_ENTRY', entryId: eid }, id, T1);
    expect(doc.bible).toHaveLength(0);
  });
});

describe('writingDoc — writingStats', () => {
  it('összegzi a szó/karakter/olvasási-időt a fejezeteken', () => {
    const id = mkIder();
    let doc = createWritingDoc('K', id, T0);
    doc = applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: doc.chapters[0].id, patch: { body: '# Cím\n\negy két há' } }, id, T0);
    doc = applyWritingCommand(doc, { type: 'ADD_CHAPTER' }, id, T0);
    doc = applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: doc.chapters[1].id, patch: { body: 'négy öt' } }, id, T0);
    const s = writingStats(doc);
    expect(s.chapters).toBe(2);
    // 1. fejezet: „Cím egy két há" (a heading-jelölés nélkül) = 4 · 2. fejezet: „négy öt" = 2
    expect(s.words).toBe(6);
    expect(s.readingMin).toBe(1);
  });
});

describe('writingDoc — buildWritingContext', () => {
  const build = (): WritingDoc => {
    const id = mkIder();
    let doc = createWritingDoc('A regényem', id, T0);
    doc = applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: doc.chapters[0].id, patch: { title: 'Nyitány', body: 'Kezdet.', synopsis: 'Bemutatkozik Anna.' } }, id, T0);
    doc = applyWritingCommand(doc, { type: 'ADD_CHAPTER', title: 'Bonyodalom' }, id, T0);
    doc = applyWritingCommand(doc, { type: 'UPDATE_CHAPTER', chapterId: doc.chapters[1].id, patch: { body: 'Baj van.' } }, id, T0);
    doc = applyWritingCommand(doc, { type: 'ADD_BIBLE_ENTRY', kind: 'character', name: 'Anna' }, id, T0);
    doc = applyWritingCommand(doc, { type: 'UPDATE_BIBLE_ENTRY', entryId: doc.bible[0].id, patch: { description: 'a főhős' } }, id, T0);
    return doc;
  };

  it('a 2. fejezetnél megadja az előző fejezet szinopszisát + a szereplőket', () => {
    const doc = build();
    const ctx = buildWritingContext(doc, doc.chapters[1].id) as {
      currentChapter: { title: string };
      previousChapter: { title: string; synopsis: string };
      bible: { characters: string[] };
    };
    expect(ctx.currentChapter.title).toBe('Bonyodalom');
    expect(ctx.previousChapter.title).toBe('Nyitány');
    expect(ctx.previousChapter.synopsis).toBe('Bemutatkozik Anna.');
    expect(ctx.bible.characters).toContain('Anna: a főhős');
  });

  it('az első fejezetnél nincs previousChapter', () => {
    const doc = build();
    const ctx = buildWritingContext(doc, doc.chapters[0].id);
    expect((ctx as Record<string, unknown>).previousChapter).toBeUndefined();
  });

  it('a Creator Memory writing-stílusát befűzi', () => {
    const doc = build();
    let mem = emptyMemory(T0);
    mem = addFact(mem, { category: 'style', text: 'Rövid, pergő mondatok', scopes: ['writing'] }, T0);
    const ctx = buildWritingContext(doc, doc.chapters[0].id, mem) as { creatorMemory?: Record<string, string[]> };
    expect(ctx.creatorMemory?.style).toContain('Rövid, pergő mondatok');
  });
});
