import {
  availableCaptureModes,
  device3DCaps,
  has3DStudio,
  NO_3D_CAPS,
  setDevice3DCaps,
} from '@/lib/deviceCaps';
import { creatableKinds, isKindAvailable, PROJECT_KINDS, visibleProjects } from '@/lib/projectKinds';

const LIDAR = {
  hasLiDAR: true,
  supportsObjectCapture: true,
  supportsRoomPlan: true,
  supportsSceneReconstruction: true,
  usdExport: false,
};

afterEach(() => setDevice3DCaps(null));

describe('LiDAR-kapu (3D-Studio.md §1.1)', () => {
  it('alapállapot (nincs natív modul / Android / Expo Go): nincs 3D', () => {
    expect(device3DCaps()).toEqual(NO_3D_CAPS);
    expect(has3DStudio()).toBe(false);
    expect(availableCaptureModes()).toEqual([]);
  });

  it('LiDAR nélkül a model3d SEHOL nem elérhető, a többi fajta igen', () => {
    expect(isKindAvailable('model3d', NO_3D_CAPS)).toBe(false);
    expect(isKindAvailable('video', NO_3D_CAPS)).toBe(true);
    expect(isKindAvailable(undefined, NO_3D_CAPS)).toBe(true);
  });

  it('LiDAR-os eszközön elérhető; a hiányzó mód rejtve (nem tiltva)', () => {
    expect(isKindAvailable('model3d', LIDAR)).toBe(true);
    expect(availableCaptureModes(LIDAR)).toEqual(['object', 'room', 'freeform', 'pointcloud']);
    expect(availableCaptureModes({ ...LIDAR, supportsRoomPlan: false })).toEqual(['object', 'freeform', 'pointcloud']);
    // LiDAR, de háló-rekonstrukció nélkül → nincs stúdió
    expect(has3DStudio({ ...LIDAR, supportsSceneReconstruction: false })).toBe(false);
  });

  it('projektlista: a 3D-projekt LiDAR nélkül rejtve (nem törölve), LiDAR-ral látszik', () => {
    const items = [{ id: 'a', kind: 'video' as const }, { id: 'b', kind: 'model3d' as const }, { id: 'c' }];
    expect(visibleProjects(items, NO_3D_CAPS).map((p) => p.id)).toEqual(['a', 'c']);
    expect(visibleProjects(items, LIDAR).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(items).toHaveLength(3);
  });

  it('a választó a cache-ből olvas; a 3D csak kész stúdióval ÉS LiDAR-ral jelenhet meg', () => {
    setDevice3DCaps(LIDAR);
    expect(has3DStudio()).toBe(true);
    const ids = creatableKinds().map((k) => k.id);
    // a 3D-1-ig editable:false → még LiDAR-ral sincs a választóban
    expect(ids.includes('model3d')).toBe(PROJECT_KINDS.model3d.editable);
    expect(creatableKinds(NO_3D_CAPS).map((k) => k.id)).not.toContain('model3d');
  });

  it('a natív válasz hiányzó mezői biztonságosan false-ra esnek', () => {
    setDevice3DCaps({ hasLiDAR: true });
    expect(has3DStudio()).toBe(false);
  });
});
