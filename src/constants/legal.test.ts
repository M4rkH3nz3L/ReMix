import { PRIVACY_POLICY, TERMS, legalText } from './legal';

// 🔒 A TECH-TOP §0 alap-direktíva (anti-CapCut) ZÁROLÁSA: a ToS-nak tartalmaznia KELL
// a tulajdon-megtartást + a nem-kizárólagos licencet + a vízjel-kivételt. Ha bárki
// „erősebb" (tulajdon-elvevő) klauzulára cserélné, ez a teszt piros lesz.

describe('legal — tartalom-tulajdon (anti-CapCut, TECH-TOP §0)', () => {
  test('a user MEGTARTJA a tartalma tulajdonát', () => {
    expect(TERMS).toMatch(/tulajdonod marad/i);
  });

  test('a platform CSAK nem-kizárólagos, díjmentes licencet kap (nem tulajdont)', () => {
    expect(TERMS).toMatch(/nem kizárólagos/i);
    expect(TERMS).toMatch(/NEM szerez tulajdont/i);
  });

  test('nincs hozzájárulás nélküli reklám-/AI-tanítás-felhasználás', () => {
    expect(TERMS).toMatch(/mesterséges\s+intelligencia\s+tanítására/i);
    expect(TERMS).toMatch(/hozzájárulásod\s+nélkül/i);
  });

  test('vízjel-kivétel: a „Made with ReMix" export a platformé, de a user szabadon használhatja', () => {
    expect(TERMS).toMatch(/Made with ReMix/);
    expect(TERMS).toMatch(/vízjel/i);
    expect(TERMS).toMatch(/korlátozás nélkül/i);
  });

  test('a user bármikor exportálhatja/elviheti a tartalmát', () => {
    expect(TERMS).toMatch(/exportálhatod/i);
  });

  test('legalText nem üres a terms/privacy-re', () => {
    expect(legalText('terms').length).toBeGreaterThan(100);
    expect(legalText('privacy').length).toBeGreaterThan(100);
    expect(PRIVACY_POLICY.length).toBeGreaterThan(100);
  });
});
