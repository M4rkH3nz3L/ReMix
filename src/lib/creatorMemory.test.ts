import { buildAiContext } from '@/lib/aiCommands';
import {
  addFact,
  emptyMemory,
  memoryContext,
  memoryContextLines,
  mergeMemory,
  observeProject,
  pinFact,
  rankedFacts,
  reinforceFact,
  removeFact,
  updateFact,
} from '@/lib/creatorMemory';
import type { Project } from '@/types/project';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';

describe('creatorMemory — addFact / dedup', () => {
  it('új tényt vesz fel alap-súllyal és hits=1', () => {
    const m = addFact(emptyMemory(T0), { category: 'gear', text: 'Sony A7 IV', key: 'gear:camera' }, T0);
    expect(m.facts).toHaveLength(1);
    expect(m.facts[0]).toMatchObject({ category: 'gear', text: 'Sony A7 IV', key: 'gear:camera', hits: 1, pinned: false });
    expect(m.facts[0].weight).toBeCloseTo(0.5);
    expect(m.updatedAt).toBe(T0);
  });

  it('azonos KULCSÚ tény nem duplikál — frissít, hits++ és súly-emelés', () => {
    let m = addFact(emptyMemory(T0), { category: 'gear', text: 'Sony A7 III', key: 'gear:camera' }, T0);
    m = addFact(m, { category: 'gear', text: 'Sony A7 IV', key: 'gear:camera' }, T1);
    expect(m.facts).toHaveLength(1);
    expect(m.facts[0].text).toBe('Sony A7 IV'); // az újabb szöveg nyer
    expect(m.facts[0].hits).toBe(2);
    expect(m.facts[0].weight).toBeCloseTo(0.6);
    expect(m.facts[0].updatedAt).toBe(T1);
  });

  it('kulcs nélkül a normalizált szöveg a dedup-alap (ékezet/kis-nagybetű független)', () => {
    let m = addFact(emptyMemory(T0), { category: 'fact', text: 'Árvíztűrő' }, T0);
    m = addFact(m, { category: 'fact', text: '  árvíztűrő  ' }, T1);
    expect(m.facts).toHaveLength(1);
    expect(m.facts[0].hits).toBe(2);
  });

  it('üres szöveget nem vesz fel', () => {
    const m = addFact(emptyMemory(T0), { category: 'fact', text: '   ' }, T0);
    expect(m.facts).toHaveLength(0);
  });

  it('immutábilis — az eredeti memóriát nem módosítja', () => {
    const base = emptyMemory(T0);
    const m = addFact(base, { category: 'fact', text: 'x' }, T0);
    expect(base.facts).toHaveLength(0);
    expect(m).not.toBe(base);
  });
});

describe('creatorMemory — update / remove / pin', () => {
  it('updateFact módosítja a mezőt és a súlyt vágja 0–1-re', () => {
    let m = addFact(emptyMemory(T0), { category: 'fact', text: 'x' }, T0);
    const id = m.facts[0].id;
    m = updateFact(m, id, { weight: 5, text: 'y' }, T1);
    expect(m.facts[0].text).toBe('y');
    expect(m.facts[0].weight).toBe(1);
    expect(m.facts[0].updatedAt).toBe(T1);
  });

  it('ismeretlen id-re nem változtat (ugyanaz a referencia)', () => {
    const m = addFact(emptyMemory(T0), { category: 'fact', text: 'x' }, T0);
    expect(updateFact(m, 'nope', { text: 'y' }, T1)).toBe(m);
  });

  it('removeFact töröl; ismeretlen id-re nincs változás', () => {
    let m = addFact(emptyMemory(T0), { category: 'fact', text: 'x' }, T0);
    const id = m.facts[0].id;
    expect(removeFact(m, 'nope', T1)).toBe(m);
    m = removeFact(m, id, T1);
    expect(m.facts).toHaveLength(0);
  });

  it('pinFact rögzíti a tényt', () => {
    let m = addFact(emptyMemory(T0), { category: 'fact', text: 'x' }, T0);
    m = pinFact(m, m.facts[0].id, true, T1);
    expect(m.facts[0].pinned).toBe(true);
  });
});

describe('creatorMemory — reinforceFact (auto-tanulás)', () => {
  it('meglévő kulcsot erősít (hits++, súly+)', () => {
    let m = addFact(emptyMemory(T0), { category: 'color', text: 'teal-orange', key: 'lut' }, T0);
    m = reinforceFact(m, 'lut', T1);
    expect(m.facts[0].hits).toBe(2);
    expect(m.facts[0].weight).toBeCloseTo(0.6);
  });

  it('nem létező kulcsra nem hoz létre újat (ugyanaz a referencia)', () => {
    const m = addFact(emptyMemory(T0), { category: 'color', text: 'teal-orange', key: 'lut' }, T0);
    expect(reinforceFact(m, 'nincs-ilyen', T1)).toBe(m);
  });
});

describe('creatorMemory — rangsor + scope + kontextus', () => {
  const build = () => {
    let m = emptyMemory(T0);
    m = addFact(m, { category: 'style', text: 'globális stílus', weight: 0.3 }, T0);
    m = addFact(m, { category: 'caption', text: 'videó-felirat', scopes: ['video'], weight: 0.6 }, T1);
    m = addFact(m, { category: 'music', text: 'audio-tempó', scopes: ['audio'], weight: 0.9 }, T2);
    return m;
  };

  it('scope=video: a videó-specifikus + a globális jön, az audio-specifikus NEM', () => {
    const facts = rankedFacts(build(), 'video');
    const texts = facts.map((f) => f.text);
    expect(texts).toContain('videó-felirat');
    expect(texts).toContain('globális stílus');
    expect(texts).not.toContain('audio-tempó');
  });

  it('pinned tény mindig előre kerül, súlytól függetlenül', () => {
    let m = build();
    // a legkisebb súlyú tényt rögzítjük
    const low = m.facts.find((f) => f.text === 'globális stílus')!;
    m = pinFact(m, low.id, true, T2);
    expect(rankedFacts(m, 'video')[0].text).toBe('globális stílus');
  });

  it('memoryContext kategóriánként csoportosít, üres memóriára null', () => {
    expect(memoryContext(emptyMemory(T0))).toBeNull();
    const ctx = memoryContext(build(), 'video');
    expect(ctx).not.toBeNull();
    expect(ctx!.caption).toContain('videó-felirat');
    expect(ctx!.style).toContain('globális stílus');
  });

  it('memoryContextLines "kategória: szöveg" formában ad sorokat', () => {
    const lines = memoryContextLines(build(), 'audio');
    expect(lines.some((l) => l.startsWith('music: '))).toBe(true);
  });

  it('limit érvényesül', () => {
    let m = emptyMemory(T0);
    for (let i = 0; i < 20; i++) {
      m = addFact(m, { category: 'fact', text: `t${i}`, key: `k${i}`, weight: i / 20 }, T0);
    }
    expect(rankedFacts(m, undefined, 5)).toHaveLength(5);
  });
});

describe('creatorMemory — mergeMemory (felhő + helyi)', () => {
  it('kulcs-egyezőnél az újabb szöveg nyer, hits összeadódik, súly a nagyobbik', () => {
    const a = addFact(emptyMemory(T0), { category: 'gear', text: 'régi', key: 'gear:mic', weight: 0.4 }, T0);
    const b = addFact(emptyMemory(T1), { category: 'gear', text: 'új', key: 'gear:mic', weight: 0.8 }, T1);
    const m = mergeMemory(a, b, T2);
    expect(m.facts).toHaveLength(1);
    expect(m.facts[0].text).toBe('új');
    expect(m.facts[0].hits).toBe(2);
    expect(m.facts[0].weight).toBeCloseTo(0.8);
  });

  it('különböző kulcsok mind megmaradnak', () => {
    const a = addFact(emptyMemory(T0), { category: 'gear', text: 'kamera', key: 'gear:camera' }, T0);
    const b = addFact(emptyMemory(T1), { category: 'gear', text: 'mikrofon', key: 'gear:mic' }, T1);
    expect(mergeMemory(a, b, T2).facts).toHaveLength(2);
  });
});

describe('creatorMemory — observeProject (determinisztikus tanulás)', () => {
  const mkProject = (): Project =>
    ({
      id: 'p',
      name: 'teszt',
      kind: 'video',
      aspectRatio: '9:16',
      tracks: [
        {
          id: 't1',
          type: 'text',
          name: 'szöveg',
          clips: [
            { id: 'x1', kind: 'text', start: 0, duration: 2, fontFamily: 'Inter', color: '#fff' },
            { id: 'x2', kind: 'text', start: 2, duration: 2, fontFamily: 'Inter', color: '#fff' },
          ],
        },
        {
          id: 't2',
          type: 'captions',
          name: 'felirat',
          clips: [
            { id: 'c1', kind: 'text', start: 0, duration: 1, fontFamily: 'Inter', color: '#FFD400' },
            { id: 'c2', kind: 'text', start: 1, duration: 1, fontFamily: 'Inter', color: '#FFD400' },
          ],
        },
      ],
      assets: [],
      createdAt: T0,
      updatedAt: T0,
      schemaVersion: 6,
    }) as unknown as Project;

  it('képarányt, betűtípust és felirat-színt tanul, scope=video', () => {
    const m = observeProject(emptyMemory(T0), mkProject(), T0);
    const lines = memoryContextLines(m, 'video');
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('9:16')]));
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('Inter')]));
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('#FFD400')]));
  });

  it('kétszeri megfigyelés MEGERŐSÍT (hits nő), nem duplikál', () => {
    let m = observeProject(emptyMemory(T0), mkProject(), T0);
    const before = m.facts.length;
    m = observeProject(m, mkProject(), T1);
    expect(m.facts.length).toBe(before);
    const fontFact = m.facts.find((f) => f.key === 'font')!;
    expect(fontFact.hits).toBe(2);
  });

  it('felirat nélküli projekt nem tanul felirat-tényt', () => {
    const p = mkProject();
    p.tracks = p.tracks.filter((t) => t.type !== 'captions');
    const m = observeProject(emptyMemory(T0), p, T0);
    expect(m.facts.some((f) => f.key === 'caption:color')).toBe(false);
  });
});

describe('creatorMemory — buildAiContext integráció (PM4 → AI)', () => {
  const emptyProject: Project = {
    id: 'p',
    name: 'teszt',
    aspectRatio: '9:16',
    tracks: [],
    assets: [],
    createdAt: T0,
    updatedAt: T0,
    schemaVersion: 6,
  } as unknown as Project;

  it('memória nélkül a kontextusban NINCS creatorMemory kulcs (back-compat)', () => {
    const ctx = buildAiContext(emptyProject, 0, null, []);
    expect(ctx.creatorMemory).toBeUndefined();
    // a régi 4-argumentumos hívás változatlanul működik
    expect(ctx.project).toBeDefined();
  });

  it('memóriával a creatorMemory réteg bekerül a kontextusba', () => {
    let m = emptyMemory(T0);
    m = addFact(m, { category: 'caption', text: 'Sárga, vastag felirat', scopes: ['video'] }, T0);
    const ctx = buildAiContext(emptyProject, 0, null, [], memoryContext(m, 'video'));
    expect(ctx.creatorMemory).toBeDefined();
    expect((ctx.creatorMemory as Record<string, string[]>).caption).toContain('Sárga, vastag felirat');
  });

  it('üres memória-kontextus (null) nem szennyezi a kontextust', () => {
    const ctx = buildAiContext(emptyProject, 0, null, [], memoryContext(emptyMemory(T0)));
    expect(ctx.creatorMemory).toBeUndefined();
  });
});
