import { Image } from 'expo-image';
import { haptics } from '@/design';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ClipFilmstrip } from '@/components/editor/ClipFilmstrip';
import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { MIN_CLIP_DURATION, SNAP_PX, palette, trackColors } from '@/constants/editor';
import { getProxyUriSync } from '@/lib/proxy';
import { maxVideoDuration } from '@/lib/projectUtils';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { clamp, formatTime } from '@/lib/time';
import { SNAP_FACTOR, useEditorStore } from '@/store/editorStore';
import type { Clip, TrackType, VideoClip } from '@/types/project';
import type { TFunction } from 'i18next';

interface Props {
  clip: Clip;
  trackType: TrackType;
  /** pixel / másodperc */
  pps: number;
  height: number;
  selected: boolean;
  /** 🧩 a kötegbe is bevéve (nem az elsődleges kijelölés) */
  multiSelected?: boolean;
}

function clipLabel(clip: Clip, t: TFunction): string {
  switch (clip.kind) {
    case 'video':
      return clip.comp
        ? t('editor.timelineClip.compound')
        : clip.speed !== 1
          ? t('editor.timelineClip.videoSpeed', { speed: clip.speed })
          : t('editor.timelineClip.video');
    case 'image':
      return t('editor.timelineClip.image');
    case 'text':
      return clip.text || t('editor.timelineClip.text');
    case 'audio':
      return clip.label || t('editor.timelineClip.audio');
    case 'interactive':
      return clip.label || t('editor.timelineClip.hotspot');
    case 'shape':
      return clip.shape === 'ellipse'
        ? t('editor.timelineClip.ellipse')
        : clip.shape === 'line'
          ? t('editor.timelineClip.line')
          : t('editor.timelineClip.rectangle');
    case 'adjust':
      return t('editor.timelineClip.grade');
  }
}

function selectionHaptic() {
  haptics.selection();
}

/**
 * Egy klip az idővonalon: koppintás = kijelölés, hosszú nyomás + húzás = mozgatás
 * (mágneses illesztés a 0-ra és a lejátszófejre), kijelölve két szélső fogantyúval
 * trimmelhető. A húzás élőben a shared value-kon fut, állapot csak elengedéskor íródik.
 */
function TimelineClipInner({
  clip,
  trackType,
  pps,
  height,
  selected,
  multiSelected,
}: Props) {
  const { t } = useTranslation();
  const selectClip = useEditorStore((s) => s.selectClip);
  const toggleMultiSelect = useEditorStore((s) => s.toggleMultiSelect);
  const multiSelectMode = useEditorStore((s) => s.multiSelectMode);
  // 🔒 zárolt sávon a klip nem mozgatható/trimmelhető/kijelölhető
  const locked = useEditorStore((s) => s.lockedTracks.includes(trackType));
  const toggleTrackFlag = useEditorStore((s) => s.toggleTrackFlag);
  const updateClip = useEditorStore((s) => s.updateClip);
  // ✂️ trim-mód (normal/ripple/roll/slip/slide) — a fogantyú és a test-húzás viselkedése
  const trimMode = useEditorStore((s) => s.trimMode);
  // 🎯 fókusz mód: ha van kijelölés és ez NEM az, halványabb (kiemeli az aktívat)
  const focusMode = useEditorStore((s) => s.focusMode);
  const hasSelection = useEditorStore((s) => s.selectedClipId != null);
  const dimmed = focusMode && hasSelection && !selected && !multiSelected;

  // 🔍 clip-edge preview: trim közben a szélen lévő képkocka + időkód lebeg
  const [edge, setEdge] = useState<{ side: 'left' | 'right'; srcTime: number; tlTime: number } | null>(
    null
  );

  const moveDX = useSharedValue(0);
  const leftDelta = useSharedValue(0);
  const rightDelta = useSharedValue(0);

  useEffect(() => {
    moveDX.value = 0;
    leftDelta.value = 0;
    rightDelta.value = 0;
  }, [clip.start, clip.duration, pps, moveDX, leftDelta, rightDelta]);

  // 🧲 az illesztési küszöb az erősség-beállítás szerint (0 = kikapcsolt snap)
  const snapPx = () => SNAP_PX * SNAP_FACTOR[useEditorStore.getState().snapStrength];

  /**
   * 🧲 A konfigurált illesztési CÉLPONTOK (a magnet-menü kapcsolói szerint): a
   * lejátszófej, MÁS klipek élei (start+vég), a 🔖 jelölők, a zene-beatek és a
   * 🏷️ régiók határai. A saját klip élei kimaradnak. `snapTargets.off` → üres.
   */
  const collectSnapTargets = (): number[] => {
    const st = useEditorStore.getState();
    const cfg = st.snapTargets;
    const targets: number[] = [0];
    if (cfg.playhead) {
      targets.push(st.playhead);
    }
    if (cfg.beats) {
      targets.push(...st.beatTimes);
    }
    if (cfg.markers) {
      targets.push(...(st.project?.markers ?? []).map((m) => m.time));
    }
    if (cfg.regions) {
      for (const r of st.project?.regions ?? []) {
        targets.push(r.start, r.end);
      }
    }
    if (cfg.clips) {
      for (const tk of st.project?.tracks ?? []) {
        for (const c of tk.clips) {
          if (c.id !== clip.id) {
            targets.push(c.start, c.start + c.duration);
          }
        }
      }
    }
    return targets;
  };

  /** A `value` legközelebbi célponthoz illesztve, ha SNAP_PX-en belül van. */
  const snapEdge = (value: number): number => {
    const px = snapPx();
    if (px <= 0) {
      return value;
    }
    const thresh = px / pps;
    let best = value;
    let bestDist = thresh;
    for (const target of collectSnapTargets()) {
      const d = Math.abs(target - value);
      if (d < bestDist) {
        bestDist = d;
        best = target;
      }
    }
    if (best !== value) {
      selectionHaptic();
    }
    return best;
  };

  const commitMove = (dx: number) => {
    moveDX.value = 0;
    const st = useEditorStore.getState();
    // ✂️ slip/slide: a test-húzás nem repozícionál, hanem a forrást/szomszédot csúsztatja
    if (trimMode === 'slip') {
      st.slipEdit(clip.id, dx / pps);
      return;
    }
    if (trimMode === 'slide') {
      st.slideEdit(clip.id, dx / pps);
      return;
    }
    const raw = Math.max(0, clip.start + dx / pps);
    // magnetikus él: a START vagy a VÉG illeszkedjen a legközelebbi célponthoz
    const snapStart = snapEdge(raw);
    const snapEndAsStart = snapEdge(raw + clip.duration) - clip.duration;
    const proposed = Math.max(
      0,
      Math.abs(snapStart - raw) <= Math.abs(snapEndAsStart - raw) ? snapStart : snapEndAsStart
    );
    // 🔗 linkelt klipek (#59): a link-csoport együtt mozog (kijelölés nélkül is)
    const link = st.linkGroupOf(clip.id);
    if (link) {
      st.nudgeClipsBy(link, proposed - clip.start);
      return;
    }
    // csoport-mozgatás (#58): ha ez a klip a több-kijelölés része, együtt mozog a csoport
    if (
      st.multiSelectIds.length > 0 &&
      (clip.id === st.selectedClipId || st.multiSelectIds.includes(clip.id))
    ) {
      st.nudgeSelectedBy(proposed - clip.start);
      return;
    }
    updateClip(clip.id, { start: proposed });
  };

  const commitTrimLeft = (dx: number) => {
    leftDelta.value = 0;
    setEdge(null);
    // 🌀 roll: a bal él a KORÁBBI szomszéddal közös vágáspontot tolja
    if (trimMode === 'roll') {
      useEditorStore.getState().rollEdit(clip.id, 'left', dx / pps);
      return;
    }
    // magnetikus bal él a célpontokhoz
    const rawStart = clip.start + dx / pps;
    const snappedStart = snapEdge(rawStart);
    let deltaSec = clamp(snappedStart - clip.start, -clip.start, clip.duration - MIN_CLIP_DURATION);
    if (clip.kind === 'video') {
      // a forrásfájl elejénél tovább nem húzható vissza
      deltaSec = Math.max(deltaSec, -clip.trimIn / clip.speed);
      updateClip(clip.id, {
        start: clip.start + deltaSec,
        duration: clip.duration - deltaSec,
        trimIn: clip.trimIn + deltaSec * clip.speed,
      });
      return;
    }
    updateClip(clip.id, {
      start: clip.start + deltaSec,
      duration: clip.duration - deltaSec,
    });
  };

  const commitTrimRight = (dx: number) => {
    rightDelta.value = 0;
    setEdge(null);
    const state = useEditorStore.getState();
    // 🌀 roll: a jobb él a KÖVETKEZŐ szomszéddal közös vágáspontot tolja
    if (trimMode === 'roll') {
      state.rollEdit(clip.id, 'right', dx / pps);
      return;
    }
    const max = clip.kind === 'video' ? maxVideoDuration(clip) : Number.POSITIVE_INFINITY;
    const snappedEnd = snapEdge(clip.start + clip.duration + dx / pps);
    const duration = clamp(snappedEnd - clip.start, MIN_CLIP_DURATION, max);
    // ⏭️ ripple: a hossz-változás tolja a mögötte lévőket (minden sávon). Explicit
    // ripple trim-mód VAGY a globális ripple-kapcsoló bekapcsolja.
    const ripple = trimMode === 'ripple' || (trimMode === 'normal' && state.rippleMode);
    if (ripple && state.rippleResize(clip.id, duration)) {
      return;
    }
    updateClip(clip.id, { duration });
  };

  // 🔍 clip-edge preview frissítése húzás közben (a forrás-időt frame-re kvantálva,
  // változatlan érték esetén nem renderel újra)
  const previewLeft = (dx: number) => {
    let deltaSec = clamp(dx / pps, -clip.start, clip.duration - MIN_CLIP_DURATION);
    if (clip.kind === 'video') {
      deltaSec = Math.max(deltaSec, -clip.trimIn / clip.speed);
    }
    const tlTime = clip.start + deltaSec;
    const srcTime = clip.kind === 'video' ? clip.trimIn + deltaSec * clip.speed : 0;
    // frame-nyi küszöb: húzás közben csak érdemi elmozdulásra renderel újra
    setEdge((prev) =>
      prev && prev.side === 'left' && Math.abs(prev.tlTime - tlTime) < 0.02
        ? prev
        : { side: 'left', srcTime, tlTime }
    );
  };
  const previewRight = (dx: number) => {
    const max = clip.kind === 'video' ? maxVideoDuration(clip) : Number.POSITIVE_INFINITY;
    const duration = clamp(clip.duration + dx / pps, MIN_CLIP_DURATION, max);
    const tlTime = clip.start + duration;
    const srcTime = clip.kind === 'video' ? clip.trimIn + duration * clip.speed : 0;
    setEdge((prev) =>
      prev && prev.side === 'right' && Math.abs(prev.tlTime - tlTime) < 0.02
        ? prev
        : { side: 'right', srcTime, tlTime }
    );
  };
  const clearEdge = () => setEdge(null);

  // köteg-módban a koppintás hozzáad/elvesz, egyébként átvált az elsődleges
  // kijelölésre (a köteg ilyenkor elévül — lásd selectClip a store-ban)
  const handleTap = () => {
    if (locked) {
      // néma no-op helyett: elmondjuk, MIÉRT nem történik semmi + feloldás egy koppintással
      Alert.alert(
        t('editor.timelineClip.lockedTitle'),
        t('editor.timelineClip.lockedBody', { track: t('editor.track.' + trackType) }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('editor.timeline.unlock'), onPress: () => toggleTrackFlag(trackType, 'lock') },
        ]
      );
      return;
    }
    if (multiSelectMode) {
      toggleMultiSelect(clip.id);
      selectionHaptic();
      return;
    }
    selectClip(clip.id);
  };

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(handleTap)();
  });

  const movePan = Gesture.Pan()
    .enabled(!locked)
    .activateAfterLongPress(220)
    .onStart(() => {
      runOnJS(selectionHaptic)();
      runOnJS(selectClip)(clip.id);
    })
    .onUpdate((e) => {
      moveDX.value = e.translationX;
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX);
    });

  const trimLeftPan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      leftDelta.value = e.translationX;
      runOnJS(previewLeft)(e.translationX);
    })
    .onEnd((e) => {
      runOnJS(commitTrimLeft)(e.translationX);
    })
    .onFinalize(() => {
      runOnJS(clearEdge)();
    });

  const trimRightPan = Gesture.Pan()
    .enabled(!locked)
    .activeOffsetX([-4, 4])
    .onUpdate((e) => {
      rightDelta.value = e.translationX;
      runOnJS(previewRight)(e.translationX);
    })
    .onEnd((e) => {
      runOnJS(commitTrimRight)(e.translationX);
    })
    .onFinalize(() => {
      runOnJS(clearEdge)();
    });

  const baseWidth = clip.duration * pps;
  const color = trackColors[trackType];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveDX.value + leftDelta.value }],
    width: Math.max(12, baseWidth - leftDelta.value + rightDelta.value),
  }));

  return (
    <GestureDetector gesture={Gesture.Race(movePan, tap)}>
      <Animated.View
        style={[
          styles.clip,
          {
            left: clip.start * pps,
            height: height - 8,
            // a szöveg-jellegű klip tömör pill-chip (látványterv), a média
            // klipek áttetsző keretesek a filmstrip/hullámforma alatt; a
            // hangklip telt, sötétebb blokk a markáns hullám alatt
            backgroundColor:
              clip.kind === 'text'
                ? `${color}d9`
                : clip.kind === 'audio'
                  ? `${color}3d`
                  : `${color}33`,
            borderColor: selected
              ? palette.text
              : multiSelected
                ? palette.accent
                : `${color}aa`,
            borderWidth: selected || multiSelected ? 2 : 1,
            // zárolt sáv halványabb; fókusz módban a nem-kijelöltek elhalványulnak
            opacity: locked ? 0.55 : dimmed ? 0.3 : 1,
          },
          clip.kind === 'text' ? styles.clipPill : null,
          animatedStyle,
        ]}
      >
        {clip.kind === 'video' || clip.kind === 'image' ? (
          <ClipFilmstrip clip={clip} widthPx={baseWidth} heightPx={height - 8} />
        ) : null}
        {clip.kind === 'audio' ? (
          <ClipWaveform clip={clip} widthPx={baseWidth} heightPx={height - 8} color={color} />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            {
              color:
                selected || clip.kind === 'text' || clip.kind === 'audio'
                  ? '#fff'
                  : `${color}`,
            },
            // média-háttér (filmstrip/hullámforma) fölött chip tartja olvashatónak
            clip.kind !== 'text' && clip.kind !== 'interactive' ? styles.labelChip : null,
            // hangklipen a fájlnév kis címke a bal-felső sarokban — a
            // hullámforma marad a főszereplő (látványterv szerint)
            clip.kind === 'audio' ? styles.labelAudio : null,
          ]}
        >
          {clipLabel(clip, t)}
        </Text>
        {selected ? (
          <>
            <GestureDetector gesture={trimLeftPan}>
              <View style={[styles.handle, styles.handleLeft]}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={trimRightPan}>
              <View style={[styles.handle, styles.handleRight]}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
          </>
        ) : null}
        {/* 🔍 clip-edge preview: a vágott szélen lévő képkocka + időkód */}
        {edge ? (
          <View
            pointerEvents="none"
            style={[
              styles.edgePreview,
              edge.side === 'left' ? styles.edgePreviewLeft : styles.edgePreviewRight,
            ]}
          >
            {clip.kind === 'video' ? <EdgeThumb clip={clip} srcTime={edge.srcTime} /> : null}
            {clip.kind === 'image' ? (
              <Image source={{ uri: clip.uri }} style={styles.edgeThumb} contentFit="cover" />
            ) : null}
            <Text style={styles.edgeTime}>{formatTime(edge.tlTime)}</Text>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

/** Egyetlen képkocka a trim-szélen lévő forrás-időpontról (cache-elt, proxyból). */
function EdgeThumb({ clip, srcTime }: { clip: VideoClip; srcTime: number }) {
  const [uri, setUri] = useState<string | null>(null);
  const qTime = snapThumbTime(srcTime);
  useEffect(() => {
    let alive = true;
    const source = getProxyUriSync(clip.uri) ?? clip.uri;
    getFilmstrip(source, [qTime]).then((uris) => {
      if (alive) {
        setUri(uris[0] ?? null);
      }
    });
    return () => {
      alive = false;
    };
  }, [clip.uri, qTime]);
  return uri ? (
    <Image source={{ uri }} style={styles.edgeThumb} contentFit="cover" />
  ) : (
    <View style={styles.edgeThumb} />
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 4,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: 10,
    overflow: 'visible',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  labelChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#07080dcc',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  labelAudio: {
    position: 'absolute',
    top: 2,
    left: 4,
    fontSize: 9,
    fontWeight: '700',
  },
  clipPill: {
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  handle: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.text,
  },
  handleLeft: {
    left: -10,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  handleRight: {
    right: -10,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  handleBar: {
    width: 2,
    height: '40%',
    borderRadius: 1,
    backgroundColor: palette.bg,
  },
  edgePreview: {
    position: 'absolute',
    top: -52,
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: '#07080dee',
  },
  edgePreviewLeft: {
    left: -12,
  },
  edgePreviewRight: {
    right: -12,
  },
  edgeThumb: {
    width: 56,
    height: 32,
    borderRadius: 3,
    backgroundColor: palette.surfaceHigh,
  },
  edgeTime: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

/**
 * Lejátszás közben a playhead 60×/mp frissíti a Timeline-t — a klipek propjai
 * ilyenkor változatlanok, a memo a teljes klipfa újrarenderét spórolja meg.
 */
export const TimelineClip = memo(TimelineClipInner);
