import type { AudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';

import { registerDevAction } from '@/lib/devActions';
import { detectSystemPause, INITIAL_STALL } from '@/lib/interruption';
import { logCaught } from '@/lib/logCaught';
import { useEditorStore } from '@/store/editorStore';

/** 📞 a megszakítás-figyelés ütemezése (a rendszer-szünet küszöbe 700 ms, `interruption.ts`) */
const INTERRUPT_POLL_MS = 150;

/**
 * 📞 PRO-AUDIO 17/18: hívás, Siri, fülhallgató-kihúzás — a rendszer natívan megállítja a
 * lejátszót, a JS nem kap eseményt. Futó óránál az elnémult lejátszó megállítja a transzportot
 * (különben a lejátszófej néma hangra fut tovább); álló óránál a magától újraindult lejátszót
 * (az iOS a hívás végén folytatja) leállítjuk. `sourceEnd`: a klip forrás-vége (ott a leállás
 * természetes).
 */
export function useSystemInterruptGuard(player: AudioPlayer, isPlaying: boolean, sourceEnd: number, devId: string) {
  const playingRef = useRef(isPlaying);
  const endRef = useRef(sourceEnd);
  useEffect(() => {
    playingRef.current = isPlaying;
    endRef.current = sourceEnd;
  }, [isPlaying, sourceEnd]);

  useEffect(() => {
    let stall = INITIAL_STALL;
    const timer = setInterval(() => {
      try {
        if (!playingRef.current) {
          stall = INITIAL_STALL;
          if (player.playing) {
            player.pause();
          }
          return;
        }
        const time = player.currentTime;
        const end = Math.min(endRef.current, player.duration > 0 ? player.duration : Infinity);
        const r = detectSystemPause(stall, { playing: player.playing, buffering: player.isBuffering, time, nowMs: Date.now(), nearEnd: time >= end - 0.25 });
        stall = r.next;
        if (r.stopped && useEditorStore.getState().isPlaying) {
          stall = INITIAL_STALL;
          useEditorStore.getState().setPlaying(false);
        }
      } catch (caught) {
        logCaught('components/preview/AudioLayer.tsx:useSystemInterruptGuard', caught);
      }
    }, INTERRUPT_POLL_MS);
    // 🧪 füstteszt: ugyanaz a natív pause/play, amit az iOS megszakításkor hív
    const offPause = registerDevAction(`audio.nativePause.${devId}`, () => player.pause());
    const offPlay = registerDevAction(`audio.nativePlay.${devId}`, () => player.play());
    const offState = registerDevAction(`audio.nativePlaying.${devId}`, () => player.playing);
    const offRate = registerDevAction(`audio.nativeRate.${devId}`, () => player.playbackRate);
    return () => {
      clearInterval(timer);
      offPause();
      offPlay();
      offState();
      offRate();
    };
  }, [player, devId]);
}
