// 🗑️ accountErase — az alapértelmezett cooldown és az üres napló-válasz ágai.
const { eraseCooldownElapsed, purgeUserMedia, ERASE_COOLDOWN_DAYS } = require('./accountErase');

const DAY = 24 * 3600 * 1000;

describe('eraseCooldownElapsed — alapértelmezett cooldown', () => {
  const now = 1_700_000_000_000;

  it('harmadik argumentum nélkül az ERASE_COOLDOWN_DAYS (alapból 14) a határ', () => {
    expect(ERASE_COOLDOWN_DAYS).toBe(parseInt(process.env.ERASE_COOLDOWN_DAYS || '14', 10));
    expect(eraseCooldownElapsed(now - ERASE_COOLDOWN_DAYS * DAY, now)).toBe(true);
    expect(eraseCooldownElapsed(now - ERASE_COOLDOWN_DAYS * DAY + 1, now)).toBe(false);
  });

  it('negatív cooldown 0-ra vágva: azonnal törölhető, de a jövőbeli dátum nem', () => {
    expect(eraseCooldownElapsed(now, now, -5)).toBe(true);
    expect(eraseCooldownElapsed(now + 1, now, -5)).toBe(false);
  });

  it('0 (ms) mint deleted_at → hamis érték, nem törölhető', () => {
    expect(eraseCooldownElapsed(0, now, 0)).toBe(false);
  });

  it('NaN szám → false', () => {
    expect(eraseCooldownElapsed(Number.NaN, now, 0)).toBe(false);
  });
});

describe('purgeUserMedia — null data a naplóból', () => {
  it('data: null → nincs mit törölni, egy lekérés után megáll', async () => {
    const range = jest.fn(async () => ({ data: null, error: null }));
    const sb = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range }) }) }) }) };
    const remove = jest.fn();
    expect(await purgeUserMedia(sb, 'u', remove)).toEqual({ purged: 0, failed: 0 });
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith(0, 999);
    expect(remove).not.toHaveBeenCalled();
  });

  it('pontosan 1000 sor → még egy lapot kér, ami üres', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ key: `k${i}` }));
    const range = jest.fn(async (a) => ({ data: a === 0 ? page : [], error: null }));
    const sb = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range }) }) }) }) };
    expect(await purgeUserMedia(sb, 'u', async () => {})).toEqual({ purged: 1000, failed: 0 });
    expect(range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});
