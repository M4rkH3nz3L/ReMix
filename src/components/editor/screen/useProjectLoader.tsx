import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';

import { backupProjectToCloud, pullProject } from '@/lib/cloudSync';
import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { logCaught } from '@/lib/logCaught';
import { mediaRemoteMap, restoreMissingMedia } from '@/lib/mediaSync';
import { clearRecovery, loadEvents, loadProject, readRecovery, recoveryIsFresher, saveProject } from '@/lib/storage';
import { findMissingMedia, type MissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/**
 * 📂 A projekt életciklusa a szerkesztőben: betöltés (helyi → felhő), crash-recovery
 * ajánlat, a hiányzó média automatikus visszaállítása, kilépéskor felhő-mentés.
 * A szerkesztő-képernyőből kiemelve — a két effekt sorrendje az eredeti.
 */
export function useProjectLoader({
  id,
  t,
  setMissing,
  setMissingMedia,
}: {
  id: string;
  t: TFunction;
  setMissing: (missing: boolean) => void;
  setMissingMedia: (missing: MissingMedia[]) => void;
}) {
  // projekt betöltése (ha nem ez van a store-ban)
  useEffect(() => {
    if (!id) {
      return;
    }
    const current = useEditorStore.getState().project;
    if (current?.id === id) {
      return;
    }
    // ⚠️ `alive` guard: a betöltés a GLOBÁLIS szerkesztő-store-t írja. Gyors
    // A→B→A projektváltásnál enélkül a későn beérkező (elavult) válasz felülírná
    // a frisset — rossz projekt jelenhetne meg a szerkesztőben.
    let alive = true;
    Promise.all([loadProject(id), loadEvents(id)])
      .then(([loaded, events]) => {
        if (!alive) {
          return;
        }
        // 🗄️ a hiányzó média AUTOMATIKUS visszaállítása a szerver-másolatból,
        // mielőtt a kézi „relink" bannert felkínálnánk — a fájlok nem vesznek el.
        const recoverMissingMedia = async (proj: Project) => {
          if (Platform.OS === 'web') {
            return;
          }
          if (findMissingMedia(proj).length === 0) {
            if (alive) {
              setMissingMedia([]);
            }
            return;
          }
          // remoteUrl-ök: a helyi assetből, vagy a felhő-projekt-másolatból
          let remoteByUri = mediaRemoteMap(proj);
          if (Object.keys(remoteByUri).length === 0) {
            const cloud = await pullProject(proj.id).catch((caught) => { logCaught('app/editor/[id].tsx:recoverMissingMedia', caught); return null; });
            if (cloud) {
              remoteByUri = mediaRemoteMap(cloud);
            }
          }
          const { pairs } = await restoreMissingMedia(proj, remoteByUri);
          if (!alive) {
            return;
          }
          const store = useEditorStore.getState();
          // csak akkor relinkelünk, ha MÉG ez a projekt van betöltve (a user nem
          // váltott a több másodperces letöltés alatt)
          if (store.project?.id !== proj.id) {
            return;
          }
          // a relinket a COMMAND BUSON visszük a JELENLEGI projektre (egy undo-lépés):
          // így a letöltés alatt tett szerkesztések + az undo-előzmény/playhead
          // MEGMARADNAK — NEM full-reload (loadProject), ami mindezt nullázná.
          if (pairs.length > 0) {
            store.applyBatch(
              pairs.map((p) => ({ type: 'RELINK_URI' as const, oldUri: p.oldUri, newUri: p.newUri })),
              'system'
            );
            saveProject(useEditorStore.getState().project!).catch((caught) => { logCaught('app/editor/[id].tsx:recoverMissingMedia', caught); });
          }
          setMissingMedia(findMissingMedia(useEditorStore.getState().project!));
        };
        if (loaded) {
          useEditorStore.getState().loadProject(loaded, events);
          // 📊 CSWCR: a videó-stúdió szerkeszti a projektet (a lánc 2. stúdiója lehet)
          logCswcr({ type: 'edit', projectId: loaded.id, kind: studioKindOf(loaded.kind) });
          // 🛟 crash-recovery: ha van a mentettnél FRISSEBB pillanatkép (az előző
          // munkamenet nem fejezte be a mentést), felajánljuk a visszaállítást
          void readRecovery(id).then((rec) => {
            if (!alive || !rec || !recoveryIsFresher(rec.at, loaded.updatedAt)) {
              return;
            }
            if (useEditorStore.getState().project?.id !== id) {
              return;
            }
            Alert.alert(t('editor.recovery.title'), t('editor.recovery.message'), [
              {
                text: t('editor.recovery.discard'),
                style: 'cancel',
                onPress: () => void clearRecovery(id),
              },
              {
                text: t('editor.recovery.restore'),
                onPress: () => {
                  if (useEditorStore.getState().project?.id === id) {
                    useEditorStore.getState().restoreProject(rec.project);
                  }
                  void clearRecovery(id);
                },
              },
            ]);
          });
          // hiányzó média felismerése + automatikus visszaállítás a szerverről
          if (Platform.OS !== 'web') {
            void recoverMissingMedia(loaded);
            // 🔍 Az automatikus vision-index ELŐMELEGÍTÉS KIKAPCSOLVA (felhasználói
            // kérés: „az AI ne fusson"): a szerkesztő megnyitása ne indítson
            // magától AI/worker-indexelést. A Smart Search továbbra is elérhető —
            // az indexelést a keresés KÉZZEL indítja (AssistantPanel).
          }
        } else {
          // 🗄️ helyileg hiányzik → próbáljuk a FELHŐBŐL (más eszköz / újratelepítés
          // után is megnyílik; login nélkül a catch a „hiányzó" ágra visz)
          pullProject(id)
            .then((cloud) => {
              if (!alive) {
                return;
              }
              if (cloud) {
                saveProject(cloud).catch((caught) => { logCaught('app/editor/[id].tsx:EditorScreen', caught); }); // helyi visszaírás
                useEditorStore.getState().loadProject(cloud, events);
                if (Platform.OS !== 'web') {
                  void recoverMissingMedia(cloud);
                }
              } else {
                setMissing(true);
              }
            })
            .catch((caught) => {
            logCaught('app/editor/[id].tsx:EditorScreen', caught);
              if (alive) {
                setMissing(true);
              }
            });
        }
      })
      .catch((caught) => {
      logCaught('app/editor/[id].tsx:EditorScreen', caught);
        if (alive) {
          setMissing(true);
        }
      });
    return () => {
      alive = false;
    };
    // a két setter useState-setter (stabil) → nem indítja újra az effektet
  }, [id, t, setMissing, setMissingMedia]);

  // 🗄️ Adatbiztonság: a szerkesztőből kilépve a projekt + a MÉDIA a szerverre kerül
  // (best-effort, idempotens — asset-enként egyszer tölt). Így eszközváltás vagy
  // újratelepítés után a betöltés vissza tudja állítani a fájlokat.
  useEffect(() => {
    return () => {
      const p = useEditorStore.getState().project;
      if (p && p.id === id) {
        void backupProjectToCloud(p);
      }
    };
  }, [id]);
}
