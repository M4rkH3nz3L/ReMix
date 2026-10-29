import { floorPlanImageDoc } from '@/lib/roomFloorPlan';
import type { RoomSummary } from '@/types/model3d';

let n = 0;
const makeId = () => `id${n++}`;

const room: RoomSummary = {
  floorArea: 12,
  walls: [],
  openings: [],
  objects: [],
  floorPolygon: [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 3 },
    { x: 0, z: 3 },
  ],
};

describe('floorPlanImageDoc', () => {
  it('fehér lap + zárt padló-útvonal torzítás nélkül + falhossz-feliratok + cím', () => {
    const doc = floorPlanImageDoc(room, 'Nappali', '12 m²', makeId)!;
    expect(doc.layers[0]).toMatchObject({ kind: 'fill', fill: '#ffffff' });
    const floor = doc.layers.find((l) => l.kind === 'shape');
    expect(floor).toMatchObject({ shape: 'path', closed: true });
    if (floor?.kind !== 'shape') throw new Error('nincs padló');
    // 4×3 m → a doboz arányai 4:3 (a hosszabb oldal tölti ki)
    expect(floor.w / floor.h).toBeCloseTo(4 / 3, 6);
    expect(floor.points).toHaveLength(4);
    const texts = doc.layers.filter((l) => l.kind === 'text').map((l) => (l.kind === 'text' ? l.text : ''));
    expect(texts).toEqual(expect.arrayContaining(['4.00 m', '3.00 m', 'Nappali', '12 m²']));
    // minden pozíció a lapon belül
    for (const l of doc.layers) {
      if ('position' in l && l.position) {
        expect(l.position.x).toBeGreaterThanOrEqual(0);
        expect(l.position.x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('3-nál kevesebb sarokpont → null', () => {
    expect(floorPlanImageDoc({ ...room, floorPolygon: [{ x: 0, z: 0 }] }, 'x', '', makeId)).toBeNull();
  });
});
