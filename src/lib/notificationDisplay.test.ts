import { notificationIconKind, notificationTimeLabel } from '@/lib/notificationDisplay';

describe('notificationIconKind', () => {
  it('a „system" zsák a data.kind / útvonal alapján pontos ikont kap', () => {
    expect(notificationIconKind({ type: 'system', route: '/channel/u1', data: { kind: 'follow' } })).toBe('follow');
    expect(notificationIconKind({ type: 'system', route: '/live/l1', data: { kind: 'live' } })).toBe('live');
    expect(notificationIconKind({ type: 'system', route: '/devices' })).toBe('security');
    expect(notificationIconKind({ type: 'info', route: '/chat/c1' })).toBe('message');
  });
  it('a saját típusok megmaradnak; ismeretlen → info', () => {
    expect(notificationIconKind({ type: 'render', route: '/editor/p' })).toBe('render');
    expect(notificationIconKind({ type: 'comment' })).toBe('comment');
    expect(notificationIconKind({ type: 'system' })).toBe('info');
  });
});

describe('notificationTimeLabel (helyi idő)', () => {
  const now = new Date(2026, 9, 27, 12, 0); // okt. 27. 12:00 helyi
  it('ma: helyi óra:perc', () => {
    expect(notificationTimeLabel(new Date(2026, 9, 27, 9, 5).toISOString(), now)).toEqual({ kind: 'clock', text: '09:05' });
  });
  it('tegnap: „tegnap" + óra', () => {
    expect(notificationTimeLabel(new Date(2026, 9, 26, 21, 25).toISOString(), now)).toEqual({ kind: 'yesterday', text: '21:25' });
  });
  it('a héten: N napja; régebben: dátum', () => {
    expect(notificationTimeLabel(new Date(2026, 9, 23, 8, 0).toISOString(), now)).toEqual({ kind: 'daysAgo', count: 4 });
    expect(notificationTimeLabel(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toEqual({ kind: 'date', text: '10.01.' });
  });
  it('hibás dátum nem dob', () => {
    expect(notificationTimeLabel('x', now)).toEqual({ kind: 'clock', text: '' });
  });
});
