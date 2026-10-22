import { Sha256, sha256Hex, utf8ToBytes } from '@/lib/sha256';

/**
 * 🔐 SHA-256 — ismert (NIST / RFC) tesztvektorok + darabolás-invariancia.
 * A registry-letöltés checksum-ellenőrzése ezen áll (local-ai BP-2).
 */

describe('sha256', () => {
  it('üres bemenet (NIST vektor)', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"abc" (NIST vektor)', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('két-blokkos üzenet (NIST vektor)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('quick brown fox', () => {
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  it('1 millió "a" (NIST hosszú vektor) — több-blokkos, hossz-számláló helyes', () => {
    const chunk = new Uint8Array(100_000).fill(0x61); // 'a'
    const h = new Sha256();
    for (let i = 0; i < 10; i += 1) {
      h.update(chunk);
    }
    expect(h.digestHex()).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('darabolás-invariancia: tetszőleges határon vágott update = egyben', () => {
    const data = utf8ToBytes('árvíztűrő tükörfúrógép 🤖'.repeat(100));
    const whole = sha256Hex(data);
    for (const cut of [1, 7, 63, 64, 65, 200]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += cut) {
        h.update(data.subarray(i, Math.min(i + cut, data.length)));
      }
      expect(h.digestHex()).toBe(whole);
    }
  });

  it('utf8ToBytes: többbájtos + emoji kódolás helyes', () => {
    expect(Array.from(utf8ToBytes('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8ToBytes('€'))).toEqual([0xe2, 0x82, 0xac]);
    expect(Array.from(utf8ToBytes('🤖'))).toEqual([0xf0, 0x9f, 0xa4, 0x96]);
  });

  it('digest után az objektum lezárt (nincs néma újrahasználat)', () => {
    const h = new Sha256().update(utf8ToBytes('abc'));
    h.digestHex();
    expect(() => h.update(utf8ToBytes('x'))).toThrow();
    expect(() => h.digestHex()).toThrow();
  });
});
