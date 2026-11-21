import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/**
 * ✨ A feed animációi (REFACTOR: a useFeed-ből, a hook-sorrend változatlan): a komment-gomb
 * pulzálása, a dupla-tap szív-pop és a középső play/pause villanás.
 */
export function useFeedAnimations() {
  // 💬 a komment-gomb figyelemfelkeltő pulzálása (új funkció jelzése)
  const commentPulse = useRef(new Animated.Value(0)).current;
  // ❤️ dupla-tap like: középső szív-pop animáció (TikTok-szerű)
  const heartAnim = useRef(new Animated.Value(0)).current;
  // ▶️/⏸️ középső play/pause villanás kattintáskor (melyik ikon + animáció)
  const ppAnim = useRef(new Animated.Value(0)).current;
  const [ppIcon, setPpIcon] = useState<'play' | 'pause'>('play');

  // 💬 a komment-gomb háttér-pulzálása (radar-effekt) — hogy a user észrevegye az újdonságot
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(commentPulse, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [commentPulse]);

  // ❤️ középső szív-pop lejátszása (dupla-tap vizuális visszajelzése)
  const popHeart = () => {
    heartAnim.setValue(0);
    Animated.sequence([
      Animated.spring(heartAnim, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(heartAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  // ▶️/⏸️ középső play/pause villanás: `nowPlaying=true` → „play" ikon (elindult),
  // false → „pause" ikon (megállt). Rövid pop + elhalványulás, nem fog érintést.
  const flashPlayPause = (nowPlaying: boolean) => {
    setPpIcon(nowPlaying ? 'play' : 'pause');
    ppAnim.setValue(0);
    Animated.sequence([
      Animated.spring(ppAnim, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(ppAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  // a pulzáló glow-gyűrű stílusa (scale ki + elhalványul, loopban)
  const pulseStyle = {
    transform: [{ scale: commentPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
    opacity: commentPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  };

  return { heartAnim, ppAnim, ppIcon, popHeart, flashPlayPause, pulseStyle };
}
