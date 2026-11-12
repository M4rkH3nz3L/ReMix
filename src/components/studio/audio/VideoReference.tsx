import * as VideoThumbnails from 'expo-video-thumbnails';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import { logCaught } from '@/lib/logCaught';
import { formatTime } from '@/lib/time';
import { videoFrameAt } from '@/lib/videoReference';
import { useEditorStore } from '@/store/editorStore';

/** lejátszás közben ennyi időnként frissül a kép (álló lejátszófejnél azonnal) */
const PLAYING_MS = 250;
const IDLE_MS = 60;

/**
 * 🎬 Videó-referencia (AP8): a videóból nyitott Hang Stúdióban a lejátszófejhez tartozó videó-képkocka
 * egy kis lebegő előnézetben — a hang így a képhez igazítható (eddig vakon). Képkocka-kép (nem
 * második videólejátszó): a szerkesztő saját lejátszója mögötte fut, nem duplázzuk.
 */
export function VideoReference() {
  const { t } = useTranslation();
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const [shown, setShown] = useState<{ uri: string; ms: number; clipId: string; at: number } | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const busy = useRef(false);
  const want = useRef(playhead);
  want.current = playhead;

  useEffect(() => {
    const timer = setTimeout(
      () => {
        const at = want.current;
        const f = videoFrameAt(useEditorStore.getState().project, at);
        if (!f) {
          if (shownRef.current) setShown(null);
          return;
        }
        if (busy.current || (shownRef.current?.clipId === f.clipId && shownRef.current.ms === f.ms)) return;
        busy.current = true;
        VideoThumbnails.getThumbnailAsync(f.uri, { time: f.ms, quality: 0.5 })
          .then((r) => setShown({ uri: r.uri, ms: f.ms, clipId: f.clipId, at }))
          .catch((caught) => logCaught('components/studio/audio/VideoReference.tsx:frame', caught))
          .finally(() => {
            busy.current = false;
          });
      },
      isPlaying ? PLAYING_MS : IDLE_MS
    );
    return () => clearTimeout(timer);
  }, [playhead, isPlaying]);

  // 🧪 füstteszt: a látható képkocka (csak __DEV__)
  useEffect(() => registerDevAction('audio.videoRef', () => shownRef.current), []);

  if (!shown) return null;
  return (
    <View style={styles.box} pointerEvents="none" testID="audio-video-ref" accessible accessibilityLabel={t('studio.audio.videoRef', { time: formatTime(shown.at) })}>
      <Image source={{ uri: shown.uri }} style={styles.img} resizeMode="contain" />
      <Text style={styles.time}>{formatTime(shown.at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', right: 12, top: 64, width: 132, height: 96, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: palette.border, zIndex: 20 },
  img: { width: '100%', height: '100%' },
  time: { position: 'absolute', left: 6, bottom: 4, color: '#fff', fontSize: 10, fontWeight: '800', backgroundColor: '#0009', paddingHorizontal: 4, borderRadius: 4 },
});
