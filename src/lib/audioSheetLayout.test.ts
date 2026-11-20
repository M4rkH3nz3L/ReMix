import { inlineDetentOf, inlineSheetOf, sheetFrameOf } from '@/lib/audioSheetLayout';
import { layoutBudget } from '@/lib/panelLayout';

const flags = { editing: false, hasSelClip: false, mastering: false, mixerOpen: false };

describe('audioSheetLayout — a Hang Stúdió inline lapja', () => {
  it('inlineSheetOf: klip-szerk. csak kijelölt klippel, a sorrend clipEdit → master → mixer', () => {
    expect(inlineSheetOf(flags)).toBeNull();
    expect(inlineSheetOf({ ...flags, editing: true })).toBeNull();
    expect(inlineSheetOf({ ...flags, editing: true, hasSelClip: true, mastering: true, mixerOpen: true })).toBe('clipEdit');
    expect(inlineSheetOf({ ...flags, editing: true, mastering: true, mixerOpen: true })).toBe('master');
    expect(inlineSheetOf({ ...flags, hasSelClip: true, mixerOpen: true })).toBe('mixer');
    expect(inlineSheetOf({ ...flags, mastering: true, mixerOpen: true })).toBe('master');
  });

  it('inlineDetentOf: zárt lapnál peek, különben a megjegyzett, majd a regiszter kezdő értéke', () => {
    expect(inlineDetentOf(null, { mixer: 'full' })).toBe('peek');
    expect(inlineDetentOf('mixer', {})).toBe('half');
    expect(inlineDetentOf('mixer', { mixer: 'full', master: 'peek' })).toBe('full');
    expect(inlineDetentOf('master', { mixer: 'full', master: 'peek' })).toBe('peek');
    expect(inlineDetentOf('clipEdit', { mixer: 'full' })).toBe('half');
  });

  it('sheetFrameOf: amíg a gyökér nincs lemérve, nincs keret', () => {
    const onDetentChange = jest.fn();
    expect(sheetFrameOf({ rootH: 0, topBarH: 40, transportH: 60, inlineDetent: 'half', docked: false, onDetentChange })).toBeNull();
    expect(sheetFrameOf({ rootH: -5, topBarH: 0, transportH: undefined, inlineDetent: 'half', docked: true, onDetentChange })).toBeNull();
  });

  it('sheetFrameOf: a detentek a layoutBudget sheet-szintjéből, dokkolás nélkül nincs workspaceTop', () => {
    const onDetentChange = jest.fn();
    const f = sheetFrameOf({ rootH: 800, topBarH: 50, transportH: 70, inlineDetent: 'full', docked: false, onDetentChange });
    expect(f).toEqual({
      detents: layoutBudget({ bodyHeight: 750, tier: 'sheet', detent: 'full', hasTimeline: false, transportHeight: 70 }).detents,
      detent: 'full',
      onDetentChange,
      docked: false,
    });
    expect(f && 'workspaceTop' in f).toBe(false);
    expect(Object.keys(f ?? {})).toEqual(['detents', 'detent', 'onDetentChange', 'docked']);
  });

  it('sheetFrameOf: dokkolva a workspace a felület alsó ~58 %-án kezdődik (kerekítve)', () => {
    const f = sheetFrameOf({ rootH: 1001, topBarH: 50, transportH: undefined, inlineDetent: 'peek', docked: true, onDetentChange: () => {} });
    expect(f?.docked).toBe(true);
    expect(f?.workspaceTop).toBe(50 + Math.round(951 * 0.42));
    expect(f?.workspaceTop).toBe(449);
    expect(f?.detents).toEqual(layoutBudget({ bodyHeight: 951, tier: 'sheet', detent: 'peek', hasTimeline: false, transportHeight: undefined }).detents);
  });
});
