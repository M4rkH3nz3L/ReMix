import {
  addComment,
  commentsInTimeRange,
  emptyApproval,
  emptyThread,
  extractMentions,
  mentionsOf,
  removeComment,
  replies,
  requestReview,
  resolveComment,
  roots,
  submitDecision,
  unresolved,
} from '@/lib/collabComments';

const T0 = '2026-01-01T00:00:00.000Z';
const mkIder = () => {
  let n = 0;
  return () => `c${++n}`;
};

describe('collabComments — mentions', () => {
  it('kinyeri az @-handle-öket (egyedi, kisbetűs)', () => {
    expect(extractMentions('@Anna nézd meg, @mark és @Anna')).toEqual(['anna', 'mark']);
  });
  it('nincs mention → üres', () => {
    expect(extractMentions('sima szöveg')).toEqual([]);
  });
});

describe('collabComments — komment CRUD', () => {
  it('addComment horgonnyal + kinyert mention', () => {
    const t = addComment(emptyThread(), { authorId: 'u1', body: '@mark 01:32-nél hangos', anchor: { kind: 'timecode', sec: 92 } }, mkIder(), T0);
    expect(t.comments[0]).toMatchObject({ authorId: 'u1', mentions: ['mark'], resolved: false });
    expect(t.comments[0].anchor).toEqual({ kind: 'timecode', sec: 92 });
  });

  it('üres body → no-op', () => {
    const t = emptyThread();
    expect(addComment(t, { authorId: 'u', body: '  ' }, mkIder(), T0)).toBe(t);
  });

  it('resolve / reopen / unresolved', () => {
    let t = addComment(emptyThread(), { authorId: 'u', body: 'javítsd' }, mkIder(), T0);
    const id = t.comments[0].id;
    expect(unresolved(t)).toHaveLength(1);
    t = resolveComment(t, id, T0);
    expect(unresolved(t)).toHaveLength(0);
  });

  it('szálak: replies + roots; removeComment a válaszokat is viszi', () => {
    const id = mkIder();
    let t = addComment(emptyThread(), { authorId: 'u', body: 'gyökér' }, id, T0);
    const root = t.comments[0].id;
    t = addComment(t, { authorId: 'u2', body: 'válasz', parentId: root }, id, T0);
    expect(roots(t)).toHaveLength(1);
    expect(replies(t, root)).toHaveLength(1);
    t = removeComment(t, root);
    expect(t.comments).toHaveLength(0); // a válasz is törlődött
  });

  it('mentionsOf + commentsInTimeRange', () => {
    const id = mkIder();
    let t = addComment(emptyThread(), { authorId: 'u', body: '@anna itt', anchor: { kind: 'timecode', sec: 10 } }, id, T0);
    t = addComment(t, { authorId: 'u', body: 'audio gond', anchor: { kind: 'audio', sec: 30 } }, id, T0);
    t = addComment(t, { authorId: 'u', body: 'késői', anchor: { kind: 'timecode', sec: 99 } }, id, T0);
    expect(mentionsOf(t, '@anna')).toHaveLength(1);
    expect(commentsInTimeRange(t, 0, 40).map((c) => (c.anchor as { sec: number }).sec)).toEqual([10, 30]);
  });
});

describe('collabComments — jóváhagyási workflow', () => {
  it('requestReview → in-review, minden döntés pending', () => {
    const s = requestReview(emptyApproval(), ['anna', 'mark']);
    expect(s.status).toBe('in-review');
    expect(s.decisions).toEqual({ anna: 'pending', mark: 'pending' });
  });

  it('minden approved → approved', () => {
    let s = requestReview(emptyApproval(), ['anna', 'mark']);
    s = submitDecision(s, 'anna', 'approved');
    expect(s.status).toBe('in-review'); // mark még pending
    s = submitDecision(s, 'mark', 'approved');
    expect(s.status).toBe('approved');
  });

  it('bármely changes → changes-requested', () => {
    let s = requestReview(emptyApproval(), ['anna', 'mark']);
    s = submitDecision(s, 'anna', 'approved');
    s = submitDecision(s, 'mark', 'changes');
    expect(s.status).toBe('changes-requested');
  });

  it('nem-reviewer döntése no-op', () => {
    const s = requestReview(emptyApproval(), ['anna']);
    expect(submitDecision(s, 'idegen', 'approved')).toBe(s);
  });
});
