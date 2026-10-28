import { DEFAULT_SYNC_PREFS, parseSyncPrefs, syncDecision } from './syncPolicy';

describe('syncPolicy', () => {
  test('beállítás-olvasás alapértékkel', () => {
    expect(parseSyncPrefs(null)).toEqual({ wifiOnly: true });
    expect(parseSyncPrefs('{"wifiOnly":false}')).toEqual({ wifiOnly: false });
    expect(parseSyncPrefs('{"wifiOnly":"x"}')).toEqual(DEFAULT_SYNC_PREFS);
    expect(parseSyncPrefs('nem json')).toEqual(DEFAULT_SYNC_PREFS);
  });

  test('döntés: mobilnet + automatikus + Wi-Fi-only → vár; kézi mindig mehet', () => {
    const wifiOnly = { wifiOnly: true };
    expect(syncDecision('wifi', wifiOnly, false)).toBe('run');
    expect(syncDecision('cellular', wifiOnly, false)).toBe('waitWifi');
    expect(syncDecision('cellular', wifiOnly, true)).toBe('run');
    expect(syncDecision('cellular', { wifiOnly: false }, false)).toBe('run');
    expect(syncDecision('none', wifiOnly, true)).toBe('offline');
    expect(syncDecision('unknown', wifiOnly, false)).toBe('run');
  });
});
