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
