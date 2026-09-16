/* eslint-disable no-undef */
/**
 * Közös teszt-előkészítés a KLIENS projekthez.
 *
 * A `src/lib/` magok szándékosan expo-mentesek, de néhányuk natív modult
 * (SecureStore, AsyncStorage) használó modult importál. Ezeket itt mockoljuk
 * memória-alapú, determinisztikus megfelelővel — így a logika tesztelhető
 * eszköz és emulátor nélkül.
 */

// ── AsyncStorage: memória-implementáció ──────────────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
      setItem: jest.fn(async (k, v) => void store.set(k, v)),
      removeItem: jest.fn(async (k) => void store.delete(k)),
      getAllKeys: jest.fn(async () => [...store.keys()]),
      multiGet: jest.fn(async (ks) => ks.map((k) => [k, store.has(k) ? store.get(k) : null])),
      multiSet: jest.fn(async (pairs) => pairs.forEach(([k, v]) => store.set(k, v))),
      multiRemove: jest.fn(async (ks) => ks.forEach((k) => store.delete(k))),
      clear: jest.fn(async () => store.clear()),
      __store: store,
    },
  };
});

// ── expo-secure-store: memória-Keychain, a valós ~2 KB-os iOS-korláttal ──────
jest.mock('expo-secure-store', () => {
  const keychain = new Map();
  const LIMIT = 2048;
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (k) => (keychain.has(k) ? keychain.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      if (String(v).length > LIMIT) {
        throw new Error('SecureStore: érték túl nagy');
      }
      keychain.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => void keychain.delete(k)),
    __keychain: keychain,
  };
});

// i18next `t`: a kulcsot adja vissza, hogy a teszt a SZERKEZETET ellenőrizhesse
jest.mock('i18next', () => ({
  __esModule: true,
  t: (key, vars) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  default: { t: (key) => key },
}));
