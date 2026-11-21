import type { TFunction } from 'i18next';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  bumpViewerPeak,
  buildLiveSelf,
  endLive,
  getLive,
  heartbeatLive,
  openLiveRoom,
  type LiveChat,
  type LiveRoom,
  type LiveSelf,
  type LiveSession,
} from '@/lib/live';
import { stopLiveEgress } from '@/lib/liveDestinations';
import { appendLiveChat } from '@/lib/liveSessionOps';
import type { EgressStatus, LiveEvent } from '@/lib/liveState';
import { logCaught } from '@/lib/logCaught';
import { deleteProject, loadProject } from '@/lib/storage';
import type { LiveDoc } from '@/types/live';
import type { Project } from '@/types/project';

import { startHostEgress } from './liveSessionEgress';

/**
 * 🔌 Az élő adás kapcsolat-életciklusa (REFACTOR: a src/app/live/[id].tsx effektjeiből, hook
 * nélkül): session-betöltés + realtime szoba nyitása/zárása, a host live-produkciójának
 * betöltése (→ egress), a hirtelen kilépés leállítása, a képernyő ébren tartása és a host
 * szívverése. A gyökér az effekteket EREDETI sorrendben és függőségekkel hívja; a
 * logCaught-címkék az eredeti fájl ujjlenyomatai — változatlanok.
 */

export interface OpenLiveSessionDeps {
  id: string;
  projectParam: string | undefined;
  addFloat: (emoji: string) => void;
  broadcastScene: () => void;
  roomRef: RefObject<LiveRoom | null>;
  liveDocRef: RefObject<LiveDoc | null>;
  liveProjRef: RefObject<Project | null>;
  startStampRef: RefObject<number>;
  endedRef: RefObject<boolean>;
  egressIdRef: RefObject<string | null>;
  vodUrlRef: RefObject<string | null>;
  tRef: RefObject<TFunction>;
  setNotFound: Dispatch<SetStateAction<boolean>>;
  setSession: Dispatch<SetStateAction<LiveSession | null>>;
  setSelf: Dispatch<SetStateAction<LiveSelf | null>>;
  setChat: Dispatch<SetStateAction<LiveChat[]>>;
  setViewers: Dispatch<SetStateAction<number>>;
  setLiveStartMs: Dispatch<SetStateAction<number>>;
  setHostScenes: Dispatch<SetStateAction<{ id: string; name: string }[]>>;
  setMicMuted: Dispatch<SetStateAction<boolean>>;
  setFacing: Dispatch<SetStateAction<'front' | 'back'>>;
  setEgress: Dispatch<SetStateAction<EgressStatus>>;
  dispatchLs: Dispatch<LiveEvent>;
}

/** session betöltése + realtime room nyitása; a visszaadott függvény az effekt cleanupja */
export function openLiveSession({
  id,
  projectParam,
  addFloat,
  broadcastScene,
  roomRef,
  liveDocRef,
  liveProjRef,
  startStampRef,
  endedRef,
  egressIdRef,
  vodUrlRef,
  tRef,
  setNotFound,
  setSession,
  setSelf,
  setChat,
  setViewers,
  setLiveStartMs,
  setHostScenes,
  setMicMuted,
  setFacing,
  setEgress,
  dispatchLs,
}: OpenLiveSessionDeps): () => void {
    let active = true;
    const liveId = String(id);
    (async () => {
      const s = await getLive(liveId).catch((caught) => { logCaught('app/live/[id].tsx:LiveRoomScreen', caught); return null; });
      if (!active) {
        return;
      }
      if (!s) {
        setNotFound(true);
        return;
      }
      setSession(s);
      const self = await buildLiveSelf();
      if (!active || !self) {
        return;
      }
      setSelf(self); // → a LiveVideoStage ebből szerzi a videó-tokent (lazy)
      dispatchLs({ type: 'CONNECT', at: Date.now() });
      roomRef.current = openLiveRoom(liveId, self, {
        onChat: (m) => setChat((prev) => appendLiveChat(prev, m)),
        onReaction: (emoji) => addFloat(emoji),
        onViewers: (count) => {
          setViewers(count);
          // a host frissíti a csúcs-nézőszámot (RLS: csak ő)
          if (s.hostId === self.id && projectParam) {
            void bumpViewerPeak(liveId, count);
          }
        },
        // 🛡️ L2: a néző a jelenetet a LiveKit adatcsatornáról veszi (host-hitelesítve, lásd
        // LiveVideoStage → SceneDataReceiver) — a nyilvános broadcast `scene`-jét NEM alkalmazzuk
      });

      // 🎥 a host betölti a Studio live-produkció dokumentumát → jelenet-broadcast.
      // (A videó-token + WebRTC-kapcsolat a lazy LiveVideoStage-ben fut.)
      if (s.hostId === self.id && projectParam) {
        const proj = await loadProject(String(projectParam)).catch((caught) => { logCaught('app/live/[id].tsx:LiveRoomScreen', caught); return null; });
        if (active && proj?.live) {
          liveDocRef.current = proj.live;
          liveProjRef.current = proj; // VOD-poszthoz (D158)
          const startedAt = Date.now(); // 📼 az adás kezdete (VOD becsült hossz + 🔴 live-timer)
          startStampRef.current = startedAt;
          setLiveStartMs(startedAt);
          setHostScenes(proj.live.scenes.map((sc) => ({ id: sc.id, name: sc.name })));
          setMicMuted(proj.live.mixer?.channels.find((c) => c.id === 'mic')?.mute ?? false);
          setFacing(proj.live.cameraFacing ?? 'front');
          broadcastScene();
          // 🎥 egress indítása, ha VAN engedélyezett RTMP-cél (multistream, Pro)
          //    VAGY a RÖGZÍTÉS be van kapcsolva (ekkor az egress adja a VOD-ot — a
          //    felvétel RTMP-cél nélkül is működik). A ReMix-feed mindig megy;
          //    nem-Pro / nincs egress-infra esetén az egress csendben kimarad.
          const wantRecord = proj.live.record ?? false;
          startHostEgress({
            liveId,
            wantRecord,
            aspectRatio: proj.aspectRatio,
            isActive: () => active,
            endedRef,
            egressIdRef,
            vodUrlRef,
            setEgress,
            tRef,
          });
        }
      }
    })();
    return () => {
      active = false;
      roomRef.current?.stop();
      roomRef.current = null;
    };
}

export interface HostUnmountDeps {
  isHost: boolean;
  session: LiveSession | null;
  projectParam: string | undefined;
  endedRef: RefObject<boolean>;
  egressIdRef: RefObject<string | null>;
  liveDocRef: RefObject<LiveDoc | null>;
  importVod: () => Project | null;
}

/** host kilépéskor (unmount) best-effort leállítás — az effekt cleanupjának törzse */
export function stopHostOnUnmount({
  isHost,
  session,
  projectParam,
  endedRef,
  egressIdRef,
  liveDocRef,
  importVod,
}: HostUnmountDeps): void {
      if (isHost && session && !endedRef.current) {
        endedRef.current = true;
        if (egressIdRef.current) {
          void stopLiveEgress(egressIdRef.current);
          egressIdRef.current = null;
        }
        void endLive(session.id).catch((caught) => { logCaught('app/live/[id].tsx:LiveRoomScreen', caught); });
        // 📼 hirtelen kilépés RÖGZÍTÉSSEL → a VOD-projekt így is elkészül (L19)
        const vodProject = importVod();
        // 🧹 hirtelen kilépés + nem rögzít (vagy a VOD már projekt) → a transient config törlése
        if ((vodProject || !liveDocRef.current?.record) && projectParam) {
          void deleteProject(String(projectParam)).catch((caught) => { logCaught('app/live/[id].tsx:LiveRoomScreen', caught); });
        }
      }
}

/** 🔆 L36: a képernyő ébren tartása adás közben; a visszaadott függvény a cleanup */
export function holdScreenAwake(): () => void {
    void activateKeepAwakeAsync('remix-live').catch((caught) => { logCaught('app/live/[id].tsx:LiveRoomScreen', caught); });
    return () => {
      void deactivateKeepAwake('remix-live').catch((caught) => { logCaught('app/live/[id].tsx:LiveRoomScreen', caught); });
    };
}

/** 💓 L14: a host 30 mp-enként „él még" jelet küld; a visszaadott függvény a cleanup */
export function startHostHeartbeat(sessionId: string, endedRef: RefObject<boolean>): () => void {
    const beat = () => {
      if (!endedRef.current) void heartbeatLive(sessionId).catch((caught) => { logCaught('app/live/[id].tsx:beat', caught); });
    };
    beat();
    const timer = setInterval(beat, 30_000);
    return () => clearInterval(timer);
}
