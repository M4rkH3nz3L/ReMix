import {
  DETENTS,
  layoutBudget,
  minPreviewFor,
  nearestDetent,
  PANEL_METRICS,
  sheetDetents,
  type Detent,
  type SurfaceTier,
} from '@/lib/panelLayout';

/** MOBILE-UI.md §4 mintaeszközei (body = képernyő − safe area − 44 pt fejléc) */
const DEVICES = {
  iphone17ProMax: 816,
  galaxyA33: 798,
  smallPhone: 583,
} as const;

describe('panelLayout — vászon-garancia', () => {
  describe('minPreviewFor', () => {
    it('max(200, 30%) — a nagyobb érvényes', () => {
      expect(minPreviewFor(816)).toBe(245);
      expect(minPreviewFor(583)).toBe(200);
    });
    it('billentyűzetnél enyhébb (160)', () => {
      expect(minPreviewFor(816, true)).toBe(PANEL_METRICS.minPreviewKeyboard);
    });
    it('nagyon alacsony body-n legfeljebb a fele-magasság', () => {
      expect(minPreviewFor(300)).toBe(150);
    });
  });

  describe('§4 mintaszámítás', () => {
    it.each([
      // [eszköz, zárt, peek, half, full]
      ['iphone17ProMax', 536, 420, 369, 245],
      ['galaxyA33', 518, 406, 359, 239],
      ['smallPhone', 343, 267, 241, 200],
    ] as const)('%s', (name, closed, peek, half, full) => {
      const body = DEVICES[name];
      expect(layoutBudget({ bodyHeight: body, tier: 'none' }).previewHeight).toBe(closed);
      const at = (detent: Detent) =>
        layoutBudget({ bodyHeight: body, tier: 'sheet', detent }).previewHeight;
      expect(at('peek')).toBe(peek);
      expect(at('half')).toBeGreaterThanOrEqual(half - 1);
      expect(at('half')).toBeLessThanOrEqual(half + 1);
      expect(at('full')).toBe(full);
    });
  });

  describe('invariánsok minden magasságon és szinten', () => {
    const heights = [360, 420, 500, 583, 640, 700, 798, 816, 900, 1100];
    const tiers: SurfaceTier[] = ['none', 'strip', 'sheet', 'focus'];
    it.each(heights)('body=%i: a preview soha nem megy a minimum alá', (h) => {
      for (const tier of tiers) {
        for (const detent of DETENTS) {
          const b = layoutBudget({ bodyHeight: h, tier, detent });
          expect(b.previewHeight).toBeGreaterThanOrEqual(b.minPreview);
        }
      }
    });
    it.each(heights)('body=%i: az elemek összege = body', (h) => {
      for (const tier of tiers) {
        const b = layoutBudget({ bodyHeight: h, tier, detent: 'half' });
        const sum = b.previewHeight + b.transportHeight + b.timelineHeight + b.panelHeight + b.toolbarHeight;
        expect(Math.abs(sum - h)).toBeLessThanOrEqual(1);
      }
    });
    it.each(heights)('body=%i: a detentek monoton nőnek', (h) => {
      const d = sheetDetents(h);
      expect(d.peek).toBeLessThanOrEqual(d.half);
      expect(d.half).toBeLessThanOrEqual(d.full);
    });
  });

  it('nincs panel: teljes idővonal + eszköztár', () => {
    const b = layoutBudget({ bodyHeight: 816, tier: 'none' });
    expect(b.timelineMode).toBe('full');
    expect(b.toolbarVisible).toBe(true);
    expect(b.panelHeight).toBe(0);
  });

  it('Strip: az eszköztár helyén, az idővonal teljes marad', () => {
    const b = layoutBudget({ bodyHeight: 816, tier: 'strip' });
    expect(b.toolbarVisible).toBe(false);
    expect(b.panelHeight).toBe(PANEL_METRICS.strip);
    expect(b.timelineMode).toBe('full');
  });

  it('Sheet peek: idővonal teljes; half/full: mini-idővonal (NEM tűnik el)', () => {
    expect(layoutBudget({ bodyHeight: 816, tier: 'sheet', detent: 'peek' }).timelineMode).toBe('full');
    expect(layoutBudget({ bodyHeight: 816, tier: 'sheet', detent: 'half' }).timelineMode).toBe('mini');
    expect(layoutBudget({ bodyHeight: 816, tier: 'sheet', detent: 'full' }).timelineMode).toBe('mini');
  });

  it('Focus: minden króm rejtve, a preview = body', () => {
    const b = layoutBudget({ bodyHeight: 816, tier: 'focus' });
    expect(b.previewHeight).toBe(816);
    expect(b.timelineMode).toBe('hidden');
    expect(b.toolbarVisible).toBe(false);
  });

  it('billentyűzet: a lap fölötte, mini-idővonal, preview ≥ 160', () => {
    const b = layoutBudget({ bodyHeight: 816, tier: 'sheet', detent: 'half', keyboardHeight: 336 });
    expect(b.timelineMode).toBe('mini');
    expect(b.previewHeight).toBeGreaterThanOrEqual(160);
    expect(b.panelHeight).toBeGreaterThan(0);
  });

  it('idővonal nélküli stúdió (Kép): nincs idővonal/transport, a vászon többet kap', () => {
    const b = layoutBudget({
      bodyHeight: 816,
      tier: 'sheet',
      detent: 'half',
      hasTimeline: false,
      hasTransport: false,
    });
    expect(b.timelineMode).toBe('hidden');
    expect(b.previewHeight).toBe(816 - b.panelHeight);
  });

  it('MÉRT idővonal-magasság: ha túl magas, peek-nél is mini-sorrá húzódik (garancia)', () => {
    const b = layoutBudget({ bodyHeight: 700, tier: 'sheet', detent: 'peek', timelineFullHeight: 360 });
    expect(b.timelineMode).toBe('mini');
    expect(b.previewHeight).toBeGreaterThanOrEqual(b.minPreview);
  });

  it('MÉRT idővonal-magasság: ha belefér, a becslés helyett azt használja', () => {
    const b = layoutBudget({ bodyHeight: 816, tier: 'none', timelineFullHeight: 150, transportHeight: 40 });
    expect(b.timelineHeight).toBe(150);
    expect(b.previewHeight).toBe(816 - 40 - 150 - PANEL_METRICS.toolbar);
  });

  it('keepTimeline (iPad-álló): half-on is teljes idővonal, ha a vászon kifér', () => {
    const b = layoutBudget({ bodyHeight: 1100, tier: 'sheet', detent: 'half', keepTimeline: true });
    expect(b.timelineMode).toBe('full');
    expect(b.previewHeight).toBeGreaterThanOrEqual(b.minPreview);
  });

  it('kis body-n a túl közeli detentek összeolvadnak', () => {
    const d = sheetDetents(420);
    expect(d.half === d.full || d.full - d.half >= PANEL_METRICS.detentMergeGap).toBe(true);
    expect(d.peek === d.half || d.half - d.peek >= PANEL_METRICS.detentMergeGap).toBe(true);
  });

  describe('nearestDetent', () => {
    const d = { peek: 180, half: 367, full: 527 };
    it('lassú elengedés: a legközelebbi', () => {
      expect(nearestDetent(d, 200)).toBe('peek');
      expect(nearestDetent(d, 330)).toBe('half');
      expect(nearestDetent(d, 500)).toBe('full');
    });
    it('gyors lendítés: a mozgás irányába a következő', () => {
      expect(nearestDetent(d, 200, -1200)).toBe('half');
      expect(nearestDetent(d, 360, 1200)).toBe('peek');
    });
    it('összeolvadt detenteknél az elsőt adja', () => {
      expect(nearestDetent({ peek: 200, half: 200, full: 300 }, 210)).toBe('peek');
    });
  });
});
