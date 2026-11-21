/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7) — értesítés-útvonal.
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

describe('értesítés-útvonal: kliens = worker', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- a server/ CommonJS JS-modulja (típus nélkül), a kliens–worker szerződésteszt require-rel tölti */
  const { isSafeRoute } = require('../../server/security/notifyPolicy');
  const { isSafeNotificationRoute } = require('@/lib/notificationRoute');

  it.each(['/chat/1', '/channel/u', '/live/1', '/collab/p?owner=x', '/devices', '/schedules', 'https://x', '//x', '/chat/', '/a/../b', '/settings', '', null])('%j ugyanaz a döntés', (route) => {
    expect(isSafeNotificationRoute(route as string)).toBe(isSafeRoute(route));
  });
});
