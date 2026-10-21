/**
 * 🔗 Átmenet-spec unit-tesztek (VIDEO 01.1): az irány-variánsok, a 17-típusos
 * leképezés teljessége, és a preview-geometria értelmes volta (B kint→bent).
 */
import {
  TRANSITION_XFADE,
  easeProgress,
  transitionPreviewGeometry,
  xfadeMode,
  type TransitionType,
} from '@/lib/transitions';

const ALL_TYPES: TransitionType[] = [
  'zoom',
  'spin',
  'flip',
  'cube',
  'circle',
  'dissolve',
  'wipeLeft',
  'wipeRight',
  'wipeUp',
  'wipeDown',
  'slideLeft',
  'slideRight',
  'pixelize',
  'blur',
  'fadeBlack',
  'fadeWhite',
  'radial',
];

const BOX = { w: 1080, h: 1920 };

describe('TRANSITION_XFADE', () => {
  it('mind a 17 típusra ad xfade-alapmódot (nincs hiányzó)', () => {
    for (const t of ALL_TYPES) {
      expect(typeof TRANSITION_XFADE[t]).toBe('string');
      expect(TRANSITION_XFADE[t].length).toBeGreaterThan(0);
    }
    expect(Object.keys(TRANSITION_XFADE).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('a kulcs-értékek a várt FFmpeg-nevek (a szerver-tükörrel egyeznek)', () => {
    expect(TRANSITION_XFADE.zoom).toBe('zoomin');
    expect(TRANSITION_XFADE.spin).toBe('squeezeh');
    expect(TRANSITION_XFADE.flip).toBe('squeezev');
    expect(TRANSITION_XFADE.cube).toBe('smoothleft');
    expect(TRANSITION_XFADE.circle).toBe('circleopen');
    expect(TRANSITION_XFADE.dissolve).toBe('dissolve');
    expect(TRANSITION_XFADE.pixelize).toBe('pixelize');
    expect(TRANSITION_XFADE.blur).toBe('hblur');
    expect(TRANSITION_XFADE.fadeBlack).toBe('fadeblack');
    expect(TRANSITION_XFADE.fadeWhite).toBe('fadewhite');
    expect(TRANSITION_XFADE.radial).toBe('radial');
  });
});

describe('xfadeMode — irány-variánsok', () => {
  it('irány nélkül az alapmódot adja', () => {
    expect(xfadeMode('wipeLeft')).toBe('wipeleft');
    expect(xfadeMode('slideRight')).toBe('slideright');
    expect(xfadeMode('cube')).toBe('smoothleft');
    expect(xfadeMode('dissolve')).toBe('dissolve');
  });

  it('wipe + irány → wipe{dir}', () => {
    expect(xfadeMode('wipeLeft', 'up')).toBe('wipeup');
    expect(xfadeMode('wipeRight', 'left')).toBe('wipeleft');
  });

  it('slide + irány → slide{dir}', () => {
    expect(xfadeMode('slideRight', 'down')).toBe('slidedown');
    expect(xfadeMode('slideLeft', 'right')).toBe('slideright');
  });

  it('cube + irány → smooth{dir}', () => {
    expect(xfadeMode('cube', 'right')).toBe('smoothright');
    expect(xfadeMode('cube', 'up')).toBe('smoothup');
  });

  it('nem-irányos típus irányra NEM változik', () => {
    expect(xfadeMode('zoom', 'left')).toBe('zoomin');
    expect(xfadeMode('dissolve', 'down')).toBe('dissolve');
    expect(xfadeMode('pixelize', 'up')).toBe('pixelize');
    expect(xfadeMode('radial', 'right')).toBe('radial');
  });
});

describe('transitionPreviewGeometry — mind a 17 típus értelmes', () => {
  it('minden típusnál progress=0 → B rejtve/kint, progress=1 → B bent/látható', () => {
    for (const t of ALL_TYPES) {
      const at0 = transitionPreviewGeometry(t, undefined, 0, BOX);
      const at1 = transitionPreviewGeometry(t, undefined, 1, BOX);

      // progress=1: a B klip helyén van (nincs eltolás, teljes méret, opacity≈1)
      expect(at1.translateX ?? 0).toBeCloseTo(0, 6);
      expect(at1.translateY ?? 0).toBeCloseTo(0, 6);
      expect(at1.scale ?? 1).toBeCloseTo(1, 6);
      expect(at1.opacity ?? 1).toBeGreaterThanOrEqual(0.99);

      // progress=0: a B klip "nincs ott" — vagy kint (translate≠0), vagy átlátszó
      const hidden0 =
        Math.abs(at0.translateX ?? 0) > 1 ||
        Math.abs(at0.translateY ?? 0) > 1 ||
        (at0.opacity ?? 1) < 0.05;
      expect({ t, hidden0 }).toEqual({ t, hidden0: true });
    }
  });

  it('a progresst 0…1-re szorítja (negatív / >1 nem borít)', () => {
    const under = transitionPreviewGeometry('dissolve', undefined, -0.5, BOX);
    const over = transitionPreviewGeometry('dissolve', undefined, 1.5, BOX);
    expect(under.opacity).toBe(0);
    expect(over.opacity).toBe(1);
  });

  it('irányos típus: a translate előjele az iránnyal fordul (wipe)', () => {
    const p = 0; // teljes eltolás
    const left = transitionPreviewGeometry('wipeLeft', 'left', p, BOX);
    const right = transitionPreviewGeometry('wipeRight', 'right', p, BOX);
    // left (kimenet balra → B jobbról, +X), right ellentétes előjel (-X)
    expect(Math.sign(left.translateX ?? 0)).toBe(1);
    expect(Math.sign(right.translateX ?? 0)).toBe(-1);

    const up = transitionPreviewGeometry('wipeUp', 'up', p, BOX);
    const down = transitionPreviewGeometry('wipeDown', 'down', p, BOX);
    expect(Math.sign(up.translateY ?? 0)).toBe(1);
    expect(Math.sign(down.translateY ?? 0)).toBe(-1);
  });

  it('explicit direction FELÜLÍRJA a típus-szuffixet (wipeLeft + dir=up → függőleges)', () => {
    const g = transitionPreviewGeometry('wipeLeft', 'up', 0, BOX);
    expect(g.translateY ?? 0).not.toBe(0);
    expect(g.translateX ?? 0).toBe(0);
  });

  it('zoom: beúszó nagyítás (scale>1 az elején) + kereszttűnés', () => {
    const g = transitionPreviewGeometry('zoom', undefined, 0, BOX);
    expect(g.scale ?? 1).toBeGreaterThan(1);
    expect(g.opacity).toBe(0);
  });

  it('spin: forgás az elején (rotateDeg≠0) + méret-beúszás', () => {
    const g = transitionPreviewGeometry('spin', undefined, 0, BOX);
    expect(g.rotateDeg ?? 0).not.toBe(0);
    expect(g.scale ?? 1).toBeLessThan(1);
  });

  it('flip: perspektíva + y-billenés az elején', () => {
    const g = transitionPreviewGeometry('flip', undefined, 0, BOX);
    expect(g.perspective ?? 0).toBeGreaterThan(0);
    expect(g.rotateYDeg ?? 0).not.toBe(0);
  });

  it('circle/radial: középről nyíló közelítés (kis scale az elején)', () => {
    for (const t of ['circle', 'radial'] as const) {
      const g = transitionPreviewGeometry(t, undefined, 0, BOX);
      expect(g.scale ?? 1).toBeLessThan(1);
      expect(g.scale ?? 1).toBeGreaterThan(0);
    }
  });

  it('pixelize/blur/dissolve/fade: kereszttűnés (csak opacity, nincs transform)', () => {
    for (const t of ['pixelize', 'blur', 'dissolve', 'fadeBlack', 'fadeWhite'] as const) {
      const g = transitionPreviewGeometry(t, undefined, 0.5, BOX);
      expect(g.opacity).toBe(0.5);
      expect(g.translateX).toBeUndefined();
      expect(g.translateY).toBeUndefined();
      expect(g.scale).toBeUndefined();
      expect(g.rotateDeg).toBeUndefined();
    }
  });
});

describe('easeProgress', () => {
  it('linear/undefined → változatlan, a végpontok 0/1', () => {
    expect(easeProgress(undefined, 0.3)).toBe(0.3);
    expect(easeProgress('linear', 0.42)).toBe(0.42);
    for (const e of ['easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(easeProgress(e, 0)).toBe(0);
      expect(easeProgress(e, 1)).toBe(1);
    }
  });

  it('easeIn lassabb az elején, easeOut gyorsabb (0.5 pontban)', () => {
    expect(easeProgress('easeIn', 0.5)).toBeLessThan(0.5);
    expect(easeProgress('easeOut', 0.5)).toBeGreaterThan(0.5);
    expect(easeProgress('easeInOut', 0.5)).toBeCloseTo(0.5, 6);
  });
});
