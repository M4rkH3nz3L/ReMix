const { formatEntry, shouldLog, levelThreshold, makeRequestId } = require('./log');

describe('formatEntry — strukturált vs olvasható (05-observability §05.1)', () => {
  test('JSON-mód: parse-olható { level, ts, msg, ...ctx }', () => {
    const line = formatEntry('info', 'render kész', { jobId: 'j1', userId: 'u1' }, { ts: '2026-01-01T00:00:00.000Z' });
    const o = JSON.parse(line);
    expect(o).toEqual({ level: 'info', ts: '2026-01-01T00:00:00.000Z', msg: 'render kész', jobId: 'j1', userId: 'u1' });
  });

  test('pretty-mód: olvasható fejlécelt sor a kontextussal', () => {
    const line = formatEntry('warn', 'lassú', { reqId: 'abc' }, { ts: '2026-01-01T00:00:00.000Z', pretty: true });
    expect(line).toBe('[2026-01-01T00:00:00.000Z] WARN lassú {"reqId":"abc"}');
  });

  test('ctx nélkül is érvényes (JSON + pretty)', () => {
    expect(JSON.parse(formatEntry('error', 'hiba', {}, { ts: 'T' }))).toEqual({ level: 'error', ts: 'T', msg: 'hiba' });
    expect(formatEntry('info', 'ok', {}, { ts: 'T', pretty: true })).toBe('[T] INFO ok');
  });
});

describe('shouldLog / levelThreshold — LOG_LEVEL gate', () => {
  test('LOG_LEVEL=warn → error/warn átmegy, info/debug nem', () => {
    const env = { LOG_LEVEL: 'warn' };
    expect(shouldLog('error', env)).toBe(true);
    expect(shouldLog('warn', env)).toBe(true);
    expect(shouldLog('info', env)).toBe(false);
    expect(shouldLog('debug', env)).toBe(false);
  });

  test('alap (nincs LOG_LEVEL) = info → debug elnyomva', () => {
    expect(shouldLog('info', {})).toBe(true);
    expect(shouldLog('debug', {})).toBe(false);
  });

  test('ismeretlen LOG_LEVEL → info-ra esik vissza', () => {
    expect(levelThreshold({ LOG_LEVEL: 'zajos' })).toBe(levelThreshold({ LOG_LEVEL: 'info' }));
  });
});

describe('makeRequestId — korrelációs azonosító', () => {
  test('hex-string, nem üres, hívásonként más', () => {
    const a = makeRequestId();
    const b = makeRequestId();
    expect(a).toMatch(/^[a-f0-9]+$/);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
  });
});
