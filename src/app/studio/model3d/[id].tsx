import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Model3DStudio } from '@/components/studio/model3d/Model3DStudio';
import { palette } from '@/constants/editor';
import { backupProjectToCloud } from '@/lib/cloudSync';
import { isEditableKind, isKindAvailable } from '@/lib/projectKinds';
import { loadEvents, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';

/** a változások mentése ennyi nyugalom után (a csúszka-húzás ne írjon minden képkockán) */
const AUTOSAVE_MS = 800;

/**
 * 🧊 3D Stúdió útvonal (`kind: 'model3d'`).
 *
 * ŐR (3D-Studio.md §1.1): LiDAR nélküli eszközön a 3D nem létezik az appban → a
 * deep link / értesítés csendben a Stúdió-listára visz, hibaképernyő nélkül.
 * Különben a projektet a KÖZÖS `useEditorStore`-ba tölti (command bus, undo), és
 * a változásokat késleltetve menti; kilépéskor azonnal.
 *
 * ☁️ Felhő-szinkron (mint a kép-/videó-stúdióban): a projekt-TERV (JSON) mindig a
 * felhőbe kerül; a modellfájl (USDZ) a telefonon, a projekt mappájában él, és az
 * ADR-013 szerint Pro / saját külső tár esetén a felhőbe is mentődik. Kilépéskor és
 * minden új modell (új szken) után fut.
 */
export default function Model3DStudioRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const allowed = isKindAvailable('model3d') && isEditableKind('model3d');
  const project = useEditorStore((s) => s.project);
  const [loading, setLoading] = useState(allowed);
  /** a legutóbb felhőbe mentett modell-asset-készlet (új szken → új mentés) */
  const backedAssets = useRef<string | null>(null);

  useEffect(() => {
    if (!allowed) {
      return;
    }
    let alive = true;
    Promise.all([loadProject(id), loadEvents(id)])
      .then(([loaded, events]) => {
        if (alive && loaded) {
          useEditorStore.getState().loadProject(loaded, events);
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        saveProject(p)
          .then(() => backupProjectToCloud(p))
          .catch(() => {});
      }
    };
  }, [id, allowed]);

  // 💾 késleltetett automatikus mentés minden projekt-változás után
  useEffect(() => {
    if (!project || project.id !== id) {
      return;
    }
    const timer = setTimeout(() => {
      const assetsKey = project.assets.map((a) => a.id).join(',');
      saveProject(project)
        .then(() => {
          // ☁️ az első betöltés után, és ha új modell született (új szken)
          if (backedAssets.current !== assetsKey) {
            backedAssets.current = assetsKey;
            return backupProjectToCloud(project);
          }
          return undefined;
        })
        .catch(() => {});
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [project, id]);

  if (!allowed) {
    return <Redirect href="/studio" />;
  }
  if (loading || !project || project.id !== id) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  return <Model3DStudio projectId={id} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg },
});
