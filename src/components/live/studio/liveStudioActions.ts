import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { makeId } from '@/lib/id';
import { startLive } from '@/lib/live';
import { addScene, addSource, setActiveScene } from '@/lib/liveDoc';
import {
  addDestination as addRtmpDestination,
  removeDestination as removeRtmpDestination,
  setDestinationEnabled,
  type LiveDestinationRow,
} from '@/lib/liveDestinations';
import { isDestErrorKey, nextSceneName, projectWithFacing, rtmpDestinationInput, startTitle } from '@/lib/liveStudioOps';
import { logCaught } from '@/lib/logCaught';
import { goBackOrHome } from '@/lib/nav';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { LiveDoc, LiveScene, LiveSourceKind } from '@/types/live';
import type { Project } from '@/types/project';

/**
 * A Live Studio hook nélküli akció-gyárai (REFACTOR: a src/app/live/studio/[id].tsx-ből):
 * a gyökér állapotát és settereit kapják, a store-t a hívás pillanatában olvassák.
 * A logCaught-címkék az eredeti fájl ujjlenyomatai — változatlanok.
 */

export interface StudioActionDeps {
  id: string;
  project: Project;
  live: LiveDoc;
  scene: LiveScene | undefined;
  titleDraft: string;
  facing: 'front' | 'back';
  commit: (next: LiveDoc, label?: string) => void;
  t: TFunction;
  setAdding: (v: boolean) => void;
  setStarting: (v: boolean) => void;
  setReleasingCamera: (v: boolean) => void;
}

/** jelenet/forrás hozzáadása, kilépés (= megszakítás) és az adás indítása */
export function createStudioActions({
  id,
  project,
  live,
  scene,
  titleDraft,
  facing,
  commit,
  t,
  setAdding,
  setStarting,
  setReleasingCamera,
}: StudioActionDeps) {
  const onAddSource = (kind: LiveSourceKind) => {
    if (!scene) return;
    const label = t(`live.studio.source.${kind}`, { defaultValue: kind });
    commit(addSource(live, scene.id, kind, () => makeId('lsrc'), { label }), `+ ${label}`);
    setAdding(false);
  };

  const onAddScene = () => {
    const next = addScene(live, nextSceneName(live.scenes.length), () => makeId('lscn'));
    const added = next.scenes[next.scenes.length - 1];
    commit(setActiveScene(next, added.id), '+ scene');
  };

  // 🧹 Studióból kilépés = a live MEGSZAKÍTÁSA (nem indult adás) → a transient live-config
  // projekt törlése, hogy ne maradjon üres projekt a galériában. A „Start streaming" NEM
  // ezen megy (az router.replace-szel az /live/[id]-re lép), így a tényleges adást nem törli.
  const onCancel = () => {
    if (project?.kind === 'live') {
      deleteProject(String(id)).catch((caught) => { logCaught('app/live/studio/[id].tsx:onCancel', caught); });
    }
    goBackOrHome();
  };

  const onStart = async () => {
    const title = startTitle(titleDraft, live.title);
    setStarting(true);
    try {
      // 💾 a Studio-szerkesztések a store-ban élnek (nincs külön autosave-hook) →
      // mentjük, hogy a room a FRISS live-docot töltse (jelenetek/források/célok).
      const current = useEditorStore.getState().project;
      if (current) {
        // 📷 L27: a választott kamera-irány a műsorral együtt mentődik → az adás ezzel indul
        await saveProject(projectWithFacing(current, facing));
      }
      // 🎥 L40: az expo-camera előnézet ELENGEDI a kamerát, mielőtt a WebRTC megnyitja
      // (különben „kamera foglalt" verseny, főleg Androidon)
      setReleasingCamera(true);
      await new Promise((r) => setTimeout(r, 350));
      const session = await startLive(title, live?.visibility);
      // 🎥 a room megkapja a live-projekt id-jét → a host betölti a live-docot és
      // broadcastolja a jelenet-állapotot (Fázis B: több-forrás kompozíció).
      router.replace(`/live/${session.id}?project=${id}`);
    } catch (e) {
      logCaught('app/live/studio/[id].tsx:onStart', e);
      setStarting(false);
      setReleasingCamera(false);
      Alert.alert(t('live.error', { defaultValue: 'Live' }), String((e as Error)?.message ?? e));
    }
  };

  return { onAddSource, onAddScene, onCancel, onStart };
}

export interface RtmpActionDeps {
  rtmpLabel: string;
  rtmpUrl: string;
  rtmpKey: string;
  setRtmpLabel: (v: string) => void;
  setRtmpUrl: (v: string) => void;
  setRtmpKey: (v: string) => void;
  setRtmpOpen: (v: boolean) => void;
  loadDests: () => void;
  t: TFunction;
}

/** 🎥 multistream RTMP-célok: be/ki, törlés, új cél mentése (a kulcs a workeren át) */
export function createRtmpActions({
  rtmpLabel,
  rtmpUrl,
  rtmpKey,
  setRtmpLabel,
  setRtmpUrl,
  setRtmpKey,
  setRtmpOpen,
  loadDests,
  t,
}: RtmpActionDeps) {
  const onToggleDest = (d: LiveDestinationRow) => {
    setDestinationEnabled(d.id, !d.enabled).then(loadDests).catch((caught) => { logCaught('app/live/studio/[id].tsx:LiveStudioScreen', caught); });
  };

  const onRemoveDest = (d: LiveDestinationRow) =>
    removeRtmpDestination(d.id).then(loadDests).catch((caught) => { logCaught('app/live/studio/[id].tsx:LiveStudioScreen', caught); });

  const onSubmitRtmp = () => {
    addRtmpDestination(rtmpDestinationInput(rtmpLabel, rtmpUrl, rtmpKey))
      .then(() => {
        setRtmpLabel('');
        setRtmpUrl('');
        setRtmpKey('');
        setRtmpOpen(false);
        loadDests();
      })
      .catch((e) => {
      logCaught('app/live/studio/[id].tsx:LiveStudioScreen', e);
        // a validációs hiba i18n-kulcs (live.dest.*), a többi szerver-üzenet (kitakarva)
        const msg = String(e?.message ?? e);
        Alert.alert(t('common.error'), isDestErrorKey(msg) ? t(msg) : msg);
      });
  };

  return { onToggleDest, onRemoveDest, onSubmitRtmp };
}
