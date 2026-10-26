/**
 * 📐 Panel-layout mag — a „vászon-garancia" számolása (MOBILE-UI.md §4).
 *
 * MIÉRT: telefonon eddig a nyitott panel KIVÁLTOTTA az idővonalat, a lapok pedig
 * fix magasságúak voltak (egy hangerő-csúszka is 320 pt-t kapott). Itt EGY pure
 * függvény dönti el, mennyi hely jut az előnézetnek, az idővonalnak és a panelnek —
 * azzal a garanciával, hogy a szerkesztett tartalom (preview / vászon / sávok)
 * soha nem megy egy minimum alá.
 *
 * Felület-szintek:
 *  • `none`   — nincs panel: teljes idővonal + eszköztár.
 *  • `strip`  — gyors beállítás: a Strip az eszköztár HELYÉN, a vászon nem veszít.
 *  • `sheet`  — részletes beállítás, három detenttel (peek / half / full); a
 *               nyitott lap alatt az eszköztár rejtve (a lap fejléce hordozza a
 *               műveleteket), half/full-ban az idővonal mini-sorrá húzódik.
 *  • `focus`  — precíziós mód: minden króm rejtve, a vászon kapja a teljes body-t.
 *
 * Expo-mentes (csak számol) → önmagában tesztelhető.
 */

export type SurfaceTier = 'none' | 'strip' | 'sheet' | 'focus';
export type Detent = 'peek' | 'half' | 'full';
export type TimelineMode = 'full' | 'mini' | 'hidden';

export const DETENTS: readonly Detent[] = ['peek', 'half', 'full'];

/** A tervezési alapértékek (pt) — a §4 táblázata; eszközön mérve hangoljuk. */
export const PANEL_METRICS = {
  transport: 36,
  timelineMax: 180,
  timelineFrac: 0.24,
  timelineMini: 44,
  toolbar: 64,
  strip: 104,
  minPreviewAbs: 200,
  minPreviewFrac: 0.3,
  minPreviewKeyboard: 160,
  peekMin: 140,
  peekFrac: 0.22,
  halfFrac: 0.45,
  /** két detent ennél közelebb → összeolvasztjuk (kis kijelzőn nincs értelme két „szintnek") */
  detentMergeGap: 32,
} as const;

export interface LayoutBudgetInput {
  /** a body magassága: képernyő − safe area − fejléc */
  bodyHeight: number;
  tier: SurfaceTier;
  /** csak `sheet` szintnél számít */
  detent?: Detent;
  /** nyitott billentyűzet magassága (0 = zárva) */
  keyboardHeight?: number;
  /** van-e idővonal ebben a stúdióban (a Kép Stúdióban nincs) */
  hasTimeline?: boolean;
  /** van-e külön transport-sáv */
  hasTransport?: boolean;
  /** van-e alsó eszköztár */
  hasToolbar?: boolean;
  /** az idővonal sáv-magasság szorzója (`EditorMetrics.trackScale`) */
  trackScale?: number;
  /** a teljes idővonal MÉRT magassága (onLayout) — ha van, ez felülírja a becslést */
  timelineFullHeight?: number;
  /** a transport-sáv MÉRT magassága */
  transportHeight?: number;
  /** nagy kijelzőn (iPad-álló) a Sheet nem húzza mini-sorrá az idővonalat —
   *  csak ha a vászon-garancia másképp nem teljesülne */
  keepTimeline?: boolean;
}

export interface LayoutBudget {
  previewHeight: number;
  /** a garantált minimum, amit a preview ebben a helyzetben kap */
  minPreview: number;
  transportHeight: number;
  timelineMode: TimelineMode;
  timelineHeight: number;
  /** strip/sheet magassága (billentyűzet NÉLKÜL); 0, ha nincs panel */
  panelHeight: number;
  toolbarVisible: boolean;
  toolbarHeight: number;
  /** a Sheet detentjei px-ben (növekvő; összeolvasztás után egyenlők is lehetnek) */
  detents: Record<Detent, number>;
}

const round = (n: number) => Math.max(0, Math.round(n));

/** A preview garantált minimuma az adott magasságra (billentyűzetnél enyhébb). */
export function minPreviewFor(bodyHeight: number, keyboardOpen = false): number {
  const m = PANEL_METRICS;
  if (keyboardOpen) {
    return m.minPreviewKeyboard;
  }
  // nagyon alacsony body-n (pl. telefon-fekvő oldal-oszlop) sem követelhet a
  // preview többet a fele-magasságnál — különben a panel nulla lenne
  return round(Math.min(Math.max(m.minPreviewAbs, bodyHeight * m.minPreviewFrac), bodyHeight * 0.5));
}

/**
 * A Sheet detentjei. A `full` sosem viszi a preview-t a minimum alá; a kisebb
 * detentek nem nőhetnek a `full` fölé; a túl közeli detentek összeolvadnak.
 */
export function sheetDetents(
  bodyHeight: number,
  opts: Pick<LayoutBudgetInput, 'hasTimeline' | 'hasTransport' | 'keyboardHeight' | 'transportHeight'> = {}
): Record<Detent, number> {
  const m = PANEL_METRICS;
  const kb = opts.keyboardHeight ?? 0;
  const body = Math.max(0, bodyHeight - kb);
  const transport = opts.hasTransport === false ? 0 : (opts.transportHeight ?? m.transport);
  const mini = opts.hasTimeline === false ? 0 : m.timelineMini;
  const full = round(body - transport - mini - minPreviewFor(bodyHeight, kb > 0));
  let half = round(Math.min(bodyHeight * m.halfFrac, full));
  let peek = round(Math.min(Math.max(m.peekMin, bodyHeight * m.peekFrac), half));
  if (full - half < m.detentMergeGap) {
    half = full;
  }
  if (half - peek < m.detentMergeGap) {
    peek = half;
  }
  return { peek, half, full };
}

export function layoutBudget(input: LayoutBudgetInput): LayoutBudget {
  const m = PANEL_METRICS;
  const body = Math.max(0, input.bodyHeight);
  const kb = Math.max(0, input.keyboardHeight ?? 0);
  const hasTimeline = input.hasTimeline !== false;
  const hasTransport = input.hasTransport !== false;
  const hasToolbar = input.hasToolbar !== false;
  const detents = sheetDetents(body, {
    hasTimeline,
    hasTransport,
    keyboardHeight: kb,
    transportHeight: input.transportHeight,
  });
  const minPreview = minPreviewFor(body, kb > 0);

  if (input.tier === 'focus') {
    return {
      previewHeight: round(body),
      minPreview,
      transportHeight: 0,
      timelineMode: 'hidden',
      timelineHeight: 0,
      panelHeight: 0,
      toolbarVisible: false,
      toolbarHeight: 0,
      detents,
    };
  }

  const transportHeight = hasTransport ? round(input.transportHeight ?? m.transport) : 0;
  const fullTimeline = hasTimeline
    ? round(
        input.timelineFullHeight ??
          Math.min(m.timelineMax, body * m.timelineFrac) * (input.trackScale ?? 1)
      )
    : 0;

  let panelHeight = 0;
  let toolbarVisible = hasToolbar;
  // a Sheet half/full-ban és billentyűzetnél mini-idővonallal indul
  let timelineMode: TimelineMode = hasTimeline ? 'full' : 'hidden';

  if (input.tier === 'strip') {
    // a Strip az eszköztár HELYÉN — a vászon nem veszít
    panelHeight = m.strip;
    toolbarVisible = false;
  } else if (input.tier === 'sheet') {
    const detent = input.detent ?? 'peek';
    panelHeight = detents[detent];
    toolbarVisible = false;
    if (hasTimeline && !input.keepTimeline && (detent !== 'peek' || kb > 0)) {
      timelineMode = 'mini';
    }
  }

  const timelineHeightFor = (mode: TimelineMode) =>
    mode === 'full' ? fullTimeline : mode === 'mini' ? m.timelineMini : 0;
  const toolbarHeight = toolbarVisible ? m.toolbar : 0;
  const rest = (mode: TimelineMode) =>
    body - kb - transportHeight - timelineHeightFor(mode) - panelHeight - toolbarHeight;

  // 🛡️ vászon-garancia: ha a preview a minimum alá menne, előbb az idővonal
  // húzódik mini-sorrá, aztán (végső esetben) a panel enged.
  if (rest(timelineMode) < minPreview && timelineMode === 'full') {
    timelineMode = 'mini';
  }
  if (rest(timelineMode) < minPreview && panelHeight > 0) {
    panelHeight = round(Math.max(0, panelHeight - (minPreview - rest(timelineMode))));
  }

  return {
    previewHeight: round(rest(timelineMode)),
    minPreview,
    transportHeight,
    timelineMode,
    timelineHeight: timelineHeightFor(timelineMode),
    panelHeight,
    toolbarVisible,
    toolbarHeight,
    detents,
  };
}

/** A legközelebbi detent egy aktuális lap-magassághoz (+ sebesség-irány a snaphez). */
export function nearestDetent(
  detents: Record<Detent, number>,
  height: number,
  velocityY = 0
): Detent {
  // gyors lendítés: a mozgás irányába a következő detent (lefelé = kisebb)
  const ordered = DETENTS.filter((d, i) => i === 0 || detents[d] !== detents[DETENTS[i - 1]]);
  if (Math.abs(velocityY) > 800) {
    const up = velocityY < 0;
    const cands = ordered.filter((d) => (up ? detents[d] > height : detents[d] < height));
    if (cands.length > 0) {
      return up ? cands[0] : cands[cands.length - 1];
    }
  }
  let best: Detent = ordered[0];
  for (const d of ordered) {
    if (Math.abs(detents[d] - height) < Math.abs(detents[best] - height)) {
      best = d;
    }
  }
  return best;
}
