/** 🧩 A Live Stúdió paneljeinek sorrendje (pure): ujjal átrendezhető, a mentett sorrend megmarad. */
export const LIVE_PANELS = ['scenes', 'sources', 'destinations', 'record', 'mixer', 'multistream'] as const;
export type LivePanelId = (typeof LIVE_PANELS)[number];

/** a mentett sorrend tisztítva: az ismeretlen kimarad, az új panel a végére kerül */
export function normalizePanelOrder(saved: readonly string[] | undefined): LivePanelId[] {
  const known = (saved ?? []).filter((id, i, all): id is LivePanelId => (LIVE_PANELS as readonly string[]).includes(id) && all.indexOf(id) === i);
  return [...known, ...LIVE_PANELS.filter((id) => !known.includes(id))];
}

/** Hová esik a húzott panel: a közepe a paneleket a saját közepükhöz mérve lépi át. */
export function panelIndexAfterDrag(heights: number[], from: number, dy: number): number {
  const tops = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0));
  const center = tops[from] + heights[from] / 2 + dy;
  const rest = heights.map((h, i) => ({ i, center: tops[i] + h / 2 })).filter((p) => p.i !== from);
  return rest.filter((p) => p.center < center).length;
}

export function movePanel<T>(order: T[], from: number, to: number): T[] {
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
