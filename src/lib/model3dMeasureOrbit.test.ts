import { boundsFromPoints, vec3 } from '@/lib/model3d';
import {
  boundsVolume,
  formatArea,
  measurementLabelAt,
  measurementValue,
  polygonArea,
  polygonNormal,
  polygonPerimeter,
  polylineLength,
} from '@/lib/model3dMeasure';
import {
  cameraPosition,
  clampOrbit,
  defaultOrbit,
  fitToBounds,
  ORBIT_LIMITS,
  orbitPan,
  orbitRotate,
  orbitZoom,
  wrapAngle,
} from '@/lib/model3dOrbit';

const close = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);
const square = [vec3(0, 0, 0), vec3(2, 0, 0), vec3(2, 0, 3), vec3(0, 0, 3)]; // 2×3 m padló

describe('model3dMeasure', () => {
  it('vonallánc és kerület', () => {
    close(polylineLength(square), 7);
    close(polygonPerimeter(square), 10);
  });
  it('terület bármilyen síkon (padló és függőleges fal)', () => {
    close(polygonArea(square), 6);
    const wall = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 2.5, 0), vec3(0, 2.5, 0)];
    close(polygonArea(wall), 10);
    expect(polygonArea(square.slice(0, 2))).toBe(0);
  });
  it('térfogat, mérés-érték, címke-pozíció, normál', () => {
    close(boundsVolume(boundsFromPoints([vec3(0, 0, 0), vec3(1, 2, 3)])!), 6);
    close(measurementValue({ id: 'm', kind: 'distance', points: [vec3(0, 0, 0), vec3(0, 3, 4)] })!, 5);
    expect(measurementValue({ id: 'm', kind: 'distance', points: [vec3()] })).toBeNull();
    close(measurementValue({ id: 'a', kind: 'area', points: square })!, 6);
    expect(measurementLabelAt({ id: 'a', kind: 'area', points: square })).toEqual({ x: 1, y: 0, z: 1.5 });
    const n = polygonNormal(square)!;
    close(Math.abs(n.y), 1);
  });
  it('terület-formázás', () => {
    expect(formatArea(6)).toBe('6.00 m²');
    expect(formatArea(0.05)).toBe('500 cm²');
  });
});

describe('model3dOrbit', () => {
  it('a pitch korlátozott, a yaw körbefordul', () => {
    const c = clampOrbit({ ...defaultOrbit(), pitch: 10, yaw: 3 * Math.PI });
    close(c.pitch, ORBIT_LIMITS.pitchMax);
    close(Math.abs(c.yaw), Math.PI);
    close(wrapAngle(-3 * Math.PI), Math.PI);
  });
  it('húzás forgat, csippentés közelít, a távolság korlátos', () => {
    const c0 = defaultOrbit();
    expect(orbitRotate(c0, 100, 0).yaw).toBeLessThan(c0.yaw);
    expect(orbitZoom(c0, 2).distance).toBeCloseTo(c0.distance / 2);
    expect(orbitZoom(c0, 1e9).distance).toBe(ORBIT_LIMITS.minDistance);
  });
  it('kamera-pozíció: yaw=0, pitch=0 → a célpont előtt (+Z) távolságnyira', () => {
    const p = cameraPosition({ yaw: 0, pitch: 0, distance: 2, target: vec3(1, 0, 0), fov: 45 });
    close(p.x, 1);
    close(p.z, 2);
  });
  it('eltolás a kamera síkjában mozgatja a célpontot', () => {
    const c = orbitPan({ yaw: 0, pitch: 0, distance: 2, target: vec3(), fov: 45 }, -100, 0, 800);
    expect(c.target.x).toBeGreaterThan(0);
    close(c.target.y, 0);
  });
  it('fit-to-view: a célpont a doboz közepe, a távolság a mérettel nő; állón a szélesség a szűk', () => {
    const b = boundsFromPoints([vec3(-0.5, 0, -0.5), vec3(0.5, 1, 0.5)])!;
    const portrait = fitToBounds(defaultOrbit(), b, 9 / 16);
    const landscape = fitToBounds(defaultOrbit(), b, 16 / 9);
    close(portrait.target.y, 0.5);
    expect(portrait.distance).toBeGreaterThan(landscape.distance);
  });
});
