const { decideNotify } = require('./notifyPolicy');

describe('notifyPolicy — decideNotify (cross-user notify authZ)', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  it('saját magának mindig küldhet (self-notify)', () => {
    expect(decideNotify({ callerId: A, recipientId: A })).toBe(true);
    expect(decideNotify({ callerId: A, recipientId: A, shareProject: false, followEdge: false })).toBe(true);
  });

  it('⚠️ IDEGEN usernek (nincs kapcsolat) NEM küldhet', () => {
    expect(decideNotify({ callerId: A, recipientId: B })).toBe(false);
    expect(decideNotify({ callerId: A, recipientId: B, shareProject: false, followEdge: false })).toBe(false);
  });

  it('közös projekt (collab) → engedélyezett', () => {
    expect(decideNotify({ callerId: A, recipientId: B, shareProject: true })).toBe(true);
  });

  it('follow-él (social) → engedélyezett', () => {
    expect(decideNotify({ callerId: A, recipientId: B, followEdge: true })).toBe(true);
  });

  it('hiányzó hívó vagy címzett → tiltott', () => {
    expect(decideNotify({ callerId: null, recipientId: B, shareProject: true })).toBe(false);
    expect(decideNotify({ callerId: A, recipientId: '', followEdge: true })).toBe(false);
    expect(decideNotify({})).toBe(false);
  });
});
