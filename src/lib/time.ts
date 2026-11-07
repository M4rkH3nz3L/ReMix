/** mp → "m:ss.t" formátum az előnézethez / idővonalhoz */
export function formatTime(seconds: number): string {
  // egész tizedekben (lefelé): a lebegőpontos maradék 10,2-ből 10,1-et csinált ((10,2 % 1)·10 = 1,999…)
  const tenths = Math.floor(Math.max(0, seconds) * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const sec = Math.floor((tenths % 600) / 10);
  return `${m}:${sec.toString().padStart(2, '0')}.${tenths % 10}`;
}

/** mp → "m:ss" a vonalzóhoz */
export function formatRuler(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
