import {
  SEVERITY_WEIGHT,
  severityWeight,
  routeCategory,
  slaMinutes,
  ageMinutes,
  moderationPriority,
  rankModerationQueue,
  slaBreached,
  autoQuarantineDecision,
  repeatOffenderScore,
  appealResolutionEffect,
  DEFAULT_QUARANTINE_THRESHOLD,
  type ModItem,
} from '@/lib/moderation';

const NOW = 10_000_000;
const minsAgo = (m: number): number => NOW - m * 60_000;

function item(over: Partial<ModItem> = {}): ModItem {
  return { kind: 'report', reason: 'spam', createdAtMs: minsAgo(10), ...over };
}

describe('severity / routing / SLA — §04.3 táblák', () => {
  it('súlyosság: illegal > harassment > offensive > spam > other', () => {
    expect(severityWeight('illegal')).toBeGreaterThan(severityWeight('harassment'));
    expect(severityWeight('harassment')).toBeGreaterThan(severityWeight('offensive'));
    expect(severityWeight('offensive')).toBeGreaterThan(severityWeight('spam'));
    expect(severityWeight('spam')).toBeGreaterThan(severityWeight('other'));
  });
  it('ismeretlen kategória → other-re esik', () => {
    expect(severityWeight('nonsense')).toBe(SEVERITY_WEIGHT.other);
    expect(severityWeight(undefined)).toBe(SEVERITY_WEIGHT.other);
  });
  it('routing: illegal/harassment → trust_safety, spam → spam_team, offensive → general', () => {
    expect(routeCategory('illegal')).toBe('trust_safety');
    expect(routeCategory('harassment')).toBe('trust_safety');
    expect(routeCategory('spam')).toBe('spam_team');
    expect(routeCategory('offensive')).toBe('general');
    expect(routeCategory('other')).toBe('general');
  });
  it('SLA: illegal a legszigorúbb', () => {
    expect(slaMinutes('illegal')).toBeLessThan(slaMinutes('harassment'));
    expect(slaMinutes('spam')).toBeGreaterThanOrEqual(slaMinutes('offensive'));
  });
});

describe('moderationPriority — súlyosság dominál, a többi finomhangol (§04.3)', () => {
  it('azonos koron a súlyosabb kategória előrébb', () => {
    const a = moderationPriority(item({ reason: 'illegal' }), NOW);
    const b = moderationPriority(item({ reason: 'spam' }), NOW);
    expect(a).toBeGreaterThan(b);
  });
  it('a régebbi teendő (azonos kategória) magasabb prioritás', () => {
    const old = moderationPriority(item({ createdAtMs: minsAgo(120) }), NOW);
    const fresh = moderationPriority(item({ createdAtMs: minsAgo(1) }), NOW);
    expect(old).toBeGreaterThan(fresh);
  });
  it('az öregedés SAPKÁZOTT: egy régi spam nem előz egy friss illegal-t', () => {
    const oldSpam = moderationPriority(item({ reason: 'spam', createdAtMs: minsAgo(100_000) }), NOW);
    const freshIllegal = moderationPriority(item({ reason: 'illegal', createdAtMs: minsAgo(0) }), NOW);
    expect(freshIllegal).toBeGreaterThan(oldSpam);
  });
  it('több egyedi bejelentő + elkövető-history emel', () => {
    const base = moderationPriority(item(), NOW);
    expect(moderationPriority(item({ uniqueReporters: 5 }), NOW)).toBeGreaterThan(base);
    expect(moderationPriority(item({ offenderPriorStrikes: 3 }), NOW)).toBeGreaterThan(base);
  });
  it('az auto_flag kis előnyt kap az azonos report felett', () => {
    expect(moderationPriority(item({ kind: 'auto_flag' }), NOW)).toBeGreaterThan(
      moderationPriority(item({ kind: 'report' }), NOW),
    );
  });
});

describe('rankModerationQueue — nem lapos created_at, hanem prioritás (§04.3)', () => {
  it('súlyosság szerint rangsorol, döntetlennél stabil', () => {
    const items: ModItem[] = [
      item({ reason: 'spam', createdAtMs: minsAgo(5) }),
      item({ reason: 'illegal', createdAtMs: minsAgo(1) }),
      item({ reason: 'offensive', createdAtMs: minsAgo(2) }),
    ];
    const ranked = rankModerationQueue(items, NOW);
    expect(ranked.map((x) => x.reason)).toEqual(['illegal', 'offensive', 'spam']);
  });
  it('üres → üres', () => {
    expect(rankModerationQueue([], NOW)).toEqual([]);
  });
});

describe('slaBreached — a határon túl nyitott', () => {
  it('illegal 60 perc: 90 perce nyitott → lejárt; 30 perce → nem', () => {
    expect(slaBreached(item({ reason: 'illegal', createdAtMs: minsAgo(90) }), NOW)).toBe(true);
    expect(slaBreached(item({ reason: 'illegal', createdAtMs: minsAgo(30) }), NOW)).toBe(false);
  });
  it('ageMinutes nem-negatív (jövőbeli createdAt → 0)', () => {
    expect(ageMinutes(item({ createdAtMs: NOW + 60_000 }), NOW)).toBe(0);
  });
});

describe('autoQuarantineDecision — küszöb felett pending, SOHA removed (§04.2)', () => {
  it('küszöb alatt → none/ok', () => {
    expect(autoQuarantineDecision({ uniqueReporters: 2 })).toMatchObject({ action: 'none', status: 'ok' });
  });
  it('küszöbön/felette → quarantine/pending (nem removed)', () => {
    const d = autoQuarantineDecision({ uniqueReporters: DEFAULT_QUARANTINE_THRESHOLD });
    expect(d).toMatchObject({ action: 'quarantine', status: 'pending', reason: 'report_threshold' });
    expect(d.status).not.toBe('removed');
  });
  it('a küszöb konfigurálható', () => {
    expect(autoQuarantineDecision({ uniqueReporters: 5, threshold: 10 }).action).toBe('none');
  });
});

describe('repeatOffenderScore — ismétlődő elkövető (§04.2)', () => {
  it('removed poszt + report + friss fiók emel, monoton', () => {
    expect(repeatOffenderScore({})).toBe(0);
    expect(repeatOffenderScore({ removedPosts: 2 })).toBe(4);
    expect(repeatOffenderScore({ removedPosts: 2, upheldReports: 3 })).toBe(7);
    expect(repeatOffenderScore({ accountAgeDays: 1 })).toBe(2); // friss fiók boost
    expect(repeatOffenderScore({ accountAgeDays: 365 })).toBe(0);
  });
});

describe('appealResolutionEffect — §04.1 státusz-leképzés', () => {
  it('granted → poszt ok (visszaáll); denied → removed marad', () => {
    expect(appealResolutionEffect('granted')).toEqual({ appealStatus: 'granted', postModerationStatus: 'ok' });
    expect(appealResolutionEffect('denied')).toEqual({ appealStatus: 'denied', postModerationStatus: 'removed' });
  });
});
