const { isClientError } = require('./caught');
// a `userFiles.js` / `quota.js` hibáinak alakja (a modulok a push-SDK-t is behúznák)
class QuotaExceededError extends Error {
  constructor(usage) {
    super('quota_exceeded');
    this.name = 'QuotaExceededError';
    this.usage = usage;
  }
}
class UserFilesError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'UserFilesError';
    this.status = status;
    this.code = code;
  }
}

describe('isClientError — a 4xx és a betelt tárhely nem kerül a hibanaplóba', () => {
  it('a kliens kérésének hibája (nincs ilyen fájl) nem szerverhiba', () => {
    expect(isClientError(new UserFilesError(404, 'not_found', 'Nincs ilyen fájl vagy mappa.'))).toBe(true);
    expect(isClientError(new UserFilesError(400, 'bad_request', 'Nincs kijelölt elem.'))).toBe(true);
  });
  it('a kliens lezárta a kérést (499, pl. stems_aborted)', () => {
    expect(isClientError(Object.assign(new Error('stems_aborted'), { status: 499 }))).toBe(true);
  });
  it('a betelt tárhely a felhasználó állapota', () => {
    expect(isClientError(new QuotaExceededError({ used: 1 }))).toBe(true);
  });
  it('az 5xx és a státusz nélküli hiba valódi hiba', () => {
    expect(isClientError(new UserFilesError(500, 'io', 'írási hiba'))).toBe(false);
    expect(isClientError(new Error('Supabase 400 GET: column x does not exist'))).toBe(false);
    expect(isClientError(new TypeError('x is undefined'))).toBe(false);
    expect(isClientError(null)).toBe(false);
  });
});
