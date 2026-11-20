import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';

import { probeDrift, syncProbeOn } from '@/lib/audioSyncProbe';
import { INITIAL_DRIFT, INITIAL_START_LATENCY_SEC, learnStartLatency, planDriftCorrection, VIDEO_SYNC_TOLERANCE_SEC, type DriftState } from '@/lib/avSync';
import { sampleChannel } from '@/lib/keyframes';
import { logCaught } from '@/lib/logCaught';
import { sourceTimeAt } from '@/lib/projectUtils';
import { ensureProxy, getProxyUriSync } from '@/lib/proxy';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

/** ⏱️ a videólejátszó tanult indítási késése (mp) — eszköz-szintű, mért kezdőértékkel */
let videoStartLatencySec = INITIAL_START_LATENCY_SEC;

export interface PreviewVideoPlayerInput {
  videoClip: VideoClip | null;
  videoSrcUri: string | null;
  playhead: number;
  isPlaying: boolean;
  isFocused: boolean;
  videoAudible: boolean;
  masterVolume: number;
}

/**
 * 🎬 Az előnézet expo-video lejátszója a rAF-mesterórához szinkronizálva:
 * proxy-forrás, forráscsere, sebesség/hangerő, play/pause (fókusz-kapuval),
 * klipváltás-seek, árva-lejátszás őr, scrub-seek és drift-korrekció.
 * A PreviewSurface-ből kiemelve — az effektek sorrendje változatlan; a
 * logCaught-helyek szándékosan a régi fájlnevet viszik (hiba-ujjlenyomat).
 */
export function usePreviewVideoPlayer({
  videoClip,
  videoSrcUri,
  playhead,
  isPlaying,
  isFocused,
  videoAudible,
  masterVolume,
}: PreviewVideoPlayerInput): { player: VideoPlayer; playbackUri: string | null } {
  const player = useVideoPlayer(null);
  const driftRef = useRef<DriftState>(INITIAL_DRIFT);
  const loadedUriRef = useRef<string | null>(null);

  // az előnézet a 720p vágási proxyt játssza, ha már elkészült — a klip
  // uri-ja (és így a render) mindig az eredeti marad
  const playbackUri = videoSrcUri ? (getProxyUriSync(videoSrcUri) ?? videoSrcUri) : null;

  // háttérben elindítjuk a proxy-készítést a következő lejátszáshoz
  useEffect(() => {
    if (videoSrcUri) {
      ensureProxy(videoSrcUri).catch((caught) => { logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught); });
    }
  }, [videoSrcUri]);

  // forráscsere, ha másik videófájl klipjére ér a lejátszófej
  useEffect(() => {
    if (!videoClip || !playbackUri) {
      if (loadedUriRef.current !== null) {
        loadedUriRef.current = null;
        player.replaceAsync(null).catch((caught) => { logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught); });
      }
      return;
    }
    if (loadedUriRef.current === playbackUri) {
      return;
    }
    loadedUriRef.current = playbackUri;
    player
      .replaceAsync(playbackUri)
      .then(() => {
        const state = useEditorStore.getState();
        player.currentTime = sourceTimeAt(videoClip, state.playhead);
        if (state.isPlaying) {
          player.play();
        }
      })
      .catch((caught) => { logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught); });
  }, [player, videoClip, playbackUri]);

  // sebesség + hangerő követése (🎚️ volume-automációval a playheadből).
  // ⚡ A playhead ~60×/mp változik, de a hangerő általában NEM — ezért csak
  // érdemi eltérésnél írunk a natív lejátszóra (a fölösleges bridge-hívás a
  // JS-szálat és a natív oldalt is terheli). A küszöb hallhatatlanul kicsi.
  const lastVolRef = useRef<number | null>(null);
  useEffect(() => {
    if (!videoClip) {
      return;
    }
    player.playbackRate = videoClip.speed ?? 1; // régi / hiányos klipen nincs `speed` → natív hiba volt (S21)
    // 🎚️ a videósáv némítása/solója is csak az előnézetre hat; a master-hangerő skáláz
    const base = videoAudible
      ? clamp(
          sampleChannel(videoClip.keyframes?.volume, playhead - videoClip.start, videoClip.volume),
          0,
          1
        )
      : 0;
    const vol = base * masterVolume;
    if (lastVolRef.current === null || Math.abs(vol - lastVolRef.current) > 0.005) {
      player.volume = vol;
      lastVolRef.current = vol;
    }
  }, [player, videoClip, playhead, videoAudible, masterVolume]);

  // play/pause követése — ⚠️ csak a FÓKUSZÁLT képernyőn. A szerkesztő mountolva
  // marad a lejátszó képernyő mögött (`push`), kapu nélkül tehát két videó szólna
  // egyszerre ugyanarra az `isPlaying` állapotra.
  const playStartRef = useRef(0);
  const latencyLearnedRef = useRef(false);
  useEffect(() => {
    if (isPlaying && videoClip && isFocused) {
      // ⏱️ T1: a tanult indítási késéssel előrébb indul (a lejátszó ~0,2 mp-ig áll a play után)
      if (videoStartLatencySec > 0) {
        try {
          player.currentTime = sourceTimeAt(videoClip, useEditorStore.getState().playhead) + videoStartLatencySec;
        } catch (caught) {
          logCaught('components/preview/PreviewSurface.tsx:playStart', caught);
        }
      }
      playStartRef.current = Date.now();
      latencyLearnedRef.current = false;
      player.play();
    } else {
      player.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a klip-adat a store-ból jön; az indítás csak lejátszás/fókusz/klip-id váltásra fut
  }, [player, isPlaying, videoClip?.id, isFocused]);

  // 🎬 T1: klipváltás UGYANABBÓL a fájlból (nincs forráscsere): a lejátszó a régi helyről
  // futna tovább (mérve: ~1 mp-es tévedés) — azonnal a helyes pontra ugrik
  const clipIdRef = useRef<string | null>(null);
  useEffect(() => {
    const idNow = videoClip?.id ?? null;
    if (idNow === clipIdRef.current) {
      return;
    }
    clipIdRef.current = idNow;
    if (!videoClip || !useEditorStore.getState().isPlaying || loadedUriRef.current !== playbackUri) {
      return;
    }
    try {
      player.currentTime = sourceTimeAt(videoClip, useEditorStore.getState().playhead) + videoStartLatencySec;
      driftRef.current = { ...driftRef.current, lastSeekMs: Date.now() };
    } catch (caught) {
      logCaught('components/preview/PreviewSurface.tsx:clipSwitch', caught);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- csak klip-váltáskor (id) seekel; a player/playbackUri/videoClip friss értéke a renderből jön, újrafutás nem kell
  }, [videoClip?.id]);

  // 🔒 a natív lejátszó néha MAGÁTÓL elindul (iOS AVPlayer seek után) — ilyenkor a
  // store SZÜNETEL, a mesteróra áll (a lejátszófej/timeline nem mozog), a gomb
  // szünetet mutat, mégis megy a videó („árva" lejátszás). A playhead-alapú
  // effektek nem fogják meg, mert a fej ÁLL — ezért közvetlenül a lejátszó
  // állapot-eseményére iratkozunk fel, és ha a store szünetel, visszapauzáljuk.
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying: nowPlaying }) => {
      if (nowPlaying && !useEditorStore.getState().isPlaying) {
        try {
          player.pause();
        } catch (caught) {
          logCaught('components/preview/PreviewSurface.tsx:sub', caught);
          // a lejátszó épp cserélődik/tölt — a play/pause effekt úgyis rendezi
        }
      }
    });
    return () => sub.remove();
  }, [player]);

  // álló lejátszófejnél (görgetés/vágás) pontos seek. FONTOS: a natív lejátszót
  // PAUZÁLTAN is tartjuk — különben (pl. iOS AVPlayer seek-viselkedés miatt) a
  // videó tovább játszhat, miközben a store/gomb szünetet mutat (playhead-scrub
  // desync). A hang-réteg (AudioLayer) is így tesz minden seeknél.
  useEffect(() => {
    if (!videoClip || isPlaying) {
      return;
    }
    try {
      if (player.playing) {
        player.pause();
      }
      player.currentTime = sourceTimeAt(videoClip, playhead);
    } catch (caught) {
      logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught);
      // a forrás még töltődik — a replaceAsync utáni seek rendezi
    }
  }, [player, playhead, isPlaying, videoClip]);

  // lejátszás közben csak nagy eltérésnél nyúlunk bele (drift-korrekció)
  useEffect(() => {
    if (!videoClip || !isPlaying) {
      return;
    }
    const want = sourceTimeAt(videoClip, playhead);
    try {
      if (syncProbeOn() && player.playing) {
        probeDrift('kép', want, player.currentTime, playhead - videoClip.start);
      }
      // 🎚️ T1: tanuló korrekció 40 ms tűréssel (mérve: a kép régen ~220 ms-mal ÁLLANDÓAN a
      // lejátszófej mögött járt — a zene, a felirat és a vágás ennyivel előbb volt a képnél)
      const now = Date.now();
      const sinceStart = now - playStartRef.current;
      if (!latencyLearnedRef.current && player.playing && sinceStart > 400 && sinceStart < 1200) {
        latencyLearnedRef.current = true;
        videoStartLatencySec = learnStartLatency(videoStartLatencySec, videoStartLatencySec + (want - player.currentTime));
      }
      const plan = planDriftCorrection(driftRef.current, want, player.currentTime, now, VIDEO_SYNC_TOLERANCE_SEC);
      driftRef.current = plan.next;
      if (plan.seekTo !== null) {
        player.currentTime = plan.seekTo;
      }
    } catch (caught) {
      logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught);
      // forrás töltés alatt
    }
  }, [player, playhead, isPlaying, videoClip]);

  return { player, playbackUri };
}
