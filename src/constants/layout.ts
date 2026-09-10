/**
 * 📐 Layout-tokenek — a reszponzív elrendezés EGYETLEN forrása.
 *
 * MIÉRT: eddig négy külön küszöb élt szétszórva (orientáció a szerkesztőben és
 * a PanelHostban, `winW >= 700` az idővonalon, `width >= 640` a főképernyőn), és
 * minden méret (8/10/11px betűk, 14/16/20 paddingok) a komponensekbe volt égetve.
 * Telefonon ez működött, tableten nem: kifeszített telefon-layout lett belőle.
 *
 * Itt EGY méret-osztály-rendszer van (Apple size class / Material 3 szemlélet):
 *
 *   compact  (< 600pt)   telefon állóban — függőleges rakás, panel az idővonal helyén
 *   medium   (600–899)   telefon fekvőben, iPad állóban — bal rail + látszó idővonal
 *   expanded (>= 900)    iPad fekvőben, desktop — teljes NLE: rail + előnézet +
 *                        dokkolt inspector + teljes szélességű idővonal
 *
 * A használhatóság a fő szempont: nagyobb kijelzőn NEM nagyobbra fújjuk a
 * telefonos elrendezést, hanem TÖBB egyidejű információt mutatunk (panel ÉS
 * idővonal együtt), és minden érintőfelület eléri a 44pt-os minimumot.
 */

export type SizeClass = 'compact' | 'medium' | 'expanded';

/** A méret-osztályok küszöbei (pt). */
export const BREAKPOINTS = {
  medium: 600,
  expanded: 900,
  /** az `expanded` NLE-elrendezéshez ennyi FÜGGŐLEGES hely is kell */
  expandedMinHeight: 600,
} as const;

/** Az Apple HIG szerinti minimális kényelmes érintőfelület. */
export const TOUCH_MIN = 44;

/**
 * A méret-osztály MINDKÉT dimenzióból számol.
 *
 * MIÉRT: pusztán szélességből egy nagy telefon fekvőben (pl. 956×440) tévesen
 * `expanded` lenne, pedig ott függőlegesen alig van hely — a dokkolt inspector
 * + teljes szélességű idővonal ott használhatatlan. Az `expanded` ezért
 * magasságot is követel; így iPad fekvő → expanded, telefon fekvő → medium.
 */
export function sizeClassFor(width: number, height: number = Number.POSITIVE_INFINITY): SizeClass {
  if (width >= BREAKPOINTS.expanded && height >= BREAKPOINTS.expandedMinHeight) {
    return 'expanded';
  }
  if (width >= BREAKPOINTS.medium) {
    return 'medium';
  }
  return 'compact';
}

/** Térköz-skála — nagyobb kijelzőn levegősebb, de nem arányosan felfújt. */
export interface Spacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

const SPACING: Record<SizeClass, Spacing> = {
  compact: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 },
  medium: { xs: 5, sm: 10, md: 14, lg: 20, xl: 26 },
  expanded: { xs: 6, sm: 12, md: 18, lg: 24, xl: 32 },
};

/**
 * Tipográfia-szorzó. A 8–11px-es feliratok telefonon még olvashatók, tableten
 * (nagyobb nézési távolság) nem — ez emeli meg őket anélkül, hogy minden
 * komponensben külön méretet kellene tartani.
 */
const FONT_SCALE: Record<SizeClass, number> = {
  compact: 1,
  medium: 1.08,
  expanded: 1.18,
};

/** Szerkesztő-specifikus méretek méret-osztályonként. */
export interface EditorMetrics {
  /** bal eszköz-rail szélessége (0 = nincs rail) */
  railWidth: number;
  /** dokkolt inspector-oszlop szélessége (0 = nincs dokkolt panel) */
  inspectorWidth: number;
  /** az idővonal sáv-fejléc oszlopa (0 = rejtve, lebegő címkék helyette) */
  trackHeaderWidth: number;
  /** a sáv-magasságok szorzója (vastagabb sávok nagy kijelzőn) */
  trackScale: number;
  /** a toolbar-gombok minimális szélessége */
  toolButtonMinWidth: number;
}

const EDITOR: Record<SizeClass, EditorMetrics> = {
  compact: {
    railWidth: 0,
    inspectorWidth: 0,
    trackHeaderWidth: 0,
    trackScale: 1,
    toolButtonMinWidth: 60,
  },
  medium: {
    railWidth: 68,
    inspectorWidth: 0,
    trackHeaderWidth: 112,
    trackScale: 1.12,
    toolButtonMinWidth: 72,
  },
  expanded: {
    railWidth: 76,
    inspectorWidth: 360,
    trackHeaderWidth: 132,
    trackScale: 1.25,
    toolButtonMinWidth: 84,
  },
};

export interface LayoutTokens {
  sizeClass: SizeClass;
  isCompact: boolean;
  isExpanded: boolean;
  spacing: Spacing;
  editor: EditorMetrics;
  /** betűméret a méret-osztályhoz igazítva (kerekítve) */
  font: (base: number) => number;
  touchMin: number;
}

export function layoutTokens(sizeClass: SizeClass): LayoutTokens {
  const scale = FONT_SCALE[sizeClass];
  return {
    sizeClass,
    isCompact: sizeClass === 'compact',
    isExpanded: sizeClass === 'expanded',
    spacing: SPACING[sizeClass],
    editor: EDITOR[sizeClass],
    font: (base: number) => Math.round(base * scale),
    touchMin: TOUCH_MIN,
  };
}

/**
 * Rács-oszlopok szám a lista/galéria nézetekhez. A korábbi fix „640 → 2 oszlop"
 * helyett a kártya kívánt szélességéből számol, így 3–4 oszlop is lehet iPaden.
 */
export function gridColumns(width: number, minCardWidth = 320, max = 4): number {
  return Math.max(1, Math.min(max, Math.floor(width / minCardWidth)));
}
