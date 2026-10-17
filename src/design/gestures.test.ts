import { SNAP_PX } from '@/constants/editor';
import { TOUCH_MIN } from '@/constants/layout';
import { gestures } from '@/design/gestures';
import { SNAP_THRESHOLD } from '@/lib/snapping';

/**
 * 👆 Touch §01 — a központosított gesztus-config INVARIÁNSAI (drift-pajzs).
 *
 * MIÉRT: a szétszórt küszöbök egy helyre kerültek (`@/design/gestures`). Ez a
 * teszt rögzíti (a) a tulajdonjog-biztonsághoz szükséges rendezéseket
 * (tap < pan, drag < context, min < max), és (b) hogy a snap/touch-küszöbök a
 * MEGLÉVŐ egyetlen forrásra HIVATKOZNAK (nincs duplikált érték, ami elcsúszhat).
 */
describe('gestures config — invariánsok', () => {
  it('long-press: a mozgatás (drag) előbb aktiválódik, mint a kontextusmenü (context)', () => {
    expect(gestures.longPress.drag).toBeGreaterThan(0);
    expect(gestures.longPress.drag).toBeLessThan(gestures.longPress.context);
  });

  it('slop: a tap-küszöb kisebb, mint a pan (a koppintás nem vált véletlen húzásba)', () => {
    expect(gestures.slop.tap).toBeGreaterThan(0);
    expect(gestures.slop.tap).toBeLessThan(gestures.slop.pan);
  });

  it('sheet: pozitív dismiss-küszöbök (távolság + sebesség)', () => {
    expect(gestures.sheet.dismissDistance).toBeGreaterThan(0);
    expect(gestures.sheet.dismissVelocity).toBeGreaterThan(0);
  });

  it('pinch: a preview skála-clamp min < max és pozitív', () => {
    expect(gestures.pinch.previewScaleMin).toBeGreaterThan(0);
    expect(gestures.pinch.previewScaleMin).toBeLessThan(gestures.pinch.previewScaleMax);
  });
});

describe('gestures config — egyetlen forrás (nincs drift)', () => {
  it('a snap/touch-küszöbök a MEGLÉVŐ forrás-konstansokra hivatkoznak', () => {
    expect(gestures.snap.timelinePx).toBe(SNAP_PX);
    expect(gestures.snap.canvasNorm).toBe(SNAP_THRESHOLD);
    expect(gestures.touchMin).toBe(TOUCH_MIN);
  });
});
