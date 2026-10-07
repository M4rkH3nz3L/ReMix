const { isTransientStatus, fetchRetry } = require('./netFetch');

// mock Response (csak a status kell)
const resp = (status) => ({ status, ok: status >= 200 && status < 300 });
const noSleep = () => Promise.resolve();

describe('isTransientStatus', () => {
  it('408/425/429/5xx átmeneti; 2xx/4xx nem', () => {
    for (const s of [408, 425, 429, 500, 503, 599]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [200, 301, 400, 401, 404]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe('fetchRetry', () => {
  it('idempotens (GET): 503, 503, majd 200 → 3 hívás, a 200-at adja', async () => {
    let n = 0;
    const fetchImpl = () => {
      n += 1;
      return Promise.resolve(resp(n < 3 ? 503 : 200));
    };
    const res = await fetchRetry('u', {}, { fetchImpl, sleep: noSleep, attempts: 3 });
    expect(n).toBe(3);
    expect(res.status).toBe(200);
  });

  it('idempotens, végig 503 → az utolsó választ adja vissza (nem dob)', async () => {
    let n = 0;
    const fetchImpl = () => {
      n += 1;
      return Promise.resolve(resp(503));
    };
    const res = await fetchRetry('u', {}, { fetchImpl, sleep: noSleep, attempts: 3 });
    expect(n).toBe(3);
    expect(res.status).toBe(503);
  });

  it('NEM idempotens (POST): 503 → azonnal visszaadja (nincs retry)', async () => {
    let n = 0;
    const fetchImpl = () => {
      n += 1;
      return Promise.resolve(resp(503));
    };
    const res = await fetchRetry('u', { method: 'POST' }, { fetchImpl, sleep: noSleep, attempts: 3 });
    expect(n).toBe(1);
    expect(res.status).toBe(503);
  });

  it('idempotens dobás kétszer, majd ok → újrapróbál', async () => {
    let n = 0;
    const fetchImpl = () => {
      n += 1;
      return n < 3 ? Promise.reject(new Error('net')) : Promise.resolve(resp(200));
    };
    const res = await fetchRetry('u', {}, { fetchImpl, sleep: noSleep, attempts: 3 });
    expect(n).toBe(3);
    expect(res.status).toBe(200);
  });

  it('nem-idempotens dobás → azonnal dob (nincs retry)', async () => {
    let n = 0;
    const fetchImpl = () => {
      n += 1;
      return Promise.reject(new Error('net'));
    };
    await expect(
      fetchRetry('u', { method: 'POST' }, { fetchImpl, sleep: noSleep, attempts: 3 })
    ).rejects.toThrow('net');
    expect(n).toBe(1);
  });
});
