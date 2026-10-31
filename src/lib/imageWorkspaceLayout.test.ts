import { sizeClassFor } from '@/constants/layout';
import { panelDefaults, panelState, workspaceLayout } from '@/lib/imageWorkspaceLayout';

const at = (w: number, h: number) => workspaceLayout(sizeClassFor(w, h), w);

describe('Kép Stúdió elrendezés', () => {
  it('telefonon a panelek a vászon fölé nyílnak, és a szélesség nagyja megmarad', () => {
    const phone = at(440, 956);
    expect(phone.mode).toBe('overlay');
    expect(phone.panelWidth).toBeLessThanOrEqual(440 * 0.8);
    expect(at(320, 568).panelWidth).toBe(256); // kis iPhone-on sem takar mindent
  });
  it('fekvő telefon is telefonos, ha nincs elég szélesség', () => {
    expect(at(430, 932).mode).toBe('overlay');
  });
  it('tableten sorba épül, és a vászonnak marad a nagyobb rész', () => {
    for (const [w, h] of [[834, 1194], [1024, 1366], [1366, 1024]]) {
      const l = at(w, h);
      expect(l.mode).toBe('inline');
      expect(w - l.railWidth - l.panelWidth).toBeGreaterThan(w * 0.55);
    }
  });
  it('alapból telefonon a rétegek csukva, tableten nyitva', () => {
    expect(panelDefaults('overlay')).toEqual({ rail: true, layers: false });
    expect(panelDefaults('inline')).toEqual({ rail: true, layers: true });
  });
  it('a választás eszköz-típusonként külön marad', () => {
    const saved = { overlay: { rail: false } };
    expect(panelState('overlay', saved)).toEqual({ rail: false, layers: false });
    expect(panelState('inline', saved)).toEqual({ rail: true, layers: true });
  });
});
