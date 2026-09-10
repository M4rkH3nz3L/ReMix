import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { buildPreviewWindow, windowAround } from '@/lib/previewWindow';
import { projectDuration } from '@/lib/projectUtils';
import { renderMp4 } from '@/lib/render';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';

/**
 * 🎬 Részlet-előnézet: a playhead körüli pár másodperc VALÓDI renderje.
 *
 * A render-only funkciók (részecskék, mozgás-elmosás, égcsere, 3D matricák,
 * arc-elmosás, 3D szöveg, átmenetek) az élő előnézetben nem, vagy csak
 * közelítve látszanak. Itt ugyanaz a worker-motor fut, mint az exportnál —
 * csak egy rövid ablakra, ezért másodpercek alatt kész.
 *
 * A render kis felbontáson (480p) megy: a CÉL a hatás ellenőrzése, nem a
 * végleges minőség — így az iteráció gyors marad.
 */
export function DetailPreview() {
  const [status, setStatus] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    if (uri) {
      player.play();
    }
  }, [uri, player]);

  const run = async () => {
    const state = useEditorStore.getState();
    if (!state.project || status) {
      return;
    }
    const total = projectDuration(state.project);
    if (total <= 0) {
      Alert.alert('Részlet-előnézet', 'Előbb tegyél tartalmat az idővonalra.');
      return;
    }
    const win = windowAround(state.playhead, total);
    const slice = buildPreviewWindow(state.project, win.from, win.to);
    if (!slice) {
      Alert.alert(
        'Részlet-előnézet',
        'Ezen a szakaszon nincs renderelni való — állítsd a lejátszófejet tartalomra.'
      );
      return;
    }
    setStatus('Előkészítés…');
    setRange(win);
    try {
      const file = await withProgress('Részlet-előnézet', (report) =>
        renderMp4(
          slice,
          (u) => {
            report(u);
            setStatus(u.phase);
          },
          { resolution: 480, fps: 30, quality: 'medium' }
        )
      );
      setUri(file.uri);
    } catch (err) {
      Alert.alert('Részlet-előnézet', (err as Error).message);
    } finally {
      setStatus(null);
    }
  };

  const close = () => {
    try {
      player.pause();
    } catch {
      // a lejátszó már eldobható állapotban lehet
    }
    setUri(null);
    setRange(null);
  };

  return (
    <>
      <Pressable
        onPress={() => {
          void run();
        }}
        hitSlop={6}
        style={styles.side}
        disabled={Boolean(status)}
      >
        {status ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : (
          <Ionicons name="eye-outline" size={18} color={palette.textDim} />
        )}
      </Pressable>

      <Modal visible={Boolean(uri)} animationType="fade" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.title}>🎬 Részlet-előnézet</Text>
              <Pressable onPress={close} hitSlop={8}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>
            {uri ? (
              <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
            ) : null}
            <Text style={styles.note}>
              {range
                ? `${formatTime(range.from)} – ${formatTime(range.to)} · valódi render 480p-ben`
                : ''}
            </Text>
            <Text style={styles.note}>
              Itt látszanak azok a hatások, amiket az élő előnézet nem tud
              mutatni: részecskék, mozgás-elmosás, égcsere, 3D matricák és
              szöveg, arc-elmosás, átmenetek.
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  side: {
    width: 34,
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#000000cc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    gap: 8,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: palette.text,
    fontWeight: '700',
    fontSize: 14,
  },
  video: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 460,
    borderRadius: 12,
    backgroundColor: '#000',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
