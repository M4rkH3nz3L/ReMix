import { shearPoint, skewUnitCorners } from '@/lib/canvasTransform';
import { TRANSITION_XFADE, xfadeMode, type TransitionType } from '@/lib/transitions';
import { MAX_PROJECT_DURATION_SEC } from '@/lib/projectUtils';
import { PRESET_BEZIER, bezierEase } from '@/lib/keyframes';
import {
  VIDEO_EFFECTS,
  VIDEO_EFFECT_TYPES,
  effectChainFilters,
  effectFilterString,
} from '@/lib/videoEffects';
import type { VideoEffect } from '@/types/project';

/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7) — a videó-render tükrei (effektek, átmenetek, nyírás, easing, max-hossz, mikro-fade).
 *
 * A platformon több logika szándékosan "tükrözve" él mindkét oldalon: a **kliens**
 * TypeScript a preview/UI/soft-warn-hoz, a **worker** JavaScript a render/enforce-hoz.
 * A kettőnek bitre egyeznie KELL (preview == export, kliens-becslés == server-enforce),
 * különben csendben szétcsúsznak. Az egyes oldalak külön unit-tesztjei HARDCODE-olt
 * elvárásokkal dolgoznak — ezek viszont MINDKÉT oldalt importálják és EGYMÁShoz kötik,
 * így a drift azonnal piros tesztként jelentkezik (a CI-ben is).
 *
 * Megjegyzés: a worker-modulok sima CommonJS JS-ek — a kliens (jest-expo) projekt
 * babellel betölti őket; a `require` visszatérése `any`, ezért a tsc nem lép be a .js-be.
 * (A korábbi egyetlen contract.test.ts tartományonként bontva: *.contract.test.ts.)
 */

/* eslint-disable @typescript-eslint/no-require-imports -- a server/ CommonJS JS-modulja (típus nélkül), a kliens–worker szerződésteszt require-rel tölti */
const workerRender = require('../../server/render');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('contract: effekt-filterek (videoEffects.ts ⇄ server/render.js)', () => {
  it('effectFilterString azonos minden típus × amount-ra', () => {
    const amounts = [0, 0.3, 0.5, 0.7, 1];
    for (const type of VIDEO_EFFECT_TYPES) {
      for (const amount of amounts) {
        const e: VideoEffect = { id: 'x', type, amount };
        expect(workerRender.effectFilterStr(e)).toBe(effectFilterString(e));
      }
    }
  });

  it('null-amount VÉDELMI ág is azonos (per-típus default)', () => {
    // amount nélkül mindkét oldal a per-típus defaultAmount-ot használja
    for (const type of VIDEO_EFFECT_TYPES) {
      const e: VideoEffect = { id: 'x', type };
      expect(workerRender.effectFilterStr(e)).toBe(effectFilterString(e));
    }
  });

  it('EFFECT_DEFAULT_AMOUNT == a kliens VIDEO_EFFECTS defaultAmount-ja', () => {
    for (const type of VIDEO_EFFECT_TYPES) {
      expect(workerRender.EFFECT_DEFAULT_AMOUNT[type]).toBe(VIDEO_EFFECTS[type].defaultAmount);
    }
  });

  it('a teljes lánc-füzér azonos (effectChainFilters ⇄ effectChainFx), tiltott kimarad', () => {
    const effects: VideoEffect[] = [
      { id: 'a', type: 'grayscale', amount: 1 },
      { id: 'b', type: 'invert', amount: 1, enabled: false }, // tiltott → mindkét oldalon kimarad
      { id: 'c', type: 'blur', amount: 0.5 },
      { id: 'd', type: 'vignette', amount: 0.25 },
    ];
    expect(workerRender.effectChainFx({ effects })).toBe(effectChainFilters(effects));
  });
});

describe('contract: átmenet-xfade (transitions.ts ⇄ server/render.js)', () => {
  it('TRANSITION_XFADE BITRE egyezik a worker XFADE_MODES-szal (preview == export)', () => {
    // EGYETLEN forrás: a preview-geometria és a render ugyanabból a típus→xfade
    // leképezésből dolgozik — egyoldali bővítés itt azonnal piros.
    expect(workerRender.XFADE_MODES).toEqual(TRANSITION_XFADE);
  });

  it('mind a 17 átmenet-típus jelen van mindkét oldalon', () => {
    const clientKeys = Object.keys(TRANSITION_XFADE).sort();
    expect(clientKeys.length).toBe(17);
    expect(Object.keys(workerRender.XFADE_MODES).sort()).toEqual(clientKeys);
  });

  it('xfadeMode irány-variánsok azonosak (wipe/slide/cube + minden irány)', () => {
    const dirs: Array<'left' | 'right' | 'up' | 'down'> = ['left', 'right', 'up', 'down'];
    const types: TransitionType[] = [
      'wipeLeft',
      'wipeRight',
      'wipeUp',
      'wipeDown',
      'slideLeft',
      'slideRight',
      'cube',
      'zoom',
      'dissolve',
      'pixelize',
    ];
    for (const type of types) {
      // irány nélkül
      expect(workerRender.xfadeMode(type)).toBe(xfadeMode(type));
      // minden iránnyal
      for (const d of dirs) {
        expect(workerRender.xfadeMode(type, d)).toBe(xfadeMode(type, d));
      }
    }
  });
});

describe('contract: skew-nyírás (canvasTransform.ts ⇄ server/render.js)', () => {
  it('shearPoint bitre azonos minden (x,y,skewX,skewY) mintára', () => {
    const pts: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [0, 0],
      [0.5, 0.25],
    ];
    const skews: [number, number][] = [
      [0, 0],
      [10, 0],
      [0, 15],
      [30, -20],
      [45, 45],
      [-45, -30],
    ];
    for (const [x, y] of pts) {
      for (const [sx, sy] of skews) {
        const w = workerRender.shearPoint(x, y, sx, sy);
        const c = shearPoint(x, y, sx, sy);
        expect(w.x).toBeCloseTo(c.x, 12);
        expect(w.y).toBeCloseTo(c.y, 12);
      }
    }
  });

  it('a worker shearPoint az egységnégyzet sarkain == a kliens skewUnitCorners', () => {
    for (const [sx, sy] of [
      [12, 0],
      [0, 20],
      [25, -15],
    ] as [number, number][]) {
      const corners = skewUnitCorners(sx, sy); // [tl, tr, br, bl]
      const expected = (
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as [number, number][]
      ).map(([x, y]) => workerRender.shearPoint(x, y, sx, sy));
      corners.forEach((c, i) => {
        expect(c.x).toBeCloseTo(expected[i].x, 12);
        expect(c.y).toBeCloseTo(expected[i].y, 12);
      });
    }
  });
});

describe('contract: keyframe bezier-easing (keyframes.ts ⇄ server/render.js)', () => {
  it('bezierEaseNode azonos a bezierEase-szel minden preset-görbe × p-re', () => {
    const ps = [0, 0.1, 0.25, 0.5, 0.5001, 0.75, 0.9, 1];
    for (const cp of Object.values(PRESET_BEZIER)) {
      for (const p of ps) {
        expect(workerRender.bezierEaseNode(cp, p)).toBe(bezierEase(cp, p));
      }
    }
    // egyedi (nem-preset) görbére is azonos a felezéses megoldás
    const custom: [number, number, number, number] = [0.2, 0.8, 0.3, 0.9];
    for (const p of ps) {
      expect(workerRender.bezierEaseNode(custom, p)).toBe(bezierEase(custom, p));
    }
  });
});

describe('contract: videó max-hossz (projectUtils.ts ⇄ server/render.js)', () => {
  it('MAX_PROJECT_DURATION_SEC == MAX_RENDER_DURATION_SEC == 600 (10 perc)', () => {
    // a kliens figyelmeztet, a szerver hard-enforce-ol — a határnak EGYEZNIE kell (short-video scope)
    expect(MAX_PROJECT_DURATION_SEC).toBe(600);
    expect(workerRender.MAX_RENDER_DURATION_SEC).toBe(MAX_PROJECT_DURATION_SEC);
  });
});

describe('kattogásmentes vágás — kliens = worker (mikro-fade szabály)', () => {
  it('ugyanaz a fade-hossz és ugyanaz a split-felismerés', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a kliens-mag lusta betöltése (az eredeti fájlban a fenti blokk-tiltás alatt állt)
    const { edgeFades: clientEdgeFades, EDGE_FADE_SEC } = require('./offlineMix');
    const c = (id: string, start: number, duration: number, trimIn: number, extra = {}) =>
      ({ kind: 'audio', id, uri: 'u', start, duration, trimIn, volume: 1, fadeIn: 0, fadeOut: 0, ...extra });
    const clips = [c('a', 0, 1, 0), c('b', 1, 1, 1), c('x', 5, 1, 0.3, { fadeOut: 0.4 }), { ...c('y', 6, 1, 1.3), uri: 'masik' }];
    expect(workerRender.EDGE_FADE_SEC).toBe(EDGE_FADE_SEC);
    const server = workerRender.edgeFades({ tracks: [{ type: 'music', clips }] });
    const client = Object.fromEntries(clientEdgeFades(clips));
    expect(client).toEqual(server);
  });
});
