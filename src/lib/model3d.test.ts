import {
  boundsCenter,
  boundsFromPoints,
  boundsRadius,
  boundsSize,
  boundsUnion,
  cross,
  distance,
  formatLength,
  identityTransform,
  quatFromAxisAngle,
  quatIdentity,
  quatMultiply,
  quatSlerp,
  rotateVec,
  transformBounds,
  transformPoint,
  vec3,
  withUniformScale,
} from '@/lib/model3d';

const close = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);
const closeVec = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  close(a.x, b.x);
  close(a.y, b.y);
  close(a.z, b.z);
};

describe('model3d — geometria', () => {
  it('vektor: kereszt- és távolság', () => {
    closeVec(cross(vec3(1, 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1));
    close(distance(vec3(0, 0, 0), vec3(3, 4, 0)), 5);
  });

  it('kvaternió: 90° az Y körül az X-et −Z-be viszi (jobbkezes, +Y fel)', () => {
    const q = quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    closeVec(rotateVec(q, vec3(1, 0, 0)), vec3(0, 0, -1));
  });

  it('kvaternió-szorzás = egymás utáni forgatás', () => {
    const q90 = quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const q180 = quatMultiply(q90, q90);
    closeVec(rotateVec(q180, vec3(1, 0, 0)), vec3(-1, 0, 0));
  });

  it('slerp: a végpontokban a bemenetet adja, félúton félszöget', () => {
    const a = quatIdentity();
    const b = quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    closeVec(rotateVec(quatSlerp(a, b, 0), vec3(1, 0, 0)), vec3(1, 0, 0));
    closeVec(rotateVec(quatSlerp(a, b, 1), vec3(1, 0, 0)), vec3(0, 0, -1));
    const half = rotateVec(quatSlerp(a, b, 0.5), vec3(1, 0, 0));
    close(half.x, Math.SQRT1_2);
    close(half.z, -Math.SQRT1_2);
  });

  it('transzformáció: skála → forgatás → eltolás sorrend', () => {
    const t = {
      position: vec3(1, 0, 0),
      rotation: quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
      scale: vec3(2, 2, 2),
    };
    closeVec(transformPoint(t, vec3(1, 0, 0)), vec3(1, 0, -2));
    closeVec(transformPoint(identityTransform(), vec3(5, 6, 7)), vec3(5, 6, 7));
  });

  it('uniform skála: nem mehet 0 alá', () => {
    expect(withUniformScale(identityTransform(), -3).scale.x).toBeGreaterThan(0);
  });

  it('befoglaló doboz: pontokból, unió, középpont, méret, sugár', () => {
    const b = boundsFromPoints([vec3(-1, 0, -1), vec3(1, 2, 1)])!;
    closeVec(boundsCenter(b), vec3(0, 1, 0));
    closeVec(boundsSize(b), vec3(2, 2, 2));
    close(boundsRadius(b), Math.sqrt(12) / 2);
    expect(boundsFromPoints([])).toBeNull();
    const u = boundsUnion([b, boundsFromPoints([vec3(5, 5, 5)])!])!;
    closeVec(u.max, vec3(5, 5, 5));
  });

  it('forgatott doboz befoglalója a 8 sarokból (45°-nál szélesebb)', () => {
    const b = boundsFromPoints([vec3(-1, -1, -1), vec3(1, 1, 1)])!;
    const t = { ...identityTransform(), rotation: quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 4) };
    const r = transformBounds(t, b);
    close(r.max.x, Math.SQRT2);
    close(r.max.y, 1);
  });

  it('hossz-formázás: automatikus egység', () => {
    expect(formatLength(1.234)).toBe('1.23 m');
    expect(formatLength(0.456)).toBe('45.6 cm');
    expect(formatLength(0.004)).toBe('4 mm');
    expect(formatLength(1, 'in')).toBe('39.4 in');
  });
});
