import { WINDOW_CONTROLS_BOTTOM, windowControlsInset } from '@/lib/windowControls';

const screen = { width: 1366, height: 1024 };

describe('ablakgombok sávja', () => {
  it('teljes képernyőn nincs sáv', () => {
    expect(windowControlsInset(true, screen, screen)).toBe(0);
  });
  it('ablakos iPaden van sáv, akkor is, ha csak az egyik méret kisebb', () => {
    expect(windowControlsInset(true, { width: 1125, height: 903 }, screen)).toBe(WINDOW_CONTROLS_BOTTOM);
    expect(windowControlsInset(true, { width: 1366, height: 903 }, screen)).toBe(WINDOW_CONTROLS_BOTTOM);
  });
  it('telefonon sosincs sáv', () => {
    expect(windowControlsInset(false, { width: 390, height: 700 }, { width: 390, height: 844 })).toBe(0);
  });
});
