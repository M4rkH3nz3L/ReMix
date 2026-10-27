import { timeAgoParts } from '@/lib/timeAgo';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

describe('timeAgoParts', () => {
  it.each([
    [10, 'now', 0],
    [5 * 60, 'minute', 5],
    [3 * 3600, 'hour', 3],
    [2 * 86400, 'day', 2],
    [8 * 86400, 'week', 1],
  ] as const)('%i mp → %s %i', (sec, unit, count) => {
    expect(timeAgoParts(ago(sec), NOW)).toEqual({ unit, count });
  });
  it('jövőbeli / hibás dátum → most', () => {
    expect(timeAgoParts(ago(-100), NOW).unit).toBe('now');
    expect(timeAgoParts('nem-dátum', NOW).unit).toBe('now');
  });
});
