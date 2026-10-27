import { capabilityAllowed, capabilityRequiresPro, capabilityWhere } from '@/lib/capabilities';
import { assetNodeType } from '@/lib/creativeGraph';
import { model3dAsset } from '@/lib/model3dMedia';
import { projectMediaSafety } from '@/lib/storagePolicy';
import type { Project } from '@/types/project';

/** 🧊 3D-0d — a 3D az ökoszisztéma része (3D-Studio.md §15.2, §15.7, §15.8) */
describe('3D az ökoszisztémában', () => {
  it('Creative Graph: a 3D-asset saját csomópont-típus (nem általános „asset")', () => {
    expect(assetNodeType('model3d')).toBe('model3d');
  });

  it('képességek: a szken és a helyi export ingyenes (eszközön), a felhős 3D Pro', () => {
    expect(capabilityWhere('lidarScan')).toBe('local');
    expect(capabilityAllowed('lidarScan', 'free')).toBe(true);
    expect(capabilityAllowed('model3dExport', 'free')).toBe(true);
    expect(capabilityRequiresPro('model3dCloud')).toBe(true);
    expect(capabilityAllowed('model3dCloud', 'free')).toBe(false);
  });

  it('tárhely: a csak-helyi 3D-fájl beszámít az adatvesztés-figyelmeztetésbe', () => {
    const asset = model3dAsset({ assetId: 'a1', format: 'usdz', documentDir: 'file:///d/', name: 'x', size: 10 });
    const project = {
      id: 'p', name: 'p', aspectRatio: '1:1', fps: 30, kind: 'model3d', tracks: [], assets: [asset],
      createdAt: '', updatedAt: '', schemaVersion: 6,
    } as Project;
    const safety = projectMediaSafety(project);
    expect(safety.localOnly).toBe(1);
    expect(safety.atRisk).toBe(true);
  });
});
