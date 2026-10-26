import { backDepth, handleBack, pushBack } from '@/lib/backStack';

describe('backStack — a vissza a legfelső felületet zárja', () => {
  it('üres verem: nem nyeli el (a hívó kiléphet)', () => {
    expect(backDepth()).toBe(0);
    expect(handleBack()).toBe(false);
  });

  it('a legutóbb bejegyzett kapja (Focus a Sheet fölött)', () => {
    const calls: string[] = [];
    const popSheet = pushBack(() => calls.push('sheet'));
    const popFocus = pushBack(() => calls.push('focus'));
    expect(handleBack()).toBe(true);
    expect(calls).toEqual(['focus']);
    popFocus();
    expect(handleBack()).toBe(true);
    expect(calls).toEqual(['focus', 'sheet']);
    popSheet();
    expect(backDepth()).toBe(0);
  });

  it('nem-LIFO kivétel (középső unmount) sem rontja el a sorrendet', () => {
    const calls: string[] = [];
    const a = pushBack(() => calls.push('a'));
    const b = pushBack(() => calls.push('b'));
    const c = pushBack(() => calls.push('c'));
    b();
    handleBack();
    expect(calls).toEqual(['c']);
    c();
    handleBack();
    expect(calls).toEqual(['c', 'a']);
    a();
  });

  it('a kétszeri kivétel ártalmatlan', () => {
    const pop = pushBack(() => {});
    pop();
    pop();
    expect(backDepth()).toBe(0);
  });
});
