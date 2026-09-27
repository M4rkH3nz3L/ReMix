import {
  addVersion,
  approveVersion,
  archiveVersion,
  canTransition,
  compareVersions,
  currentVersion,
  duplicateVersion,
  emptyHistory,
  latestByStatus,
  lineage,
  nextStatuses,
  publishVersion,
  removeVersion,
  restoreVersion,
  setCurrent,
  setStatus,
  statusCounts,
  type VersionHistory,
} from '@/lib/versions';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

const mkIder = () => {
  let n = 0;
  return () => `v${++n}id`;
};

describe('versions — állapotgép', () => {
  it('engedélyezett átmenetek', () => {
    expect(canTransition('draft', 'review')).toBe(true);
    expect(canTransition('review', 'approved')).toBe(true);
    expect(canTransition('approved', 'published')).toBe(true);
    expect(canTransition('published', 'archived')).toBe(true);
  });
  it('tiltott átmenetek', () => {
    expect(canTransition('draft', 'published')).toBe(false);
    expect(canTransition('draft', 'approved')).toBe(false);
  });
  it('önmagára mindig igaz', () => {
    expect(canTransition('review', 'review')).toBe(true);
  });
  it('nextStatuses a lehetőségeket adja', () => {
    expect(nextStatuses('review')).toEqual(['approved', 'draft', 'archived']);
  });
});

describe('versions — history alapok', () => {
  it('addVersion auto-címkéz (v1, v2) és aktuálissá tesz', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), { ref: 'snap1' }, id, T0);
    expect(h.versions[0]).toMatchObject({ label: 'v1', status: 'draft', ref: 'snap1' });
    expect(h.currentId).toBe(h.versions[0].id);
    h = addVersion(h, { ref: 'snap2' }, id, T0);
    expect(h.versions[1].label).toBe('v2');
    expect(currentVersion(h)!.label).toBe('v2');
  });

  it('setStatus csak engedélyezett átmenetet enged', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), {}, id, T0);
    const vid = h.versions[0].id;
    // draft → approved TILTOTT → változatlan
    expect(setStatus(h, vid, 'approved', T1)).toBe(h);
    // draft → review OK
    h = setStatus(h, vid, 'review', T1);
    expect(h.versions[0].status).toBe('review');
  });

  it('approve/publish/archive kényelmi láncon át', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), {}, id, T0);
    const vid = h.versions[0].id;
    h = setStatus(h, vid, 'review', T1);
    h = approveVersion(h, vid, T1);
    expect(h.versions[0].status).toBe('approved');
    h = publishVersion(h, vid, T1);
    expect(h.versions[0].status).toBe('published');
    h = archiveVersion(h, vid, T1);
    expect(h.versions[0].status).toBe('archived');
  });

  it('setCurrent + statusCounts', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), {}, id, T0);
    const first = h.versions[0].id;
    h = addVersion(h, {}, id, T0);
    h = setCurrent(h, first);
    expect(h.currentId).toBe(first);
    expect(statusCounts(h).draft).toBe(2);
  });
});

describe('versions — duplicate / branch / restore (lineage)', () => {
  const build = (): { h: VersionHistory; id: () => string } => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), { ref: 'snapA' }, id, T0);
    return { h, id };
  };

  it('duplicateVersion új draftot ad a forrás ref-jéből, parent-tel', () => {
    let { h, id } = build();
    const src = h.versions[0].id;
    h = duplicateVersion(h, src, id, T1);
    expect(h.versions[1]).toMatchObject({ label: 'v2', status: 'draft', ref: 'snapA', parentId: src });
    expect(h.currentId).toBe(h.versions[1].id);
  });

  it('restoreVersion nem-destruktív: új draft a régi ref-jéből', () => {
    let { h, id } = build();
    const v1 = h.versions[0].id;
    h = addVersion(h, { ref: 'snapB' }, id, T1); // v2
    h = restoreVersion(h, v1, id, T1); // v3 a snapA-ból
    expect(h.versions).toHaveLength(3);
    expect(currentVersion(h)).toMatchObject({ label: 'v3', ref: 'snapA', parentId: v1 });
  });

  it('lineage az ősök láncát adja', () => {
    let { h, id } = build();
    const v1 = h.versions[0].id;
    h = duplicateVersion(h, v1, id, T1); // v2 parent v1
    const v2 = h.versions[1].id;
    h = duplicateVersion(h, v2, id, T1); // v3 parent v2
    const v3 = h.versions[2].id;
    expect(lineage(h, v3).map((v) => v.label)).toEqual(['v2', 'v1']);
  });

  it('latestByStatus az utolsó adott státuszút adja', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), {}, id, T0);
    h = addVersion(h, {}, id, T0);
    h = setStatus(h, h.versions[0].id, 'review', T1);
    h = setStatus(h, h.versions[0].id, 'approved', T1);
    h = setStatus(h, h.versions[0].id, 'published', T1);
    expect(latestByStatus(h, 'published')!.label).toBe('v1');
    expect(latestByStatus(h, 'approved')).toBeNull(); // már published
  });
});

describe('versions — remove + compare', () => {
  it('removeVersion törli és a currentId-t a legutolsóra állítja', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), {}, id, T0);
    h = addVersion(h, {}, id, T0); // current = v2
    const v2 = h.versions[1].id;
    h = removeVersion(h, v2);
    expect(h.versions).toHaveLength(1);
    expect(h.currentId).toBe(h.versions[0].id);
  });

  it('compareVersions meta-összehasonlítás (státusz + ref-azonosság)', () => {
    const id = mkIder();
    let h = addVersion(emptyHistory(), { ref: 'x' }, id, T0);
    h = addVersion(h, { ref: 'x' }, id, T0); // azonos ref
    const [a, b] = h.versions.map((v) => v.id);
    h = setStatus(h, b, 'review', T1);
    const cmp = compareVersions(h, a, b)!;
    expect(cmp.sameRef).toBe(true);
    expect(cmp.statusChanged).toBe(true);
    expect(compareVersions(h, a, 'nope')).toBeNull();
  });
});
