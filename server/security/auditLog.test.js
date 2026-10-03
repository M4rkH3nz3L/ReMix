const { formatAuditEntry, audit, securityEvent } = require('./auditLog');

describe('auditLog — formatAuditEntry (pure)', () => {
  const TS = '2026-10-03T10:00:00.000Z';

  it('kanonikus mezők + érvényes JSON', () => {
    const line = formatAuditEntry(
      { kind: 'security', type: 'render.denied', actor: 'u1', target: 'job42', result: 'denied' },
      TS
    );
    const o = JSON.parse(line);
    expect(o).toEqual({
      ts: TS,
      kind: 'security',
      type: 'render.denied',
      actor: 'u1',
      target: 'job42',
      result: 'denied',
    });
  });

  it('hiányzó mezők → null default, kind → audit', () => {
    const o = JSON.parse(formatAuditEntry({ type: 'x' }, TS));
    expect(o).toMatchObject({ kind: 'audit', type: 'x', actor: null, target: null, result: null });
    expect('meta' in o).toBe(false);
  });

  it('meta objektum bekerül', () => {
    const o = JSON.parse(formatAuditEntry({ type: 'x', meta: { ip: '1.2.3.4' } }, TS));
    expect(o.meta).toEqual({ ip: '1.2.3.4' });
  });

  it('üres/rossz input sem dob', () => {
    expect(() => formatAuditEntry(null, TS)).not.toThrow();
    expect(() => formatAuditEntry(undefined, TS)).not.toThrow();
    expect(JSON.parse(formatAuditEntry({}, TS)).type).toBe('unknown');
  });
});

describe('auditLog — audit / securityEvent (nem dob, ír)', () => {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it('securityEvent strukturált [audit] sort ír', () => {
    securityEvent('ratelimit.block', { actor: 'ip:1.2.3.4', meta: { className: 'ai' } });
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg).toContain('[audit]');
    const json = JSON.parse(arg.replace('[audit] ', ''));
    expect(json).toMatchObject({ kind: 'security', type: 'ratelimit.block', actor: 'ip:1.2.3.4', result: 'denied' });
  });

  it('audit() sosem dob', () => {
    expect(() => audit({ type: 't', actor: 'a' })).not.toThrow();
  });
});
