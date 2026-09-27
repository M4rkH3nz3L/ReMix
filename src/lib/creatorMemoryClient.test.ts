import { addFact, emptyMemory } from '@/lib/creatorMemory';
import { parseMemoryDoc } from '@/lib/creatorMemoryClient';

const T0 = '2026-01-01T00:00:00.000Z';
const jsonRoundtrip = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

describe('creatorMemoryClient — parseMemoryDoc', () => {
  it('round-trip: a JSONB-be mentett memória hiánytalanul visszaolvasható', () => {
    let mem = emptyMemory(T0);
    mem = addFact(mem, { category: 'gear', text: 'Sony A7 IV', key: 'gear:camera' }, T0);
    mem = addFact(mem, { category: 'caption', text: 'Sárga felirat', scopes: ['video'], weight: 0.7, pinned: true }, T0);
    expect(parseMemoryDoc(jsonRoundtrip(mem))).toEqual(mem);
  });

  it('hibás/hiányzó doc → üres memória (nem dob)', () => {
    expect(parseMemoryDoc(null)).toEqual({ facts: [], updatedAt: '' });
    expect(parseMemoryDoc({})).toEqual({ facts: [], updatedAt: '' });
    expect(parseMemoryDoc('szemét')).toEqual({ facts: [], updatedAt: '' });
    expect(parseMemoryDoc({ facts: 'nem tömb' })).toEqual({ facts: [], updatedAt: '' });
  });

  it('a menthetetlen tényeket kihagyja (hiányzó id/text/rossz kategória)', () => {
    const doc = {
      updatedAt: T0,
      facts: [
        { id: 'ok', category: 'fact', text: 'jó', weight: 0.5, hits: 1, pinned: false, createdAt: T0, updatedAt: T0 },
        { id: 'x', category: 'fact' }, // nincs text
        { category: 'fact', text: 'nincs id' },
        { id: 'y', category: 'ismeretlen', text: 'rossz kategória' },
      ],
    };
    const mem = parseMemoryDoc(doc);
    expect(mem.facts).toHaveLength(1);
    expect(mem.facts[0].id).toBe('ok');
  });
});
