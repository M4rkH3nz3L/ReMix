import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import { playPcm, stopPreview, warmPreview } from '@/lib/instrumentPreview';

/**
 * ▶ Élő előhallgatás (offline): a minta loopolva szól; szerkesztés közben (a `version` változik)
 * az új minta a lejátszófej helyéről folytatódik. Bezáráskor elhallgat.
 */
export function PreviewPlayButton({
  build,
  version,
  disabled,
  testID,
}: {
  /** a minta PCM-je (null: nincs mit lejátszani) */
  build: () => Float32Array[] | null | Promise<Float32Array[] | null>;
  /** a minta változásának jelzője (pl. a hangjegyek/ütések kulcsa) */
  version: string;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const buildRef = useRef(build);
  buildRef.current = build;

  const start = async (resume: boolean) => {
    const pcm = await buildRef.current();
    if (!pcm || pcm[0].length === 0) {
      stopPreview();
      setPlaying(false);
      return;
    }
    setPlaying(await playPcm(pcm, true, resume));
  };

  // szerkesztés közben: az új minta azonnal, a helyéről folytatva
  useEffect(() => {
    if (playing) void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  // a lap megnyitásakor a hangkontextus előkészül (az első koppintás is azonnal szól)
  useEffect(() => {
    void warmPreview();
    return () => stopPreview();
  }, []);
  // 🧪 a füstteszt a gombot „nyomja meg” (csak __DEV__)
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(
    () =>
      testID
        ? registerDevAction(`preview.${testID}`, async () => {
            if (playingRef.current) {
              stopPreview();
              setPlaying(false);
              return false;
            }
            await start(false);
            return true;
          })
        : undefined,
    [testID]
  );

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (playing) {
          stopPreview();
          setPlaying(false);
        } else {
          void start(false);
        }
      }}
      disabled={disabled && !playing}
      style={[styles.btn, playing && styles.on, disabled && !playing && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={t(playing ? 'studio.instrument.stop' : 'studio.instrument.play')}
    >
      <Ionicons name={playing ? 'stop' : 'play'} size={16} color={playing ? '#fff' : palette.text} />
      <Text style={[styles.text, playing && { color: '#fff' }]}>{t(playing ? 'studio.instrument.stop' : 'studio.instrument.play')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  on: { backgroundColor: palette.accent, borderColor: palette.accent },
  text: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
