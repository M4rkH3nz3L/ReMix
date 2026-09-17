import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { secureStorage } from '@/lib/secureStorage';

/** a mockok belső tárai (lásd jest.setup.js) */
const keychain = (SecureStore as unknown as { __keychain: Map<string, string> }).__keychain;
const asyncKv = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

/** valósághű Supabase-session: ~2,9 KB — TÚLLÉPI a ~2 KB-os iOS-korlátot */
const bigSession = JSON.stringify({
  access_token: 'a'.repeat(950),
  refresh_token: 'r'.repeat(40),
  user: { id: 'u1', email: 'a@b.c', meta: 'm'.repeat(1800) },
});

beforeEach(() => {
  keychain.clear();
  asyncKv.clear();
});

describe('secureStorage — titkosított session-tár', () => {
  it('a valós méretű session NEM férne el egy darabban', async () => {
    expect(bigSession.length).toBeGreaterThan(2048);
    await expect(SecureStore.setItemAsync('x', bigSession)).rejects.toThrow();
  });

  it('darabolva tárol, és bitre azonosan olvas vissza', async () => {
    await secureStorage.setItem('sb-auth-token', bigSession);
    const parts = [...keychain.keys()].filter((k) => /\.\d+$/.test(k));
    expect(parts.length).toBeGreaterThan(1);
    expect(await secureStorage.getItem('sb-auth-token')).toBe(bigSession);
  });

  it('semmi nem szivárog a titkosítatlan tárba', async () => {
    await secureStorage.setItem('sb-auth-token', bigSession);
    expect(asyncKv.size).toBe(0);
  });

  it('rövid értéket egyetlen kulcson tárol', async () => {
    await secureStorage.setItem('k', 'rövid');
    expect(keychain.has('k')).toBe(true);
    expect(keychain.has('k.n')).toBe(false);
    expect(await secureStorage.getItem('k')).toBe('rövid');
  });

  describe('🔄 migráció a régi, titkosítatlan helyről', () => {
    it('az első olvasás visszaadja a régi értéket (NINCS kijelentkezés)', async () => {
      asyncKv.set('sb-auth-token', bigSession);
      expect(await secureStorage.getItem('sb-auth-token')).toBe(bigSession);
    });

    it('átköltözteti a Keychainbe és törli a régit', async () => {
      asyncKv.set('sb-auth-token', bigSession);
      await secureStorage.getItem('sb-auth-token');
      expect(keychain.size).toBeGreaterThan(0);
      expect(asyncKv.has('sb-auth-token')).toBe(false);
    });

    it('a második olvasás már a titkosított tárból jön', async () => {
      asyncKv.set('sb-auth-token', bigSession);
      await secureStorage.getItem('sb-auth-token');
      asyncKv.clear();
      expect(await secureStorage.getItem('sb-auth-token')).toBe(bigSession);
    });
  });

  it('felülíráskor nem marad szemét darab', async () => {
    await secureStorage.setItem('k', bigSession);
    const many = keychain.size;
    await secureStorage.setItem('k', 'rövid');
    expect(keychain.size).toBeLessThan(many);
    expect(await secureStorage.getItem('k')).toBe('rövid');
  });

  it('HIÁNYOS lánc → null (soha nem ad vissza csonka tokent)', async () => {
    await secureStorage.setItem('k', bigSession);
    keychain.delete('k.1');
    expect(await secureStorage.getItem('k')).toBeNull();
  });

  it('törléskor minden darab eltűnik', async () => {
    await secureStorage.setItem('k', bigSession);
    await secureStorage.removeItem('k');
    expect(keychain.size).toBe(0);
    expect(await secureStorage.getItem('k')).toBeNull();
  });

  describe('🖥️ SSR (Node, nincs `window`) — a statikus web-export ne haljon el', () => {
    // A `web.output: "static"` mellett az expo-router NODE-ban rendereli a fát.
    // Az AsyncStorage web-implementációja `window.localStorage`-ra épül, ezért
    // enélkül a teljes export elszáll: `ReferenceError: window is not defined`.
    const realWindow = globalThis.window;
    // a külső `beforeEach` a TÁRAKAT üríti, a mock-hívásnaplót nem — itt viszont
    // épp azt állítjuk, hogy NEM történt hívás, ezért külön nullázzuk
    beforeEach(() => {
      jest.clearAllMocks();
    });
    afterEach(() => {
      globalThis.window = realWindow;
    });

    const removeWindow = () => {
      // @ts-expect-error — szándékosan szimuláljuk a Node-környezetet
      delete globalThis.window;
    };

    it('olvasáskor `null`, és HOZZÁ SEM NYÚL az AsyncStorage-hoz', async () => {
      removeWindow();
      await expect(secureStorage.getItem('sb-session')).resolves.toBeNull();
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('írás csendben elnyelődik (nincs hova perzisztálni)', async () => {
      removeWindow();
      await expect(secureStorage.setItem('sb-session', 'x')).resolves.toBeUndefined();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('törlés sem dob', async () => {
      removeWindow();
      await expect(secureStorage.removeItem('sb-session')).resolves.toBeUndefined();
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    });

    it('ha VAN `window`, a normál út fut tovább (nem nyeltünk el mindent)', async () => {
      await secureStorage.getItem('sb-session');
      expect(SecureStore.getItemAsync).toHaveBeenCalled();
    });
  });
});
