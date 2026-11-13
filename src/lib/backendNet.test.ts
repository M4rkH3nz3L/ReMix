import { cloudAvailable, isNetworkError } from '@/lib/backend';

/** 📱 felhő nélkül a telefonos út a tartalék: a hálózati hiba felismerése */
describe('📱 hálózati hiba és felhő', () => {
  it('a tipikus hálózati hibák felismerve, a többi nem', () => {
    for (const m of ['Network request failed', 'TypeError: Failed to fetch', 'The Internet connection appears to be offline.', 'request timed out', 'connect ECONNREFUSED 10.0.0.1:443', 'getaddrinfo ENOTFOUND api.example.com']) {
      expect(isNetworkError(new Error(m))).toBe(true);
    }
    for (const m of ['A renderelés nem sikerült', 'quota_exceeded', 'Pro szükséges']) {
      expect(isNetworkError(new Error(m))).toBe(false);
    }
  });
  it('dev-ben a helyi worker a felhő', () => {
    expect(cloudAvailable()).toBe(true);
  });
});
