/**
 * ↩️ Vissza-verem — a hardveres vissza-gomb (Android) / vissza-gesztus a LEGFELSŐ
 * nyitott szerkesztő-felületet zárja (MOBILE-UI §3.2: Focus → Sheet → Strip → semmi).
 *
 * MIÉRT: a szerkesztő-lapok eddig saját `Modal`-ban éltek, aminek az
 * `onRequestClose`-a elkapta a vissza-gombot. Az inline (nem-modális) lapoknak
 * nincs ilyen — enélkül a vissza a teljes stúdiót / képernyőt zárná be. Itt
 * minden nyitott felület bejegyez egy kezelőt; a vissza a legutóbb bejegyzettet
 * hívja. A képernyők (BackHandler) és a stúdió-modálok (`onRequestClose`) ELŐBB
 * ide kérdeznek be, és csak akkor lépnek ki, ha a verem üres.
 *
 * Expo-mentes, modul-szintű állapot → önmagában tesztelhető.
 */

type BackHandlerFn = () => void;

const stack: { id: number; fn: BackHandlerFn }[] = [];
let nextId = 1;

/** Bejegyez egy vissza-kezelőt; a visszaadott függvény kiveszi (unmountkor hívandó). */
export function pushBack(fn: BackHandlerFn): () => void {
  const id = nextId++;
  stack.push({ id, fn });
  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i >= 0) {
      stack.splice(i, 1);
    }
  };
}

/**
 * A vissza-esemény kezelése: a legfelső bejegyzett felület kapja.
 * @returns true, ha valaki elnyelte (a hívó NE lépjen ki)
 */
export function handleBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) {
    return false;
  }
  top.fn();
  return true;
}

/** Hány felület van nyitva (teszt/diagnosztika). */
export function backDepth(): number {
  return stack.length;
}
