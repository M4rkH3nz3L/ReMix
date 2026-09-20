import { classifyError, errorDetail, toAppError } from '@/lib/errors';

describe('errorDetail', () => {
  it('Error-ből az üzenet', () => {
    expect(errorDetail(new Error('boom'))).toBe('boom');
  });
  it('név, ha nincs üzenet', () => {
    const e = new Error();
    expect(errorDetail(e)).toBe('Error');
  });
  it('sztring önmaga; null üres', () => {
    expect(errorDetail('nyers')).toBe('nyers');
    expect(errorDetail(null)).toBe('');
    expect(errorDetail(undefined)).toBe('');
  });
  it('objektum message-mezője, egyébként JSON', () => {
    expect(errorDetail({ message: 'x' })).toBe('x');
    expect(errorDetail({ a: 1 })).toBe('{"a":1}');
  });
});

describe('classifyError', () => {
  it('hálózati hibák', () => {
    expect(classifyError(new Error('Network request failed'))).toBe('network');
    expect(classifyError('The request timed out')).toBe('network');
    expect(classifyError(new Error('Aborted'))).toBe('network');
  });
  it('hitelesítés (401 → be kell jelentkezni)', () => {
    expect(classifyError('HTTP 401 Unauthorized')).toBe('auth');
    expect(classifyError(new Error('Hiányzó Authorization: Bearer token'))).toBe('auth');
  });
  it('jogosultság-hiány (403 → be van jelentkezve, de nincs joga)', () => {
    expect(classifyError('permission denied for function foo')).toBe('forbidden');
    expect(classifyError('HTTP 403 Forbidden')).toBe('forbidden');
    expect(classifyError('Nincs jogosultságod ehhez')).toBe('forbidden');
  });
  it('nem található', () => {
    expect(classifyError('HTTP 404 Not Found')).toBe('notFound');
  });
  it('szerverhiba', () => {
    expect(classifyError('HTTP 503 Service Unavailable')).toBe('server');
    expect(classifyError(new Error('internal error'))).toBe('server');
  });
  it('ismeretlen az alap', () => {
    expect(classifyError(new Error('valami furcsa'))).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
  });
  it('a 401 nem téveszthető meg a 4011-gyel (szó-határ)', () => {
    expect(classifyError('code 4011 widget')).toBe('unknown');
  });
});

describe('toAppError', () => {
  it('fajta + részlet együtt', () => {
    expect(toAppError(new Error('Network request failed'))).toEqual({
      kind: 'network',
      detail: 'Network request failed',
    });
  });
});
