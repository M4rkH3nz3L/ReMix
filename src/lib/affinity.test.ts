import {
  creatorAffinity,
  normalizeTag,
  buildTagPreferences,
  topicAffinity,
  mergeAffinity,
  FOLLOW_BOOST,
  CONNECTION_BOOST,
} from '@/lib/affinity';
import { scorePost, type PostSignals } from '@/lib/feedRanking';

describe('creatorAffinity — telítődő interakció + követés/kapcsolat boost (§01.2/§01.5)', () => {
  it('nincs jel → 0', () => {
    expect(creatorAffinity({})).toBe(0);
    expect(creatorAffinity()).toBe(0);
  });

  it('monoton: több interakció sosem csökkent, mindig 0–1', () => {
    const a = creatorAffinity({ likes: 2 });
    const b = creatorAffinity({ likes: 5 });
    const c = creatorAffinity({ likes: 5, saves: 3, remixes: 2 });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(1);
  });

  it('kölcsönös „kapcsolat" > sima követés > nincs (§01.5 mérhető emelés)', () => {
    const none = creatorAffinity({ likes: 1 });
    const follow = creatorAffinity({ likes: 1, follows: true });
    const mutual = creatorAffinity({ likes: 1, mutual: true });
    expect(follow).toBeCloseTo(none + FOLLOW_BOOST, 10);
    expect(mutual).toBeCloseTo(none + CONNECTION_BOOST, 10);
    expect(mutual).toBeGreaterThan(follow);
  });

  it('a kapcsolat nem ad DUPLA boostot a követés mellé (else-if)', () => {
    expect(creatorAffinity({ mutual: true, follows: true })).toBeCloseTo(CONNECTION_BOOST, 10);
  });

  it('erős history telítődik, de 1 alatt marad (boost nélkül)', () => {
    const s = creatorAffinity({ likes: 50, saves: 50, remixes: 50, comments: 50, viewsCompleted: 50 });
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('normalizeTag', () => {
  it('trim + kisbetű + vezető # levágva', () => {
    expect(normalizeTag('#React')).toBe('react');
    expect(normalizeTag('  ##AI ')).toBe('ai');
    expect(normalizeTag('EDM')).toBe('edm');
    expect(normalizeTag('')).toBe('');
  });
});

describe('buildTagPreferences — súlyozott halmozás', () => {
  it('a súlyokat tag-enként összegzi, normalizálva', () => {
    const prefs = buildTagPreferences([
      { hashtags: ['#EDM', 'vlog'], weight: 2 },
      { hashtags: ['edm'], weight: 1 },
      { hashtags: ['#Travel'] }, // alap súly 1
    ]);
    expect(prefs).toEqual({ edm: 3, vlog: 2, travel: 1 });
  });

  it('üres/hibás input → üres térkép', () => {
    expect(buildTagPreferences([])).toEqual({});
    expect(buildTagPreferences([{ hashtags: [''] }])).toEqual({});
  });
});

describe('topicAffinity — a preferencia-tömeg lefedettsége (§01.2)', () => {
  const prefs = { edm: 3, vlog: 2, travel: 1 }; // total 6

  it('teljes átfedés → 1; nincs átfedés → 0', () => {
    expect(topicAffinity(prefs, ['edm', 'vlog', 'travel'])).toBe(1);
    expect(topicAffinity(prefs, ['cooking'])).toBe(0);
  });

  it('részleges → fedett súly / összsúly', () => {
    expect(topicAffinity(prefs, ['#EDM'])).toBeCloseTo(3 / 6, 10); // normalizál is
    expect(topicAffinity(prefs, ['vlog', 'travel'])).toBeCloseTo(3 / 6, 10);
  });

  it('nincs preferencia vagy nincs tag → 0', () => {
    expect(topicAffinity({}, ['edm'])).toBe(0);
    expect(topicAffinity(prefs, [])).toBe(0);
  });
});

describe('mergeAffinity — PostSignals-be olvasztás, klampelve', () => {
  it('beállítja a jeleket, a bázist megőrzi, 0–1-re szorít', () => {
    const base: PostSignals = { likes: 10, views: 100, ageHours: 1 };
    const merged = mergeAffinity(base, { creatorAffinity: 1.5, topicAffinity: 0.4 });
    expect(merged.creatorAffinity).toBe(1); // klampelt
    expect(merged.topicAffinity).toBe(0.4);
    expect(merged.likes).toBe(10);
    expect(base.creatorAffinity).toBeUndefined(); // nem mutál
  });
});

describe('integráció: az affinitás mérhetően előrébb rangsorol (§01.2 elfogadás)', () => {
  it('két azonos poszt közül a magasabb creator-affinitású kap nagyobb scorePost-ot', () => {
    const common: PostSignals = { likes: 5, comments: 1, views: 100, ageHours: 2 };
    const cold = scorePost({ ...common, creatorAffinity: 0, topicAffinity: 0 });
    const warm = scorePost(mergeAffinity(common, { creatorAffinity: 0.9, topicAffinity: 0.8 }));
    expect(warm).toBeGreaterThan(cold);
  });
});
