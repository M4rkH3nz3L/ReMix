import { snapPosition, SNAP_THRESHOLD } from '@/lib/snapping';

// 🧲 Smart guides + snapping (vászon-réteg illesztés) pure pajzsa.

describe('snapPosition', () => {
  it('a küszöbön belül a KÖZÉPVONALRA ugrik (guide + kind=line)', () => {
    const r = snapPosition(0.5 + SNAP_THRESHOLD / 2, 0.2);
    expect(r.x).toBe(0.5);
    expect(r.guideX).toBe(0.5);
    expect(r.kindX).toBe('line');
  });

  it('a küszöbön kívül nincs illesztés (az eredeti pozíció, guide null)', () => {
    const r = snapPosition(0.2, 0.42); // egyik vonaltól sincs SNAP_THRESHOLD-on belül
    expect(r.x).toBe(0.2);
    expect(r.guideX).toBeNull();
    expect(r.kindX).toBeNull();
  });

  it('társ-réteg középvonalára illeszt (kind=peer), ha az a legközelebbi', () => {
    const r = snapPosition(0.41, 0.2, SNAP_THRESHOLD, { peers: [{ x: 0.4, y: 0.5 }] });
    expect(r.x).toBe(0.4);
    expect(r.kindX).toBe('peer');
  });

  it('rács-illesztés (kind=grid), ha rács van megadva', () => {
    const r = snapPosition(0.26, 0.2, SNAP_THRESHOLD, { grid: 4 }); // rács: 0,0.25,0.5,…
    expect(r.x).toBe(0.25);
    expect(r.kindX).toBe('grid');
  });
});
