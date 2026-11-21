import { useIsFocused } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { logCaught } from '@/lib/logCaught';

/**
 * ▶️ A feed lejátszó-állapota (REFACTOR: a useFeed-ből, a hook-sorrend változatlan):
 * hotspot-idő, haladás/óra, tekerés-refek, az egyetlen videó-lejátszó, némítás/hangerő,
 * fókusz és a webes <video> elem stabil refje.
 */
export function useFeedPlaybackState() {
  const [hotspotTime, setHotspotTime] = useState(0);
  // ▶️ videó-haladás (0–1) az alsó tekerő-csíkhoz + tekerés-állapot/szélesség
  const [progress, setProgress] = useState(0);
  // ⏱️ lejátszási óra (EGÉSZ mp-re kerekítve → másodpercenként legfeljebb egy render)
  const [clock, setClock] = useState({ cur: 0, dur: 0 });
  const seekingRef = useRef(false);
  const seekWidthRef = useRef(1);

  // egyetlen lejátszó, ami az AKTÍV poszt videójára vált (renderelt MP4 URL)
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    // 🌐 weben a HANGOS autoplay tiltott → némán indítunk (különben a videó „el sem
    // indul"); a hangot a rail némítás-gombja kapcsolja be (kattintás = user gesztus).
    if (Platform.OS === 'web') {
      p.muted = true;
    }
  });
  // némítás-állapot (weben alapból néma az autoplayhez)
  const [muted, setMuted] = useState(Platform.OS === 'web');
  const mutedRef = useRef(Platform.OS === 'web');
  // 🔊 hangerő (0–1, egész százalékos lépcsőben) + a szabályzó nyitva van-e + a csúszka szélessége
  const [volume, setVolume] = useState(1);
  const volumeRef = useRef(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volWidthRef = useRef(1);
  // a feed `push`-sal nyit más képernyőt → mountolva marad; a videó ne szóljon takarva
  const isFocused = useIsFocused();

  // 🌐 web: STABIL ref a natív <video>-hoz. FONTOS, hogy `useCallback([])` legyen:
  // az inline ref MINDEN rendernél (pl. a 200 ms-es haladás-tick) újrafutna és
  // meghívná a `play()`-t → a kézzel szüneteltetett videó azonnal újraindulna
  // („kattintásra nem áll le"). Stabil ref → csak MOUNTkor indít, újrarendernél nem.
  // 🌐 web: az AKTÍV poszt <video> eleme. NEM `querySelector('video')` — az a DOM
  // ELSŐ videóját adná (lapozáskor a rossz/elavult elemet vezérelnénk, és az előző
  // hangja átszivárogna). Ez mindig a JELENLEG aktív poszt eleme.
  const activeVideoElRef = useRef<HTMLVideoElement | null>(null);
  const webVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el) {
      // új aktív videó mountol → az ELŐZŐT lezárjuk (hang is), nehogy tovább szóljon
      const prev = activeVideoElRef.current;
      if (prev && prev !== el) {
        try {
          prev.pause();
          prev.currentTime = 0;
        } catch (caught) {
          logCaught('hooks/useFeed.ts:webVideoRef', caught);
          /* a leváló elem már eldobható */
        }
      }
      activeVideoElRef.current = el;
      el.muted = mutedRef.current;
      el.volume = volumeRef.current;
      void el.play?.().catch((caught) => { logCaught('hooks/useFeed.ts:webVideoRef', caught); });
    }
  }, []);

  return {
    hotspotTime,
    setHotspotTime,
    progress,
    setProgress,
    clock,
    setClock,
    seekingRef,
    seekWidthRef,
    player,
    muted,
    setMuted,
    mutedRef,
    volume,
    setVolume,
    volumeRef,
    volumeOpen,
    setVolumeOpen,
    volWidthRef,
    isFocused,
    activeVideoElRef,
    webVideoRef,
  };
}
