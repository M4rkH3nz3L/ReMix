import { addMarker, adjacentMarker, nearestMarker, snapToMarkers } from './audioMarkers';
import type { Marker } from '@/types/project';

const m = (id: string, time: number): Marker => ({ id, time, label: id });

describe('audioMarkers', () => {
  it('időrendben ad hozzá, azonos időre nem tesz kettőt', () => {
    const list = addMarker(addMarker([m('b', 5)], m('a', 1)), m('c', 3));
    expect(list.map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(addMarker(list, m('d', 3))).toBe(list);
  });
  it('a legközelebbi marker a tűrésen belül', () => {
    const list = [m('a', 1), m('b', 2)];
    expect(nearestMarker(list, 1.8, 0.3)?.id).toBe('b');
    expect(nearestMarker(list, 1.5, 0.3)).toBeNull();
  });
  it('snap a markerre csak a tűrésen belül', () => {
    const list = [m('a', 4)];
    expect(snapToMarkers(4.1, list, 0.15)).toBe(4);
    expect(snapToMarkers(4.3, list, 0.15)).toBe(4.3);
  });
  it('következő / előző marker', () => {
    const list = [m('a', 1), m('b', 5), m('c', 9)];
    expect(adjacentMarker(list, 5, 1)).toBe(9);
    expect(adjacentMarker(list, 5, -1)).toBe(1);
    expect(adjacentMarker(list, 9, 1)).toBeNull();
  });
});
