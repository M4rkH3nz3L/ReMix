// 🧪 auditLog — mutációs rések zárása: a fájl-sink (AUDIT_LOG_FILE), a
// best-effort catch-ágak és a meta-szűrés pontos viselkedése.

const TS = '2026-10-03T10:00:00.000Z';

/**
 * friss auditLog-példány a megadott AUDIT_LOG_FILE-lal (a modul betöltéskor olvassa)
 * @param {string | undefined} envValue
 */
function loadAuditLog(envValue) {
  const appendFileSync = jest.fn();
  const logCaught = jest.fn();
  const prev = process.env.AUDIT_LOG_FILE;
  if (envValue === undefined) {
    delete process.env.AUDIT_LOG_FILE;
  } else {
    process.env.AUDIT_LOG_FILE = envValue;
  }
  let mod;
  try {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({ appendFileSync }));
      jest.doMock('../lib/caught', () => ({ logCaught }));
      mod = require('./auditLog');
    });
  } finally {
    if (prev === undefined) {
      delete process.env.AUDIT_LOG_FILE;
    } else {
      process.env.AUDIT_LOG_FILE = prev;
    }
  }
  return { mod, appendFileSync, logCaught };
}

describe('auditLog — fájl-sink (AUDIT_LOG_FILE)', () => {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it('env nélkül NINCS fájl-írás, csak stdout', () => {
    const { mod, appendFileSync, logCaught } = loadAuditLog(undefined);
    mod.audit({ type: 't' });
    expect(appendFileSync).not.toHaveBeenCalled();
    expect(logCaught).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('csak szóközből álló env → üres útvonal → nincs fájl-írás', () => {
    const { mod, appendFileSync } = loadAuditLog('   ');
    mod.audit({ type: 't' });
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('beállított env → a VÁGOTT útvonalra pontosan a JSON-sor + újsor kerül', () => {
    const { mod, appendFileSync } = loadAuditLog('  /var/log/remix-audit.log  ');
    mod.securityEvent('render.denied', { actor: 'u1', target: 'job42' });
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const [file, data] = appendFileSync.mock.calls[0];
    expect(file).toBe('/var/log/remix-audit.log');
    expect(data.endsWith('\n')).toBe(true);
    const o = JSON.parse(data);
    expect(o).toEqual({
      ts: o.ts,
      kind: 'security',
      type: 'render.denied',
      actor: 'u1',
      target: 'job42',
      result: 'denied',
    });
    // a stdout-sor ugyanaz a JSON, [audit] előtaggal
    expect(spy.mock.calls[0][0]).toBe(`[audit] ${data.slice(0, -1)}`);
  });

  it('a fájl-írás hibája elnyelve, a hely megjelölve logCaught-ban', () => {
    const { mod, appendFileSync, logCaught } = loadAuditLog('/nope/audit.log');
    const err = new Error('EACCES');
    appendFileSync.mockImplementation(() => {
      throw err;
    });
    expect(() => mod.audit({ type: 't' })).not.toThrow();
    expect(logCaught).toHaveBeenCalledTimes(1);
    expect(logCaught).toHaveBeenCalledWith('security/auditLog.js:write', err);
  });

  it('a stdout-hiba elnyelve (write), és a fájl-írás ettől még megtörténik', () => {
    const { mod, appendFileSync, logCaught } = loadAuditLog('/tmp/a.log');
    const err = new Error('EPIPE');
    spy.mockImplementation(() => {
      throw err;
    });
    expect(() => mod.audit({ type: 't' })).not.toThrow();
    expect(logCaught).toHaveBeenCalledWith('security/auditLog.js:write', err);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('a formázás hibája (körkörös meta) elnyelve, audit-helyként jelölve', () => {
    const { mod, appendFileSync, logCaught } = loadAuditLog('/tmp/a.log');
    const meta = {};
    meta.self = meta;
    expect(() => mod.audit({ type: 't', meta })).not.toThrow();
    expect(logCaught).toHaveBeenCalledTimes(1);
    expect(logCaught.mock.calls[0][0]).toBe('security/auditLog.js:audit');
    expect(logCaught.mock.calls[0][1]).toBeInstanceOf(TypeError);
    expect(appendFileSync).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('auditLog — formatAuditEntry meta-szűrés', () => {
  const { formatAuditEntry } = require('./auditLog');

  it.each([['szöveg'], [42], [true]])('nem-objektum meta (%p) NEM kerül be', (meta) => {
    const o = JSON.parse(formatAuditEntry({ type: 'x', meta }, TS));
    expect('meta' in o).toBe(false);
  });

  it('null esemény → teljes alapértelmezett rekord, meta nélkül', () => {
    expect(JSON.parse(formatAuditEntry(null, TS))).toEqual({
      ts: TS,
      kind: 'audit',
      type: 'unknown',
      actor: null,
      target: null,
      result: null,
    });
  });
});
