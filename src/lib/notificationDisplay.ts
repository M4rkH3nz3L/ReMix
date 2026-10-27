import type { AppNotification } from '@/lib/notifications';

/**
 * 🔔 Értesítés-megjelenítés (pure): ikon-kategória és idő-címke.
 *
 * MIÉRT (élő iPhone-teszt N1/N2):
 *  • a „system" típus egy zsák (követő, élő adás, új belépés) — mind fogaskereket
 *    kapott; a pontos jelentést a `data.kind` / az útvonal hordozza;
 *  • az idő az ISO-szövegből kivágott óra:perc volt → UTC-ben (télen 1 óra eltérés),
 *    és dátum nélkül — egy tegnapi és egy mai tétel ugyanúgy nézett ki.
 */
export type NotifIconKind =
  | 'follow'
  | 'live'
  | 'security'
  | 'comment'
  | 'invite'
  | 'mention'
  | 'render'
  | 'message'
  | 'info';

export function notificationIconKind(n: Pick<AppNotification, 'type' | 'route' | 'data'>): NotifIconKind {
  const kind = typeof n.data?.kind === 'string' ? n.data.kind : '';
  const route = n.route ?? '';
  if (kind === 'follow' || (n.type === 'system' && route.startsWith('/channel/'))) return 'follow';
  if (kind === 'live' || route.startsWith('/live')) return 'live';
  if (route.startsWith('/devices') || kind === 'security') return 'security';
  if (route.startsWith('/chat/')) return 'message';
  switch (n.type) {
    case 'comment':
    case 'invite':
    case 'mention':
    case 'render':
      return n.type;
    default:
      return 'info';
  }
}

export type NotifTimeLabel =
  | { kind: 'clock'; text: string }
  | { kind: 'yesterday'; text: string }
  | { kind: 'daysAgo'; count: number }
  | { kind: 'date'; text: string };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * HELYI idő szerint: ma → óra:perc; tegnap → „tegnap" + óra:perc; egy héten belül →
 * N napja; régebben → hónap.nap. (A `now` paraméter a tesztelhetőséghez.)
 */
export function notificationTimeLabel(iso: string, now: Date = new Date()): NotifTimeLabel {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { kind: 'clock', text: '' };
  }
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return { kind: 'clock', text: clock };
  if (days === 1) return { kind: 'yesterday', text: clock };
  if (days < 7) return { kind: 'daysAgo', count: days };
  return { kind: 'date', text: `${pad(d.getMonth() + 1)}.${pad(d.getDate())}.` };
}
