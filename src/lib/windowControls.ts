/**
 * 🪟 Ablakos iPaden a rendszer ablakgombjai az app bal felső sarkára kerülnek, és a safe area
 * nem számol velük. A sarok fölött sávot tartunk fenn, így a vissza-nyíl minden képernyőn
 * elérhető marad. Teljes képernyőn és telefonon nincs ilyen gomb, ott nincs sáv se.
 */
export const WINDOW_CONTROLS_BOTTOM = 66;

export function windowControlsInset(
  isPad: boolean,
  window: { width: number; height: number },
  screen: { width: number; height: number }
): number {
  const windowed = window.width < screen.width || window.height < screen.height;
  return isPad && windowed ? WINDOW_CONTROLS_BOTTOM : 0;
}
