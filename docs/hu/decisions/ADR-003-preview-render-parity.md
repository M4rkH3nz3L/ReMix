# ADR-003 — Preview közelít, render a mérvadó

> ↑ [docs/hu index](../README.md) · [architecture/rendering.md](../architecture/rendering.md)

- **Státusz:** Elfogadva
- **Horgony:** [types/project.ts](../../../src/types/project.ts) ·
  [server/render.js](../../../server/render.js) · [server/text-render.js](../../../server/text-render.js)

## Kontextus
A felhasználó valós idejű, akadásmentes előnézetet vár 60 fps-en — de a telefon
nem tud valós időben 3D-LUT-ot, per-frame optical flow-t, precíz tipográfiát vagy
összetett szűrőláncot számolni. A végeredménynek viszont pixel-pontosnak kell
lennie.

## Döntés
Két, szándékosan **eltérő pontosságú** út: az **előnézet** RN-eszközökkel
*közelít* (transform, mixBlendMode, tint), a **render** (worker: FFmpeg + headless
Chromium; ill. natív on-device) a *pontos* eredményt égeti be. A modell majdnem
minden „nehéz" mezője kimondja a kommentben, hogy a hatás a renderben érvényesül.

## Miért
- A valós idejű élmény és a pixel-pontosság **egyszerre** nem fér el a telefonon.
- A Chromium-raster garantálja, hogy a szöveg/forma stíluspresetek pixelre
  egyezzenek az előnézettel.
- A worker skálázható, a telefon nem.

## Elvetett alternatívák
- **Csak on-device, pontos előnézet** — nem fér bele a 60 fps-be a nehéz effekteknél.
- **WYSIWYG minden áron** — vagy akadna az előnézet, vagy szegényes maradna a render.

## Következmények
- **Új effekt sorrendje:** modell-mező + render-paritás → *utána* előnézeti
  közelítés (sosem fordítva).
- A paritás dokumentált mátrix ([rendering.md](../architecture/rendering.md)) —
  ami az előnézetben közelít, az a renderben pontos.

## Kapcsolódó
[ADR-007](./ADR-007-hybrid-render.md) (hol fut a render).
