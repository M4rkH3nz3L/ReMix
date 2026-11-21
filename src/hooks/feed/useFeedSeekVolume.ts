import { useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { VideoPlayer } from 'expo-video';
import { Platform } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';

import { toVolumeStep } from '@/lib/feedPlayback';
import type { FeedPost } from '@/types/social';
import { logCaught } from '@/lib/logCaught';

/** 🔊 Tekerés + hangerő/némítás gesztusok és gombok (REFACTOR: a useFeed-ből, a hook-sorrend változatlan). */
export function useFeedSeekVolume({
  player,
  activeVideoElRef,
  activeId,
  setProgress,
  setClock,
  seekingRef,
  seekWidthRef,
  mutedRef,
  setMuted,
  volumeRef,
  setVolume,
  setVolumeOpen,
  volWidthRef,
}: {
  player: VideoPlayer;
  activeVideoElRef: MutableRefObject<HTMLVideoElement | null>;
  activeId: string | null;
  setProgress: Dispatch<SetStateAction<number>>;
  setClock: Dispatch<SetStateAction<{ cur: number; dur: number }>>;
  seekingRef: MutableRefObject<boolean>;
  seekWidthRef: MutableRefObject<number>;
  mutedRef: MutableRefObject<boolean>;
  setMuted: Dispatch<SetStateAction<boolean>>;
  volumeRef: MutableRefObject<number>;
  setVolume: Dispatch<SetStateAction<number>>;
  setVolumeOpen: Dispatch<SetStateAction<boolean>>;
  volWidthRef: MutableRefObject<number>;
}) {
  // ▶️ tekerés: a csíkon húzva/koppintva a lejátszót a megfelelő időre állítjuk.
  // A gesture STABIL (useMemo) — a tényleges seek egy ref-en át fut, hogy ne
  // kelljen a gesture-t minden progress-tickre újraépíteni.
  const doSeekRef = useRef<(ratio: number) => void>(() => {});
  doSeekRef.current = (ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio));
    setProgress(r);
    if (Platform.OS === 'web') {
      const v = activeVideoElRef.current;
      if (v && Number.isFinite(v.duration)) {
        v.currentTime = r * v.duration;
        setClock({ cur: Math.floor(r * v.duration), dur: Math.round(v.duration) });
      }
    } else {
      const dur = player.duration ?? 0;
      if (dur > 0) {
        player.currentTime = r * dur;
        setClock({ cur: Math.floor(r * dur), dur: Math.round(dur) });
      }
    }
  };
  const seekGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          seekingRef.current = true;
          doSeekRef.current(e.x / seekWidthRef.current);
        })
        .onUpdate((e) => doSeekRef.current(e.x / seekWidthRef.current))
        .onFinalize(() => {
          seekingRef.current = false;
        })
        .runOnJS(true),
    [seekWidthRef, seekingRef]
  );

  // 🔊 hangerő beállítása 0–100%-ig (egész százalék): a videó/lejátszó volume + muted egyben. 0 = néma.
  const doVolumeRef = useRef<(v: number) => void>(() => {});
  doVolumeRef.current = (v: number) => {
    const vol = toVolumeStep(v);
    volumeRef.current = vol;
    setVolume(vol);
    const m = vol === 0;
    mutedRef.current = m;
    setMuted(m);
    if (Platform.OS === 'web') {
      const el = activeVideoElRef.current;
      if (el) {
        el.volume = vol;
        el.muted = m;
        if (!m) {
          void el.play().catch((caught) => { logCaught('hooks/useFeed.ts:useFeed', caught); });
        }
      }
    } else {
      player.volume = vol;
      player.muted = m;
    }
  };
  // a VÍZSZINTES csúszkán: bal = 0%, jobb = 100% (e.x a sáv bal szélétől) — vízszintes,
  // hogy a húzás ne lapozza a függőleges feedet (a tekerő-csíkkal azonos irány)
  const volumeGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => doVolumeRef.current(e.x / volWidthRef.current))
        .onUpdate((e) => doVolumeRef.current(e.x / volWidthRef.current))
        .runOnJS(true),
    [volWidthRef]
  );
  // ♿ VoiceOver/TalkBack „adjustable": felfelé/lefelé söprés ±10%
  const nudgeVolume = (delta: number) => doVolumeRef.current(volumeRef.current + delta);

  // 🔊 a bal alsó hang-gomb: némán → hangosít + nyitja a csúszkát; hangosan → a csúszkát
  // nyitja/zárja (a némítás a csúszka hangszóró-ikonján vagy 0%-ra húzva)
  const onVolumeButton = (sub: FeedPost) => {
    if (mutedRef.current) {
      onToggleMute(sub);
      return;
    }
    setVolumeOpen((o) => !o);
  };

  // 🔊 némít/hangosít + a hangerő-csúszka megnyitása (hangosításkor)
  const onToggleMute = (sub: FeedPost) => {
    const nm = !mutedRef.current;
    if (!nm && volumeRef.current === 0) {
      volumeRef.current = 1;
      setVolume(1);
    }
    mutedRef.current = nm;
    setMuted(nm);
    setVolumeOpen((o) => (nm ? o : true)); // hangosításkor nyíljon a csúszka
    if (Platform.OS === 'web') {
      const v = activeVideoElRef.current;
      if (v) {
        v.muted = nm;
        v.volume = volumeRef.current;
        if (!nm) {
          void v.play().catch((caught) => { logCaught('hooks/useFeed.ts:onToggleMute', caught); });
        }
      }
    } else {
      player.muted = nm;
      player.volume = volumeRef.current;
      if (!nm && sub.id === activeId) {
        player.play();
      }
    }
  };

  return { seekGesture, volumeGesture, nudgeVolume, onVolumeButton, onToggleMute };
}
