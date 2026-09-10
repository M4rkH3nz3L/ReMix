import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { DetailPreview } from '@/components/editor/DetailPreview';
import { accentGradient, palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Marker } from '@/types/project';

/** közös üres tömb — hogy a selector referenciája ne változzon (lásd lent) */
const EMPTY_MARKERS: Marker[] = [];

export function TransportBar() {
  const { t } = useTranslation();
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const loop = useEditorStore((s) => s.loop);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setLoop = useEditorStore((s) => s.setLoop);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const duration = useEditorStore((s) => (s.project ? projectDuration(s.project) : 0));
  // FONTOS: a selector STABIL referenciát adjon vissza — a `?? []` minden
  // híváskor új tömböt csinálna, amitől a zustand egyenlőség-vizsgálata sosem
  // teljesül és a komponens végtelenül újrarenderel („Maximum update depth")
  const projectMarkers = useEditorStore((s) => s.project?.markers);
  const markers = projectMarkers ?? EMPTY_MARKERS;
  // a playheadhez fél mp-en belüli jelölő „ugyanaz" — arra a gomb töröl
  const nearMarker = markers.find((m) => Math.abs(m.time - playhead) < 0.5) ?? null;

  /** 🔖 jelölő a lejátszófejnél: hozzáadás névvel, vagy a meglévő törlése */
  const toggleMarker = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    if (nearMarker) {
      Alert.alert(t('editor.transportBar.markerTitle'), t('editor.transportBar.deleteMarkerConfirm', { label: nearMarker.label }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            state.dispatch({
              type: 'SET_MARKERS',
              markers: markers.filter((m) => m.id !== nearMarker.id),
            }),
        },
      ]);
      return;
    }
    const defaultLabel = t('editor.transportBar.defaultMarkerLabel', { number: markers.length + 1 });
    const add = (label?: string) =>
      state.dispatch({
        type: 'SET_MARKERS',
        markers: [
          ...markers,
          { id: makeId('mk'), time: playhead, label: (label ?? '').trim() || defaultLabel },
        ],
      });
    // az Alert.prompt csak iOS-en létezik — Androidon alapnévvel megy be
    if (typeof Alert.prompt !== 'function') {
      add();
      return;
    }
    Alert.prompt(
      t('editor.transportBar.newMarkerTitle'),
      t('editor.transportBar.newMarkerMessage', { time: formatTime(playhead) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.add'), onPress: (label?: string) => add(label) },
      ],
      'plain-text',
      defaultLabel
    );
  };

  const togglePlay = () => {
    if (!isPlaying && playhead >= duration && duration > 0) {
      setPlayhead(0);
    }
    setPlaying(!isPlaying);
  };

  return (
    <View style={styles.container}>
      <Pressable onPress={undo} disabled={!canUndo} hitSlop={6} style={styles.side}>
        <Ionicons
          name="arrow-undo-outline"
          size={18}
          color={canUndo ? palette.text : palette.border}
        />
      </Pressable>
      <Pressable onPress={redo} disabled={!canRedo} hitSlop={6} style={styles.side}>
        <Ionicons
          name="arrow-redo-outline"
          size={18}
          color={canRedo ? palette.text : palette.border}
        />
      </Pressable>

      <View style={styles.center}>
        <Pressable onPress={() => setPlayhead(0)} hitSlop={6}>
          <Ionicons name="play-skip-back" size={18} color={palette.text} />
        </Pressable>
        <Pressable
          onPress={() => setPlayhead(Math.max(0, playhead - 0.1))}
          hitSlop={6}
        >
          <Ionicons name="chevron-back" size={16} color={palette.textDim} />
        </Pressable>
        <Pressable onPress={togglePlay} style={styles.playPressable}>
          <LinearGradient
            colors={[...accentGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.playButton}
          >
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={palette.text} />
          </LinearGradient>
        </Pressable>
        <Pressable onPress={() => setPlayhead(playhead + 0.1)} hitSlop={6}>
          <Ionicons name="chevron-forward" size={16} color={palette.textDim} />
        </Pressable>
        <Text style={styles.time}>
          {formatTime(playhead)} <Text style={styles.timeDim}>/ {formatTime(duration)}</Text>
        </Text>
      </View>

      {/* 🔖 szerkezeti jelölő a lejátszófejnél */}
      <Pressable onPress={toggleMarker} hitSlop={6} style={styles.side}>
        <Ionicons
          name={nearMarker ? 'bookmark' : 'bookmark-outline'}
          size={18}
          color={nearMarker ? palette.accent2 : palette.textDim}
        />
      </Pressable>
      {/* 🎬 részlet-előnézet: a playhead körüli pár mp valódi renderje */}
      <DetailPreview />
      <Pressable onPress={() => setLoop(!loop)} hitSlop={6} style={styles.side}>
        <Ionicons
          name="repeat"
          size={18}
          color={loop ? palette.accent : palette.textDim}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.bg,
    // szűk rések: a sávon 9 elem osztozik (undo/redo · transport + idő ·
    // jelölő · részlet-előnézet · loop) — tágabb réssel a szélső gombok
    // kiszorulnának, az időkijelzőre pedig rálógna a szomszéd ikon
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  side: {
    padding: 3,
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playPressable: {
    borderRadius: 22,
    shadowColor: palette.accent,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: {
    color: palette.text,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  timeDim: {
    color: palette.textDim,
  },
});
