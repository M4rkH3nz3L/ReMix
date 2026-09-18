/**
 * 🪟 Idővonal-virtualizáció tiszta magja (expo-mentes → tesztelhető).
 *
 * A klipek másodpercben élnek, a képernyőn `pps` (pixel/másodperc) skálán. A
 * látható ABLAK px-ben, a görgethető belső view lokális koordinátájában van
 * megadva. Ez a modul csak a geometriát számolja — nincs React/Reanimated benne.
 */

export interface Span {
  /** kezdet másodpercben */
  start: number;
  /** hossz másodpercben */
  duration: number;
}

export interface PxWindow {
  /** bal él px */
  start: number;
  /** jobb él px */
  end: number;
}

/**
 * Látszik-e a `span` a px-`win` ablakban `pps` skálán? `null` ablak → minden
 * látszik (virtualizáció kikapcsolva). A metszés fél-nyílt: az ablakot érintő,
 * de bele nem érő klip nem számít láthatónak.
 */
export function clipInWindow(span: Span, win: PxWindow | null, pps: number): boolean {
  if (!win) {
    return true;
  }
  const left = span.start * pps;
  const right = (span.start + span.duration) * pps;
  return left < win.end && right > win.start;
}

/**
 * A `scrollX` (px) köré CENTRÁLT ablak, mindkét oldalon `overscanFactor`
 * viewportnyi pufferrel. A középre-rögzített lejátszófej miatt a lokális látható
 * sáv scrollX körül szimmetrikus (± viewportW/2), erre jön az overscan.
 */
export function windowFor(scrollX: number, viewportW: number, overscanFactor: number): PxWindow {
  const overscan = viewportW * overscanFactor;
  return {
    start: scrollX - viewportW / 2 - overscan,
    end: scrollX + viewportW / 2 + overscan,
  };
}
