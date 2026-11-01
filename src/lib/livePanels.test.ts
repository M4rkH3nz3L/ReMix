import { LIVE_PANELS, movePanel, normalizePanelOrder, panelIndexAfterDrag } from '@/lib/livePanels';

describe('normalizePanelOrder', () => {
  it('üresen az alap sorrend', () => {
    expect(normalizePanelOrder(undefined)).toEqual([...LIVE_PANELS]);
  });

  it('a mentett sorrend marad, az új panel a végére kerül', () => {
    expect(normalizePanelOrder(['mixer', 'scenes']).slice(0, 2)).toEqual(['mixer', 'scenes']);
    expect(normalizePanelOrder(['mixer'])).toHaveLength(LIVE_PANELS.length);
  });

  it('az ismeretlen és a duplikált elem kimarad', () => {
    expect(normalizePanelOrder(['x', 'mixer', 'mixer'])).toEqual(['mixer', ...LIVE_PANELS.filter((p) => p !== 'mixer')]);
  });
});

describe('panelIndexAfterDrag', () => {
  const h = [100, 200, 100];
  it('rövid húzás a helyén hagyja', () => {
    expect(panelIndexAfterDrag(h, 0, 20)).toBe(0);
    expect(panelIndexAfterDrag(h, 1, -20)).toBe(1);
  });

  it('a szomszéd közepén túl cserél', () => {
    expect(panelIndexAfterDrag(h, 0, 160)).toBe(1);
    expect(panelIndexAfterDrag(h, 2, -160)).toBe(1);
  });

  it('a végekig húzható', () => {
    expect(panelIndexAfterDrag(h, 0, 1000)).toBe(2);
    expect(panelIndexAfterDrag(h, 2, -1000)).toBe(0);
  });
});

describe('movePanel', () => {
  it('áthelyez', () => {
    expect(movePanel(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(movePanel(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
});
