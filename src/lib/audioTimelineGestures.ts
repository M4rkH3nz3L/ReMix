/**
 * 🎧 Audio-idővonal gesztus-matematika (store-mentes, tesztelt).
 *
 * A klip függőleges húzása (sáv-váltás) tiszta számítása: a `dy` (px) elmozdulást
 * a sáv-magassághoz (laneH) viszonyítva sáv-lépéssé alakítja, és a cél-indexet a
 * [0, count-1] tartományra clampeli. A tényleges mozgatást (kompatibilitás-ellenőrzés
 * + command) a hívó végzi a `moveClip`-en át.
 */
export function audioLaneTarget(
  currentIndex: number,
  dy: number,
  laneH: number,
  count: number
): number {
  if (currentIndex < 0 || count <= 0 || laneH <= 0) {
    return currentIndex;
  }
  const step = Math.round(dy / laneH);
  return Math.max(0, Math.min(count - 1, currentIndex + step));
}

/** Egy pinch-lépéshez ennyi nagyítás kell (a ZOOM_LEVELS ~1,55× átlagos lépésköze). */
const PINCH_STEP = 1.6;

/**
 * 🔍 Pinch-skála → diszkrét zoom-szint index. A `startIndex` a csippentés kezdetén
 * érvényes szint; a `scale` (csippentés óta) logaritmikusan lépésekre váltódik
 * (minden ~1,6× = egy szint), majd a cél-index [0, levelCount-1]-re clampelve.
 */
export function zoomIndexForPinch(startIndex: number, scale: number, levelCount: number): number {
  if (!(scale > 0) || levelCount <= 0) {
    return startIndex;
  }
  const step = Math.round(Math.log(scale) / Math.log(PINCH_STEP));
  return Math.max(0, Math.min(levelCount - 1, startIndex + step));
}
