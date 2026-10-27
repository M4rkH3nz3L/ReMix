import { vec3 } from '@/lib/model3d';
import { ease, frameCount, interpolateOrbit, turntablePath, viewsPath } from '@/lib/model3dCameraPath';
import { defaultOrbit } from '@/lib/model3dOrbit';
import { outputSize, parseAspect, planRenderJob } from '@/lib/model3dRenderJob';

const close = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('model3dCameraPath', () => {
  it('képkockaszám a frame-rácson', () => {
    expect(frameCount(4, 30)).toBe(120);
    expect(frameCount(0, 30)).toBe(1);
  });
  it('easing: végpontok és szimmetria', () => {
    expect(ease(0, 'easeInOut')).toBe(0);
    expect(ease(1, 'easeInOut')).toBe(1);
    close(ease(0.5, 'easeInOut'), 0.5);
  });
  it('teljes kör: hurkolható (az utolsó kocka nem egyezik az elsővel), egyenletes lépés', () => {
    const p = turntablePath({ ...defaultOrbit(), yaw: 0 }, { seconds: 1, fps: 4 });
    expect(p).toHaveLength(4);
    close(p[1].yaw, -Math.PI / 2);
    close(Math.abs(p[2].yaw), Math.PI);
  });
  it('irány megfordítható; részleges ív easinggel végpontig ér', () => {
    const cw = turntablePath({ ...defaultOrbit(), yaw: 0 }, { seconds: 1, fps: 4, direction: -1 });
    close(cw[1].yaw, Math.PI / 2);
    const arc = turntablePath({ ...defaultOrbit(), yaw: 0 }, { seconds: 1, fps: 5, degrees: 90 });
    close(arc[arc.length - 1].yaw, -Math.PI / 2);
  });
  it('interpoláció a rövidebb úton (170° → −170° = 20°-os fordulat)', () => {
    const a = { ...defaultOrbit(), yaw: (170 * Math.PI) / 180 };
    const b = { ...defaultOrbit(), yaw: (-170 * Math.PI) / 180 };
    const mid = interpolateOrbit(a, b, 0.5);
    close(Math.abs(mid.yaw), Math.PI);
  });
  it('nézet-pálya: a kulcsnézeteken áthalad, egy nézetnél állókép', () => {
    const v1 = { ...defaultOrbit(vec3(0, 0, 0)), yaw: 0, distance: 1 };
    const v2 = { ...v1, yaw: 1, distance: 2 };
    const v3 = { ...v1, yaw: 2, distance: 3 };
    const p = viewsPath([v1, v2, v3], 1, 5);
    close(p[0].distance, 1);
    close(p[2].distance, 2);
    close(p[4].distance, 3);
    expect(viewsPath([v1], 1, 3)).toHaveLength(3);
    expect(viewsPath([], 1, 3)).toEqual([]);
  });
});

describe('model3dRenderJob', () => {
  it('képarány-értelmezés', () => {
    close(parseAspect('9:16')!, 9 / 16);
    expect(parseAspect('nem')).toBeNull();
  });
  it('kimeneti méret: a rövidebb oldal a preset, páros méretek', () => {
    expect(outputSize(9 / 16, '1080')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(16 / 9, '2160')).toEqual({ width: 3840, height: 2160 });
    expect(outputSize(1, '1440')).toEqual({ width: 1440, height: 1440 });
  });
  it('videó: 9:16, 4 mp, 30 fps → 120 kocka MP4', () => {
    const { plan, errors } = planRenderJob({ target: 'video', aspectRatio: '9:16', resolution: '1080', transparent: false, seconds: 4, fps: 30 });
    expect(errors).toEqual([]);
    expect(plan).toMatchObject({ width: 1080, height: 1920, frames: 120, container: 'mp4' });
  });
  it('overlay mindig átlátszó MOV; kép PNG', () => {
    expect(planRenderJob({ target: 'overlay', aspectRatio: '1:1', resolution: '1080', transparent: false, seconds: 2, fps: 30 }).plan).toMatchObject({ transparent: true, container: 'mov' });
    expect(planRenderJob({ target: 'image', aspectRatio: '4:5', resolution: '1080', transparent: true }).plan).toMatchObject({ frames: 1, container: 'png', transparent: true });
  });
  it('hibák: átlátszó sima videó, rossz hossz/fps, rossz arány', () => {
    const r = planRenderJob({ target: 'video', aspectRatio: 'x', resolution: '1080', transparent: true, seconds: 0, fps: 5 });
    expect(r.plan).toBeNull();
    expect(r.errors).toEqual(expect.arrayContaining(['model3d.render.errAspect', 'model3d.render.errAlphaVideo', 'model3d.render.errSeconds', 'model3d.render.errFps']));
  });
});
