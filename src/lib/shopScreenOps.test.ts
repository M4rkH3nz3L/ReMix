import { MIN_SHOP_PRICE_CENTS, coinsToCents } from '@/lib/coins';
import { SHOP_KINDS, type ShopKind } from '@/lib/shop';
import { KIND_EMOJI, isBelowShopMinimum, kindEmoji } from '@/lib/shopScreenOps';

jest.mock('@/lib/shop', () => ({
  SHOP_KINDS: ['template', 'soundpack', 'overlay', 'lut', 'sfx', 'sticker', 'font', 'preset'],
}));

describe('shopScreenOps — a bolt-képernyő tiszta magja', () => {
  it('minden bolti fajtának van emojija (a 8 fajta rögzítve)', () => {
    expect(Object.keys(KIND_EMOJI).sort()).toEqual([...SHOP_KINDS].sort());
    expect(KIND_EMOJI.template).toBe('🎬');
    expect(KIND_EMOJI.soundpack).toBe('🥁');
    expect(KIND_EMOJI.lut).toBe('🎨');
  });

  it('a kártya-emoji: ismert fajtára a sajátja, ismeretlenre a sablon-emoji', () => {
    expect(kindEmoji('sfx')).toBe('🔊');
    expect(kindEmoji('weird' as ShopKind)).toBe('🎬');
  });

  it('a minimum-ár: 0 (ingyenes) engedett, 1…19 cent tiltott, 20 cent-től engedett', () => {
    expect(MIN_SHOP_PRICE_CENTS).toBe(20);
    expect(isBelowShopMinimum(0)).toBe(false);
    expect(isBelowShopMinimum(1)).toBe(true);
    expect(isBelowShopMinimum(19)).toBe(true);
    expect(isBelowShopMinimum(20)).toBe(false);
    expect(isBelowShopMinimum(123456)).toBe(false);
    expect(isBelowShopMinimum(-5)).toBe(false);
  });

  it('a beírt ár → cent → minimum-ellenőrzés lánc (a publikálás útja)', () => {
    expect(isBelowShopMinimum(coinsToCents('0,19'))).toBe(true);
    expect(isBelowShopMinimum(coinsToCents('0,2'))).toBe(false);
    expect(isBelowShopMinimum(coinsToCents('0,001'))).toBe(false); // 0-ra kerekít → ingyenes
    expect(isBelowShopMinimum(coinsToCents('abc'))).toBe(false);
    expect(isBelowShopMinimum(coinsToCents('-1'))).toBe(false);
  });
});
