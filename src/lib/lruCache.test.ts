import { ANALYSIS_CACHE_LIMIT, LruCache } from '@/lib/lruCache';

describe('LruCache — az elemzés-cache-ek nem nőhetnek korlátlanul', () => {
  it('a limit alatt mindent megtart', () => {
    const c = new LruCache<number>(3);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.size).toBe(2);
    expect(c.get('a')).toBe(1);
  });

  it('túlcsorduláskor a LEGRÉGEBBEN érintett esik ki', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.size).toBe(2);
    expect(c.has('a')).toBe(false); // ő volt a legrégebbi
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('az OLVASÁS frissít: a használt bejegyzés nem esik ki legközelebb', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // 'a' most a legfrissebb
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false); // most 'b' a legrégebbi
  });

  it('az ÚJRAÍRÁS is frissít, és nem duplikál', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 9); // 'a' frissül, nem nő a méret
    expect(c.size).toBe(2);
    c.set('c', 3);
    expect(c.get('a')).toBe(9);
    expect(c.has('b')).toBe(false);
  });

  it('a hiányzó kulcs undefined (megkülönböztethető a tárolt null-tól)', () => {
    const c = new LruCache<string | null>(2);
    c.set('van', null);
    expect(c.get('van')).toBeNull();
    expect(c.get('nincs')).toBeUndefined();
    expect(c.has('van')).toBe(true);
  });

  it('clear() mindent elenged (ezt hívja a „cache ürítése" gomb)', () => {
    const c = new LruCache<number>(5);
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get('a')).toBeUndefined();
  });

  it('delete() egy bejegyzést vesz ki', () => {
    const c = new LruCache<number>(5);
    c.set('a', 1);
    c.delete('a');
    expect(c.has('a')).toBe(false);
  });

  it('sok beszúrás után is PONTOSAN a limitnyi marad', () => {
    const c = new LruCache<number>(ANALYSIS_CACHE_LIMIT);
    for (let i = 0; i < 1000; i++) {
      c.set(`file_${i}`, i);
    }
    expect(c.size).toBe(ANALYSIS_CACHE_LIMIT);
    expect(c.has('file_999')).toBe(true); // a legutóbbiak maradtak
    expect(c.has('file_0')).toBe(false);
  });

  it('1-es limit is működik (határeset)', () => {
    const c = new LruCache<number>(1);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.size).toBe(1);
    expect(c.get('b')).toBe(2);
  });
});
