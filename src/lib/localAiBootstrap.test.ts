import { bootstrapDecision } from '@/lib/localAiBootstrap';

/**
 * 🧩 Helyi AI alapból: egyszer kérdez, a letöltött-de-be-nem-próbált modellt
 * kérdés nélkül befejezi, motor nélkül vagy kész modellel nem zavar.
 */

const base = { engine: true, usable: false, downloadedUntested: false, declined: false };

describe('bootstrapDecision', () => {
  it('első indulás, motor van, modell nincs → egyszer megkérdez', () => {
    expect(bootstrapDecision(base)).toBe('ask');
  });

  it('már van használható modell → nem zavar', () => {
    expect(bootstrapDecision({ ...base, usable: true })).toBe('none');
  });

  it('nincs natív motor (régi build / web) → nem zavar', () => {
    expect(bootstrapDecision({ ...base, engine: false })).toBe('none');
  });

  it('elutasította → nem kérdez újra', () => {
    expect(bootstrapDecision({ ...base, declined: true })).toBe('none');
  });

  it('letöltve, de a próba elmaradt (megszakadt indítás) → kérdés nélkül befejezi', () => {
    expect(bootstrapDecision({ ...base, downloadedUntested: true })).toBe('smoke');
    expect(bootstrapDecision({ ...base, downloadedUntested: true, declined: true })).toBe('smoke');
  });
});
