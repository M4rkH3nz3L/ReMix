import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { publishLiveVod } from '@/lib/feed';
import { projectFps } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { endLive, type LiveRoom, type LiveSession } from '@/lib/live';
import { stopLiveEgress } from '@/lib/liveDestinations';
import { liveEndDisposition } from '@/lib/liveDoc';
import type { LiveEvent } from '@/lib/liveState';
import { buildVodProject } from '@/lib/liveVod';
import { logCaught } from '@/lib/logCaught';
import { goBackOrHome } from '@/lib/nav';
import { deleteProject, saveProject } from '@/lib/storage';
import type { LiveDoc } from '@/types/live';
import type { Project } from '@/types/project';

/**
 * Az élő adás képernyőjének hook nélküli akció-gyárai (REFACTOR: a src/app/live/[id].tsx-ből):
 * minden renderben újra készülnek (mint eddig a képernyő sima függvényei), a refeket a hívás
 * pillanatában olvassák. A logCaught-címkék az eredeti fájl ujjlenyomatai — változatlanok.
 */

export interface LiveChatActionDeps {
  roomRef: RefObject<LiveRoom | null>;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
}

/** 💬 chat-üzenet és reakció küldése a realtime szobán */
export function createLiveChatActions({ roomRef, text, setText }: LiveChatActionDeps) {
  const onSendChat = () => {
    const body = text.trim();
    if (!body) {
      return;
    }
    roomRef.current?.sendChat(body);
    setText('');
  };

  const onReact = (emoji: string) => {
    roomRef.current?.sendReaction(emoji);
    // a sajátot azonnal is megmutatjuk (a broadcast self:true visszahozza, de ne lógjon)
  };

  return { onSendChat, onReact };
}

export interface LiveEndActionDeps {
  isHost: boolean;
  session: LiveSession | null;
  projectParam: string | undefined;
  t: TFunction;
  dispatchLs: Dispatch<LiveEvent>;
  endedRef: RefObject<boolean>;
  egressIdRef: RefObject<string | null>;
  vodUrlRef: RefObject<string | null>;
  liveProjRef: RefObject<Project | null>;
  liveDocRef: RefObject<LiveDoc | null>;
  startStampRef: RefObject<number>;
}

/** 📼 a VOD-import és az adás befejezése / kilépés */
export function createLiveEndActions({
  isHost,
  session,
  projectParam,
  t,
  dispatchLs,
  endedRef,
  egressIdRef,
  vodUrlRef,
  liveProjRef,
  liveDocRef,
  startStampRef,
}: LiveEndActionDeps) {
  /**
   * 📼 a felvett VOD → szerkeszthető video-projekt (mentve). Az adás-vége ÉS a hirtelen
   * kilépés (vissza-gesztus / unmount) is ezt hívja — eddig unmountkor a VOD elveszett (L19).
   */
  const importVod = (): Project | null => {
    const vod = vodUrlRef.current;
    const proj = liveProjRef.current;
    const record = liveDocRef.current?.record ?? false;
    if (liveEndDisposition(record, !!vod) !== 'import-vod' || !vod || !proj) {
      return null;
    }
    vodUrlRef.current = null;
    // ⏱️ a VOD becsült hossza = az adás eltelt ideje (az editor betöltéskor pontosítja)
    const elapsedSec = startStampRef.current > 0 ? (Date.now() - startStampRef.current) / 1000 : 0;
    const vodProject = buildVodProject({
      vodUrl: vod,
      durationSec: elapsedSec,
      fps: projectFps(proj),
      makeId: () => makeId('clip'),
      name: proj.live?.title || proj.name || t('live.vodDefaultName', { defaultValue: 'Live' }),
      aspectRatio: proj.aspectRatio,
    });
    void saveProject(vodProject).catch((caught) => { logCaught('app/live/[id].tsx:importVod', caught); });
    return vodProject;
  };

  const onEndOrLeave = async () => {
    if (isHost && session && !endedRef.current) {
      endedRef.current = true;
      dispatchLs({ type: 'STOP', at: Date.now() });
      if (egressIdRef.current) {
        void stopLiveEgress(egressIdRef.current); // 🎥 multistream leállítása
        egressIdRef.current = null;
      }
      await endLive(session.id).catch((caught) => { logCaught('app/live/[id].tsx:onEndOrLeave', caught); });
      dispatchLs({ type: 'STOPPED', at: Date.now() });
      const vod = vodUrlRef.current;
      // 📼 record=be + van felvétel (VOD) → a felvételből SZERKESZTHETŐ video-projekt
      //    (LIVE/05.1): a VOD a fő videosávon lévő klip (command-bus). KÜLÖNBEN a
      //    transient live-config projekt TÖRLŐDIK → nincs üres-projekt clutter.
      const vodProject = importVod();
      if (vodProject && vod) {
        // 🧹 a transient live-config projekt törlése (a VOD-projekt az új otthon)
        if (projectParam) {
          void deleteProject(String(projectParam)).catch((caught) => { logCaught('app/live/[id].tsx:onEndOrLeave', caught); });
        }
        Alert.alert(
          t('live.vodTitle', { defaultValue: 'Felvétel kész' }),
          t('live.vodBody', { defaultValue: 'Az élő adás felvétele szerkeszthető projekt lett.' }),
          [
            {
              text: t('live.vodOpen', { defaultValue: 'Projekt megnyitása' }),
              onPress: () => router.push(`/editor/${vodProject.id}`),
            },
            {
              text: t('live.vodShare', { defaultValue: 'Megosztás feedre' }),
              onPress: () => {
                void publishLiveVod(vodProject, vod).catch((caught) => { logCaught('app/live/[id].tsx:onEndOrLeave', caught); });
                goBackOrHome();
              },
            },
            {
              text: t('common.done', { defaultValue: 'Kész' }),
              style: 'cancel',
              onPress: () => goBackOrHome(),
            },
          ],
        );
        return; // a navigációt az Alert-gombok végzik
      }
      // 🧹 nem rögzített (vagy nincs VOD) → a transient live-config projekt törlése
      if (projectParam) {
        void deleteProject(String(projectParam)).catch((caught) => { logCaught('app/live/[id].tsx:onEndOrLeave', caught); });
      }
    }
    goBackOrHome();
  };

  return { importVod, onEndOrLeave };
}
