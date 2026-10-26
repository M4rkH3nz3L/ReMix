import {
  AUDIO_SHEET_SPECS,
  IMAGE_SHEET_SPECS,
  openingTier,
  VIDEO_PANEL_SPECS,
  videoPanelSpec,
  type PanelSpec,
} from '@/lib/panelSpecs';
import { STANDALONE_PANELS } from '@/store/editorState';

const all = (r: Record<string, PanelSpec>) => Object.entries(r);

describe('panelSpecs — panel-regiszter', () => {
  it('minden standalone videó-panel szerepel a regiszterben', () => {
    for (const id of STANDALONE_PANELS) {
      expect(id && VIDEO_PANEL_SPECS[id]).toBeTruthy();
    }
  });

  it.each([
    ['videó', VIDEO_PANEL_SPECS],
    ['kép', IMAGE_SHEET_SPECS],
    ['hang', AUDIO_SHEET_SPECS],
  ] as const)('%s: a sheet-szintű lapoknak van kezdő detentje', (_, specs) => {
    for (const [, spec] of all(specs)) {
      if (spec.tier === 'sheet' || spec.tier === 'strip') {
        expect(spec.initialDetent).toBeDefined();
      }
    }
  });

  it('a modális (scrim-es) felület csak nem-élő feladat lehet', () => {
    const modal = [
      ...all(VIDEO_PANEL_SPECS),
      ...all(IMAGE_SHEET_SPECS),
      ...all(AUDIO_SHEET_SPECS),
    ]
      .filter(([, s]) => s.modal)
      .map(([id]) => id)
      .sort();
    expect(modal).toEqual(['addMedia', 'album', 'canvas', 'export', 'export', 'source', 'source', 'tts']);
  });

  it('élő korrekció soha nem modális (a vászon látszik húzás közben)', () => {
    expect(IMAGE_SHEET_SPECS.adjust.modal).toBeFalsy();
    expect(IMAGE_SHEET_SPECS.develop.modal).toBeFalsy();
    expect(VIDEO_PANEL_SPECS.filter.modal).toBeFalsy();
    expect(AUDIO_SHEET_SPECS.mixer.modal).toBeFalsy();
  });

  it('a precíziós panelek Focus-szintűek', () => {
    expect(VIDEO_PANEL_SPECS.precision.tier).toBe('focus');
    expect(VIDEO_PANEL_SPECS.pip.tier).toBe('focus');
  });

  it('a zongoratekercs/dobgép/sampler önálló munkafelület', () => {
    expect(AUDIO_SHEET_SPECS.pianoRoll.tier).toBe('workspace');
    expect(AUDIO_SHEET_SPECS.drumMachine.tier).toBe('workspace');
    expect(AUDIO_SHEET_SPECS.sampler.tier).toBe('workspace');
  });

  describe('openingTier', () => {
    it('null panel → null', () => {
      expect(openingTier(videoPanelSpec(null), false)).toBeNull();
    });
    it('strip „Részletek" után sheet', () => {
      const spec = videoPanelSpec('speed');
      expect(openingTier(spec, false)).toBe('strip');
      expect(openingTier(spec, true)).toBe('sheet');
    });
    it('a nem-strip panelek szintjét a kibontás nem változtatja', () => {
      expect(openingTier(videoPanelSpec('text'), true)).toBe('sheet');
      expect(openingTier(videoPanelSpec('precision'), true)).toBe('focus');
    });
  });
});
