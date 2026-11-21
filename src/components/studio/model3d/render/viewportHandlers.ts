import { File } from 'expo-file-system';
import type { TFunction } from 'i18next';
import type { RefObject } from 'react';

import type { SetState } from '@/components/studio/model3d/studioTypes';
import { haptics } from '@/design';
import { logCaught } from '@/lib/logCaught';
import { addMeasurement } from '@/lib/model3dDoc';
import { lookOptionsJson } from '@/lib/model3dLook';
import { refreshedPosterUri } from '@/lib/model3dStudioOps';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { Remix3D, type ModelViewHandle } from '@/lib/remix3dNative';
import { useEditorStore } from '@/store/editorStore';
import type { Model3DDoc, Model3DMesh, Vec3 } from '@/types/model3d';
import type { Asset } from '@/types/project';

/** létezik-e a helyi fájl (pl. a poszter — újratelepítés / törlés után hiányozhat) */
function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch (caught) {
    logCaught('components/studio/model3d/Model3DStudio.tsx:fileExists', caught);
    return false;
  }
}

export interface ViewportHandlerDeps {
  t: TFunction;
  doc: Model3DDoc | undefined;
  mesh: Model3DMesh;
  asset: Asset;
  pendingPoint: Vec3 | null;
  setPendingPoint: SetState<Vec3 | null>;
  setLoadFailedUri: SetState<string | null>;
  posterTried: { current: string | null };
  viewRef: RefObject<ModelViewHandle | null>;
}

/**
 * 👀 A natív néző eseményei hook nélkül (REFACTOR: a Model3DStudio.tsx-ből): mérő-koppintás,
 * betöltés (háromszög-szám + poszter pótlása), betöltési hiba.
 */
export function createViewportHandlers({ t, doc, mesh, asset, pendingPoint, setPendingPoint, setLoadFailedUri, posterTried, viewRef }: ViewportHandlerDeps) {
  const onTapPoint = (e: { nativeEvent: { x: number; y: number; z: number } }) => {
    const p = e.nativeEvent;
    if (!pendingPoint) {
      haptics.selection();
      setPendingPoint({ x: p.x, y: p.y, z: p.z });
      return;
    }
    const latest = useEditorStore.getState().project?.model3d;
    if (latest) {
      haptics.success();
      useEditorStore.getState().dispatch(
        { type: 'SET_MODEL3D_DOC', doc: addMeasurement(latest, { kind: 'distance', points: [pendingPoint, { x: p.x, y: p.y, z: p.z }] }), label: t('model3d.viewer.measure') },
        'user'
      );
    }
    setPendingPoint(null);
  };

  const onLoad = () => {
    setLoadFailedUri(null);
    // 🔢 a régebbi szkenek 0 háromszöggel mentődtek (a natív számláló a felső szintet
    // nézte) → a javított számlálóval egyszer pótoljuk
    if (mesh.triangles === 0 && Remix3D) {
      const meshId = mesh.id;
      Remix3D.inspectModel(asset.uri)
        .then((info) => {
          const latest = useEditorStore.getState().project?.model3d;
          if (!latest || info.triangles <= 0) return;
          const meshes = latest.meshes.map((x) => (x.id === meshId ? { ...x, triangles: info.triangles } : x));
          useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: { ...latest, meshes } }, 'system');
        })
        .catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:Model3DStudio', caught); });
    }
    // nincs (vagy üres) poszter → egyszer (modellenként) elkészítjük a lista előnézeti képét
    if (doc && Remix3D && posterTried.current !== asset.uri) {
      posterTried.current = asset.uri;
      void (async () => {
        // hiányzó VAGY üres (régi / háttérben renderelt) poszter → újra
        const current = doc.poster && fileExists(doc.poster) ? doc.poster : null;
        if (current && !(await Remix3D.imageIsBlank?.(current).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:Model3DStudio', caught); return false; }))) {
          return;
        }
        // új fájlnév: a doc változik (mentés + a lista-bélyegkép frissül), a régi üres
        // poszter a mappa-takarításnál kiesik
        const posterUri = refreshedPosterUri(projectMediaDir().uri, asset.id, Date.now().toString(36));
        const poster =
          (await Remix3D.snapshotFile(asset.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(doc)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:Model3DStudio', caught); return null; })) ??
          // tartalék: a LÁTHATÓ néző képe (a képernyőn lévő GPU-kontextus biztosan rajzol)
          (await viewRef.current?.snapshot(posterUri, 512, 512, false).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:Model3DStudio', caught); return null; })) ??
          null;
        const latest = useEditorStore.getState().project?.model3d;
        if (poster && latest) {
          useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: { ...latest, poster } }, 'system');
        }
      })();
    }
  };

  const onError = () => setLoadFailedUri(asset.uri);

  return { onTapPoint, onLoad, onError };
}
