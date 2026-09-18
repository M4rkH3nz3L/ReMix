# ADR-004 — On-device = ingyen, felhő = lehet Pro (típus-kikényszerítve)

> ↑ [docs/hu index](../README.md) · [architecture/networking.md](../architecture/networking.md)

- **Státusz:** Elfogadva
- **Horgony:** [capabilities.ts](../../../src/lib/capabilities.ts)

## Kontextus
Az üzleti modell kulcs-szabálya: a kézi szerkesztés + alap export **mindig
ingyen** és az eszközön fut (valós felhasználónál is működik, szerver nélkül); a
fizetős infra csak a **worker/AI/felhő-tárhely**. Ezt a szabályt könnyű véletlenül
megsérteni (pl. egy on-device funkciót Pro mögé tenni) — és a hiba csak
futásidőben, a felhasználónál derülne ki.

## Döntés
A `CapabilityMeta` egy **diszkriminált unió**, amely típus-szinten tiltja a
tiltott kombinációt:

```ts
type CapabilityMeta =
  | { where: 'local'; pro: false; … }   // on-device ⇒ KÖTELEZŐEN ingyen
  | { where: 'cloud'; pro: boolean; … }; // felhő ⇒ lehet Pro (vagy ingyen)
```

Egy `{ where: 'local', pro: true }` sor **fordítási hibát** ad.

## Miért
- Az üzleti szabály minden `tsc --noEmit`-nél **automatikusan auditálva** van.
- Egy hely mondja ki, hol fut egy művelet és kell-e hozzá Pro — ezt a
  [backend-router](./ADR-009-backend-router.md) és a `nativeRender` olvassa.

## Elvetett alternatívák
- **Futásidejű ellenőrzés / konvenció** — csak a felhasználónál bukna ki.
- **Szétszórt Pro-flag-ek** — driftelnének, nincs egy igazság.

## Következmények
- Új capability = egy sor a katalógusban; a fordító őrzi a szabályt.
- A `soundLibrary` szándékos kivétel: `cloud` + `pro:false` (ingyenes felhő-funkció).

## Kapcsolódó
[ADR-009](./ADR-009-backend-router.md) (aki a `cap`-ot a kapuban használja).
