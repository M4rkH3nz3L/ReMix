/** 🔔 Az értesítés útvonala idegen adat is lehet: csak az app saját, ismert képernyője nyitható meg. */
const ROUTE_PREFIXES = ['/chat/', '/channel/', '/live/', '/collab/'];
const ROUTE_EXACT = ['/devices', '/schedules'];

export function isSafeNotificationRoute(route: string | null | undefined): route is string {
  if (typeof route !== 'string' || route.includes('..') || route.includes('://') || route.startsWith('//')) {
    return false;
  }
  return ROUTE_EXACT.includes(route) || ROUTE_PREFIXES.some((p) => route.startsWith(p) && route.length > p.length);
}
