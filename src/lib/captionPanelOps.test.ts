import {
  FALLBACK_CAPTION,
  MAX_CAPTION,
  MIN_CAPTION,
  TARGET_LANGS,
  captionClip,
  captionLines,
  quickCaptionDuration,
} from '@/lib/captionPanelOps';

describe('captionPanelOps — gyors felirat', () => {
  it('soronként egy felirat: a szélek levágva, az üres sorok kihagyva', () => {
    expect(captionLines('  első \n\n második\n   \nharmadik  ')).toEqual(['első', 'második', 'harmadik']);
    expect(captionLines('')).toEqual([]);
    expect(captionLines('\n \n')).toEqual([]);
  });

  it('a soronkénti hossz a sáv egyenletes osztása 1–5 mp közé szorítva', () => {
    expect([MIN_CAPTION, MAX_CAPTION, FALLBACK_CAPTION]).toEqual([1, 5, 2.5]);
    expect(quickCaptionDuration(9, 3)).toBe(3);
    expect(quickCaptionDuration(30, 2)).toBe(5);
    expect(quickCaptionDuration(2, 10)).toBe(1);
  });

  it('ha a sáv legfeljebb 1 mp (vagy negatív), a tartalék 2,5 mp jár', () => {
    expect(quickCaptionDuration(1, 1)).toBe(2.5);
    expect(quickCaptionDuration(0.5, 1)).toBe(2.5);
    expect(quickCaptionDuration(-4, 2)).toBe(2.5);
  });

  it('az új felirat-klip az alsó harmadban, pop-animációval, a választott presettel', () => {
    const c = captionClip('Szia', 1.5, 2, 'neon');
    expect(c).toEqual({
      kind: 'text',
      id: expect.stringMatching(/^clip_/),
      start: 1.5,
      duration: 2,
      text: 'Szia',
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 5,
      fontWeight: 'bold',
      position: { x: 0.5, y: 0.78 },
      animation: 'pop',
      stylePreset: 'neon',
    });
    expect(captionClip('a', 0, 1, 'plain').id).not.toBe(c.id);
  });

  it('a fordítás öt cél-nyelve endonimával, rögzített sorrendben', () => {
    expect(TARGET_LANGS.map((l) => `${l.code}:${l.label}`)).toEqual([
      'en:English',
      'de:Deutsch',
      'hu:Magyar',
      'es:Español',
      'fr:Français',
    ]);
  });
});
