import {
  animatedProps,
  bounceOut,
  glowCopyOf,
  karaokeWordsOf,
  presetStyles,
  shownText,
  STROKE_DIRS,
  text3dFaceColor,
  textTypography,
} from '@/lib/textOverlayStyle';
import type { TextClip } from '@/types/project';

const base = {
  kind: 'text', id: 't', start: 0, duration: 4, text: 'egy két három', color: '#abcdef', backgroundColor: null,
  fontSize: 6, fontWeight: 'bold', position: { x: 0.5, y: 0.5 }, animation: 'none',
} as TextClip;
const clip = (patch: Partial<TextClip>) => ({ ...base, ...patch }) as TextClip;

describe('textOverlayStyle — animáció a playheadből', () => {
  it('a bounceOut a négy szakasz határain folytonos és 1-be ér', () => {
    expect(bounceOut(0)).toBe(0);
    expect(bounceOut(1)).toBeCloseTo(1);
    expect(bounceOut(1 / 2.75)).toBeCloseTo(0.75 + 7.5625 * (1 / 2.75 - 1.5 / 2.75) ** 2);
    expect(bounceOut(0.5)).toBeCloseTo(7.5625 * (0.5 - 1.5 / 2.75) ** 2 + 0.75);
  });

  it('a belépő animációk 0,4 mp alatt érnek be, a típusírás 0,06 mp/karakter', () => {
    expect(animatedProps(clip({ animation: 'fade' }), 0.2)).toEqual({ opacity: 0.5, translateY: 0, scale: 1, chars: 13 });
    expect(animatedProps(clip({ animation: 'slide' }), 0.1)).toEqual({ opacity: 0.25, translateY: 22.5, scale: 1, chars: 13 });
    expect(animatedProps(clip({ animation: 'typewriter' }), 0.13)).toMatchObject({ chars: 2 });
    expect(animatedProps(clip({ animation: 'pop' }), 0.15)).toEqual({ opacity: 1, translateY: 0, scale: 1.2 * 0.5 * 1.5, chars: 13 });
    expect(animatedProps(clip({ animation: 'pop' }), 1)).toMatchObject({ scale: 1 });
    expect(animatedProps(clip({ animation: 'none' }), 1)).toEqual({ opacity: 1, translateY: 0, scale: 1, chars: 13 });
  });

  it('a kinetikus szöveg a lépésközt a darabszámhoz igazítja (max 2,4 mp össz-késés)', () => {
    // 3 szó, 0,08 lépésköz, 0,4 hossz → össz 0,56 mp
    expect(animatedProps(clip({ textMotion: { preset: 'reveal', by: 'word' } }), 0.56)).toMatchObject({ opacity: 1, translateY: 0 });
    expect(animatedProps(clip({ textMotion: { preset: 'typeOn', by: 'char' } }), 0.09)).toMatchObject({ chars: 3 });
    // 200 karakternél a lépésköz 2,4/199-re szűkül
    const long = clip({ text: 'x'.repeat(200), textMotion: { preset: 'typeOn', by: 'char' } });
    expect(animatedProps(long, 1.2).chars).toBe(Math.floor(1.2 / (2.4 / 199)));
    expect(animatedProps(clip({ textMotion: { preset: 'wave', by: 'line' } }), 0.4).translateY).toBeCloseTo(6);
  });
});

describe('textOverlayStyle — stílus', () => {
  it('a preset doboz- és szöveg-stílust ad; a neon a saját színével ragyog', () => {
    expect(presetStyles(clip({ stylePreset: 'bubble' }), 20).box).toEqual({ backgroundColor: '#000000b3', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 });
    expect(presetStyles(clip({ stylePreset: 'outline' }), 50).text).toMatchObject({ textShadowRadius: 6, fontWeight: '900' });
    expect(presetStyles(clip({ stylePreset: 'neon' }), 10).text).toMatchObject({ textShadowColor: '#abcdef', textShadowRadius: 8 });
    expect(presetStyles(base, 10)).toEqual({
      box: { backgroundColor: 'transparent' },
      text: { textShadowColor: '#000000aa', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
    });
  });

  it('a 3D felület-szín anyagonként, a körvonal 8 irányba tol', () => {
    expect(text3dFaceColor({ depth: 1, tiltX: 0, tiltY: 0, material: 'chrome' }, '#fff')).toBe('#d5d8e2');
    expect(text3dFaceColor({ depth: 1, tiltX: 0, tiltY: 0, material: 'gold' }, '#fff')).toBe('#f2c14e');
    expect(text3dFaceColor({ depth: 1, tiltX: 0, tiltY: 0, material: 'neon' }, '#123')).toBe('#123');
    expect(STROKE_DIRS).toHaveLength(8);
  });

  it('a tipográfia: sorköz-szorzó (alap 1,25), betűköz em-arány; 3D-nél nincs', () => {
    expect(textTypography(base, 20)).toEqual({ lineHeight: 25 });
    expect(textTypography(clip({ lineHeight: 2, letterSpacing: 0.1 }), 20)).toEqual({ lineHeight: 40, letterSpacing: 2 });
    expect(textTypography(clip({ lineHeight: -1 }), 20)).toEqual({ lineHeight: 25 });
    expect(textTypography(clip({ text3d: { depth: 1, tiltX: 0, tiltY: 0, material: 'gold' } }), 20)).toBeNull();
  });

  it('a második ragyogás-réteg: belső g/2 réteg, single-nél nincs, neonnál a külső réteg', () => {
    expect(glowCopyOf(clip({ textStyle: { glow: { color: '#0ff', size: 0.4 } } }), 20)).toEqual({ color: '#0ff', radius: 4 });
    expect(glowCopyOf(clip({ textStyle: { glow: { color: '#0ff', size: 0.1 } } }), 20)).toEqual({ color: '#0ff', radius: 2 });
    expect(glowCopyOf(clip({ textStyle: { glow: { color: '#0ff', size: 0.4, single: true } } }), 20)).toBeNull();
    expect(glowCopyOf(clip({ stylePreset: 'neon', textStyle: { glow: { color: '#0ff', size: 0 } } }), 10)).toEqual({ color: '#abcdef', radius: 16 });
    expect(glowCopyOf(base, 10)).toBeNull();
    expect(glowCopyOf(clip({ stylePreset: 'neon', text3d: { depth: 1, tiltX: 0, tiltY: 0, material: 'gold' } }), 10)).toBeNull();
  });
});

describe('textOverlayStyle — látszó szöveg és karaoke', () => {
  it('csak gépelésnél szeletel, negatív darabszámra üres', () => {
    expect(shownText(clip({ animation: 'typewriter' }), 3)).toBe('egy');
    expect(shownText(clip({ textMotion: { preset: 'typeOn', by: 'char' } }), -2)).toBe('');
    expect(shownText(clip({ animation: 'fade' }), 3)).toBe('egy két három');
  });

  it('karaoke: a szavak az idő arányában gyulladnak; kiemelés nélkül és nem-karaokénál nincs', () => {
    expect(karaokeWordsOf(base, 1)).toBeNull();
    expect(karaokeWordsOf(clip({ animation: 'karaoke' }), 2)?.map((w) => w.state)).toEqual(['past', 'active', 'next']);
    expect(karaokeWordsOf(clip({ animation: 'karaoke', text: '   ' }), 2)).toBeNull();
  });

  it('a kiemelt szavak sima feliraton is szavanként mennek, mind „past" állapotban', () => {
    expect(karaokeWordsOf(clip({ emphasis: [2] }), 0)).toEqual([
      { word: 'egy', state: 'past', emp: false },
      { word: 'két', state: 'past', emp: false },
      { word: 'három', state: 'past', emp: true },
    ]);
  });
});
