import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { DetailPreview } from '@/components/editor/DetailPreview';
import { HistoryModal } from '@/components/editor/HistoryModal';
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { accentGradient, palette } from '@/constants/editor';
import { formatTimecode, frameDuration, projectFps, snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Marker } from '@/types/project';

/** közös üres tömb — hogy a selector referenciája ne változzon (lásd lent) */
const EMPTY_MARKERS: Marker[] = [];

/** jelölő-szín paletta — új jelölő ciklikusan kap színt, az „átszínezés" ezen lépked */
export const MARKER_COLORS = ['#ff5ca8', '#4a9eff', '#2ecc8f', '#ffb454', '#a06bff', '#ff6b6b'];
export function nextMarkerColor(current?: string): string {
  const i = current ? MARKER_COLORS.indexOf(current) : -1;
  return MARKER_COLORS[(i + 1) % MARKER_COLORS.length];
}

export function TransportBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const projectId = useEditorStore((s) => s.project?.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailTrigger, setDetailTrigger] = useState(0);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const loop = useEditorStore((s) => s.loop);
  const playbackRate = useEditorStore((s) => s.playbackRate);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setLoop = useEditorStore((s) => s.setLoop);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaybackRate = useEditorStore((s) => s.setPlaybackRate);
  const shuttle = useEditorStore((s) => s.shuttle);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const duration = useEditorStore((s) => (s.project ? projectDuration(s.project) : 0));
  const fps = useEditorStore((s) => projectFps(s.project));
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
          text: t('editor.transportBar.recolorMarker'),
          onPress: () =>
            state.dispatch({
              type: 'SET_MARKERS',
              markers: markers.map((m) =>
                m.id === nearMarker.id ? { ...m, color: nextMarkerColor(m.color) } : m
              ),
            }),
        },
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
    // új jelölő ciklikus színt kap (a jelölő-sorszám szerint)
    const color = MARKER_COLORS[markers.length % MARKER_COLORS.length];
    const add = (label?: string) =>
      state.dispatch({
        type: 'SET_MARKERS',
        markers: [
          ...markers,
          { id: makeId('mk'), time: playhead, label: (label ?? '').trim() || defaultLabel, color },
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
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    // normál lejátszás mindig 1× előre (shuttle-sebesség nullázása)
    setPlaybackRate(1);
    if (playhead >= duration && duration > 0) {
      setPlayhead(0);
    }
    setPlaying(true);
  };

  /** ⏭️ képkocka-pontos léptetés: a lejátszófejet a projekt frame-rácsára igazítja, majd ±1 kocka */
  const stepFrame = (dir: -1 | 1) => {
    if (isPlaying) {
      setPlaying(false);
    }
    setPlaybackRate(1);
    const snapped = snapToFrame(playhead, fps);
    setPlayhead(Math.max(0, snapped + dir * frameDuration(fps)));
  };

  // ⏯️ shuttle-kijelző: |sebesség| ≠ 1 esetén jelöli (pl. „2×", „-4×")
  const rateLabel = isPlaying && Math.abs(playbackRate) !== 1 ? `${playbackRate}×` : null;

  /** ⋯ a ritkább transport-műveletek egy menüben (D3: a sáv 13 vezérlője 7-re szűkült) */
  const openMore = () => {
    const items: { text: string; onPress?: () => void; style?: 'cancel' }[] = [
      { text: t('editor.transportBar.toStart'), onPress: () => setPlayhead(0) },
      { text: t('editor.transportBar.shuttleBack'), onPress: () => shuttle(-1) },
      { text: t('editor.transportBar.shuttleFwd'), onPress: () => shuttle(1) },
      {
        text: loop ? t('editor.transportBar.loopOff') : t('editor.transportBar.loopOn'),
        onPress: () => setLoop(!loop),
      },
      { text: t('editor.detailPreview.title'), onPress: () => setDetailTrigger((n) => n + 1) },
      ...(projectId
        ? [{ text: t('editor.transportBar.fullscreen'), onPress: () => router.push(`/player/${projectId}`) }]
        : []),
      { text: t('editor.history.title'), onPress: () => setHistoryOpen(true) },
      { text: t('common.cancel'), style: 'cancel' as const },
    ];
    Alert.alert(t('editor.transportBar.moreTitle'), undefined, items);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={undo}
        disabled={!canUndo}
        style={styles.side}
        accessibilityRole="button"
        accessibilityLabel={t('editor.transportBar.undo')}
        accessibilityState={{ disabled: !canUndo }}
      >
        <Ionicons name="arrow-undo-outline" size={20} color={canUndo ? palette.text : palette.border} />
      </Pressable>
      <Pressable
        onPress={redo}
        disabled={!canRedo}
        style={styles.side}
        accessibilityRole="button"
        accessibilityLabel={t('editor.transportBar.redo')}
        accessibilityState={{ disabled: !canRedo }}
      >
        <Ionicons name="arrow-redo-outline" size={20} color={canRedo ? palette.text : palette.border} />
      </Pressable>

      <View style={styles.center}>
        {/* ⏱️ időkijelző a gombok FÖLÖTT (külön sorban) */}
        <Text style={styles.time} numberOfLines={1}>
          {rateLabel ? <Text style={styles.rate}>{rateLabel} </Text> : null}
          {loop ? <Text style={styles.rate}>⟲ </Text> : null}
          {formatTimecode(playhead, fps)}{' '}
          <Text style={styles.timeDim}>/ {formatTimecode(duration, fps)}</Text>
        </Text>
        <View style={styles.transportRow}>
          {/* ⏭️ képkocka-pontos léptetés */}
          <Pressable
            onPress={() => stepFrame(-1)}
            style={styles.side}
            accessibilityRole="button"
            accessibilityLabel={t('editor.transportBar.frameBack')}
          >
            <Ionicons name="play-back" size={18} color={palette.textDim} />
          </Pressable>
          {/* K: lejátszás/szünet (a J/L shuttle a ⋯ menüben és billentyűn) */}
          <TutorialTarget id="transport.playPause">
            <Pressable
              onPress={togglePlay}
              style={styles.playPressable}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('editor.transportBar.pause') : t('editor.transportBar.play')}
            >
              <LinearGradient
                colors={[...accentGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.playButton}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={palette.text} />
              </LinearGradient>
            </Pressable>
          </TutorialTarget>
          <Pressable
            onPress={() => stepFrame(1)}
            style={styles.side}
            accessibilityRole="button"
            accessibilityLabel={t('editor.transportBar.frameFwd')}
          >
            <Ionicons name="play-forward" size={18} color={palette.textDim} />
          </Pressable>
        </View>
      </View>

      {/* 🔖 szerkezeti jelölő a lejátszófejnél */}
      <Pressable
        onPress={toggleMarker}
        style={styles.side}
        accessibilityRole="button"
        accessibilityLabel={t('editor.transportBar.markerTitle')}
      >
        <Ionicons
          name={nearMarker ? 'bookmark' : 'bookmark-outline'}
          size={20}
          color={nearMarker ? palette.accent2 : palette.textDim}
        />
      </Pressable>
      {/* ⋯ ritkább műveletek: elejére, J/L shuttle, ismétlés, részlet-előnézet, teljes nézet, előzmények */}
      <Pressable
        onPress={openMore}
        style={styles.side}
        accessibilityRole="button"
        accessibilityLabel={t('editor.transportBar.moreTitle')}
      >
        <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color={palette.textDim} />
      </Pressable>
      {/* 🎬 részlet-előnézet: a ⋯ menüből indul (gomb nélkül — futás közben pörgő jelző) */}
      <DetailPreview trigger={detailTrigger} showButton={false} />
      {/* ⚡ csak nyitva mountoljuk */}
      {historyOpen ? <HistoryModal visible onClose={() => setHistoryOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.bg,
    // 7 vezérlő (undo · redo · ◀kocka · play · kocka▶ · jelölő · ⋯), mind ≥44pt —
    // a ritkák (elejére, J/L, ismétlés, részlet-előnézet, teljes nézet, előzmények) a ⋯-ben
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 0,
  },
  // ≥44pt érintési cél (HIG) — a régi 18px-es ikon + 3px padding ~24pt volt
  side: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    // OSZLOP: felül az idő, alatta a transport-gombsor (mobilon így kifér)
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rate: {
    color: palette.accent,
    fontWeight: '800',
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
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  timeDim: {
    color: palette.textDim,
  },
});
