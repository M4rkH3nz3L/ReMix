import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';

import { TimelineClip } from '@/components/editor/TimelineClip';
import {
  BASE_PX_PER_SEC,
  palette,
  trackColors,
  trackHeights,
  trackLabels,
  trackOrder,
} from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { detectBeats, timelineBeats } from '@/lib/beats';
import { projectDuration } from '@/lib/projectUtils';
import { formatRuler } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';

/** ezeken a sávokon van hang — csak ezek kapnak némítás/solo gombot */
const AUDIBLE_TRACKS: TrackType[] = ['video', 'music', 'voiceover', 'sfx'];

/** sáv-ikonok a tablet-fejléchez (látványterv: ikon + címke oszlop) */
const trackIcons: Record<TrackType, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  pip: 'albums',
  adjust: 'color-filter',
  text: 'text',
  captions: 'chatbox-ellipses',
  overlay: 'happy',
  interactive: 'sparkles',
  music: 'musical-notes',
  voiceover: 'mic',
  sfx: 'volume-high',
};

/**
 * CapCut-mintájú idővonal: a lejátszófej középen áll, a tartalom görgetésével
 * léptetünk (scroll offset ↔ playhead). Kétujjas csippentés = zoom.
 */
export function Timeline() {
  const L = useLayout();
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  // 🎚️ sáv-monitorozás (előnézet-szintű) + 🔒 zárolás
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const toggleTrackFlag = useEditorStore((s) => s.toggleTrackFlag);

  /**
   * Telefonon nincs fejléc-oszlop, ezért a lebegő sáv-címke koppintása nyitja
   * a sáv-menüt. (Tableten ugyanezek külön ikongombok a fejlécben.)
   */
  const openTrackMenu = (type: TrackType) => {
    const muted = mutedTracks.includes(type);
    const solo = soloTracks.includes(type);
    const locked = lockedTracks.includes(type);
    Alert.alert(
      trackLabels[type],
      'A némítás és a solo CSAK az előnézetre hat — az exportált videó nem ' +
        'változik tőlük. Végleges elnémításhoz a klip hangerejét állítsd.',
      [
        {
          text: muted ? '🔊 Némítás vissza' : '🔇 Némítás',
          onPress: () => toggleTrackFlag(type, 'mute'),
        },
        {
          text: solo ? '⭐ Solo ki' : '⭐ Csak ez szóljon (solo)',
          onPress: () => toggleTrackFlag(type, 'solo'),
        },
        {
          text: locked ? '🔓 Zárolás fel' : '🔒 Zárolás (véletlen mozdítás ellen)',
          onPress: () => toggleTrackFlag(type, 'lock'),
        },
        { text: 'Mégse', style: 'cancel' },
      ]
    );
  };

  const scrollRef = useRef<ScrollView>(null);
  const scrubbing = useRef(false);
  const scrubEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollX = useRef(0);
  const [viewportW, setViewportW] = useState(0);
  const zoomStart = useRef(zoom);

  const pps = BASE_PX_PER_SEC * zoom;
  const duration = project ? projectDuration(project) : 0;
  const contentW = Math.max(duration + 3, 8) * pps;

  // beat-rács a zenesáv első klipjéből — jelölők a vonalzón + snap-célpontok
  const beatTimes = useEditorStore((s) => s.beatTimes);
  const downbeatTimes = useEditorStore((s) => s.downbeatTimes);
  const musicClip = project?.tracks
    .find((t) => t.type === 'music')
    ?.clips.filter((c) => c.kind === 'audio')
    .sort((a, b) => a.start - b.start)[0];
  const musicKey = musicClip
    ? `${musicClip.uri}|${musicClip.start}|${musicClip.duration}`
    : null;
  useEffect(() => {
    const setBeatGrid = useEditorStore.getState().setBeatGrid;
    if (!musicClip || musicClip.kind !== 'audio') {
      setBeatGrid([], []);
      return;
    }
    let alive = true;
    detectBeats(musicClip.uri).then((grid) => {
      if (!alive || !grid || grid.beats.length === 0) {
        return;
      }
      setBeatGrid(
        timelineBeats(musicClip, grid.beats),
        timelineBeats(musicClip, grid.downbeats)
      );
    });
    return () => {
      alive = false;
    };
    // a musicKey lefedi a klip azonosságát
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicKey]);

  // lejátszás alatt / programozott seek után a scroll követi a playheadet
  useEffect(() => {
    if (scrubbing.current) {
      return;
    }
    const target = playhead * pps;
    if (Math.abs(target - lastScrollX.current) > 2) {
      scrollRef.current?.scrollTo({ x: target, animated: false });
    }
  }, [playhead, pps]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    lastScrollX.current = x;
    if (scrubbing.current && !isPlaying) {
      setPlayhead(x / pps);
    }
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      zoomStart.current = useEditorStore.getState().zoom;
    })
    .onUpdate((e) => {
      setZoom(zoomStart.current * e.scale);
    })
    .runOnJS(true);

  if (!project) {
    return null;
  }

  const rulerStep = pps >= 90 ? 1 : pps >= 40 ? 2 : pps >= 18 ? 5 : 10;
  const rulerMarks: number[] = [];
  for (let t = 0; t <= Math.max(duration + 3, 8); t += rulerStep) {
    rulerMarks.push(t);
  }

  // csak a videó sáv + a tartalommal bíró sávok látszanak — 8 üres sáv helyett
  // kompakt idővonal, a sávok használatba vételkor jelennek meg
  const visibleTracks = trackOrder.filter((type) => {
    if (type === 'video') {
      return true;
    }
    return (project.tracks.find((t) => t.type === type)?.clips.length ?? 0) > 0;
  });

  // nagyobb kijelzőn vastagabb sávok — könnyebb célozni és olvasni
  const th = (t: TrackType) => Math.round(trackHeights[t] * L.editor.trackScale);

  const totalTracksHeight = visibleTracks.reduce((sum, t) => sum + th(t), 0);

  // 🖥️ tablet/széles kijelző: fix fejléc-oszlop ikon+címkével a sávok elején;
  // a görgethető terület a saját szélességét méri, a scroll-matek változatlan.
  // A küszöb a közös méret-osztályból jön (nem külön 700px-es szabály).
  const showHeaders = L.editor.trackHeaderWidth > 0;

  return (
    <GestureDetector gesture={pinch}>
      <View style={styles.outerRow}>
        {showHeaders ? (
          <View style={[styles.headerCol, { width: L.editor.trackHeaderWidth }]}>
            <View style={{ height: RULER_HEIGHT }} />
            {visibleTracks.map((type) => (
              <View
                key={type}
                style={[styles.headerRow, { height: th(type) }]}
              >
                <Ionicons name={trackIcons[type]} size={L.isExpanded ? 16 : 13} color={trackColors[type]} />
                <Text
                  style={[styles.headerText, { color: trackColors[type], fontSize: L.font(10) }]}
                  numberOfLines={1}
                >
                  {trackLabels[type]}
                </Text>
                <View style={styles.headerBtns}>
                  {AUDIBLE_TRACKS.includes(type) ? (
                    <>
                      <Pressable
                        hitSlop={6}
                        onPress={() => toggleTrackFlag(type, 'mute')}
                        style={styles.headerBtn}
                      >
                        <Ionicons
                          name={mutedTracks.includes(type) ? 'volume-mute' : 'volume-medium-outline'}
                          size={12}
                          color={mutedTracks.includes(type) ? palette.accent2 : palette.textDim}
                        />
                      </Pressable>
                      <Pressable
                        hitSlop={6}
                        onPress={() => toggleTrackFlag(type, 'solo')}
                        style={styles.headerBtn}
                      >
                        <Ionicons
                          name={soloTracks.includes(type) ? 'star' : 'star-outline'}
                          size={12}
                          color={soloTracks.includes(type) ? palette.accent : palette.textDim}
                        />
                      </Pressable>
                    </>
                  ) : null}
                  <Pressable
                    hitSlop={6}
                    onPress={() => toggleTrackFlag(type, 'lock')}
                    style={styles.headerBtn}
                  >
                    <Ionicons
                      name={lockedTracks.includes(type) ? 'lock-closed' : 'lock-open-outline'}
                      size={12}
                      color={lockedTracks.includes(type) ? palette.accent2 : palette.textDim}
                    />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <View
          style={styles.container}
          onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
        >
        <ScrollView
          ref={scrollRef}
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onScrollBeginDrag={() => {
            scrubbing.current = true;
            if (scrubEndTimer.current) {
              clearTimeout(scrubEndTimer.current);
            }
            if (useEditorStore.getState().isPlaying) {
              setPlaying(false);
            }
          }}
          onScrollEndDrag={() => {
            // ha nem indul momentum, rövid idő után visszaadjuk az auto-követést
            scrubEndTimer.current = setTimeout(() => {
              scrubbing.current = false;
            }, 120);
          }}
          onMomentumScrollBegin={() => {
            if (scrubEndTimer.current) {
              clearTimeout(scrubEndTimer.current);
            }
            scrubbing.current = true;
          }}
          onMomentumScrollEnd={() => {
            scrubbing.current = false;
          }}
          contentContainerStyle={{ paddingHorizontal: viewportW / 2 }}
        >
          <View style={{ width: contentW }}>
            <View style={styles.ruler}>
              {rulerMarks.map((t) => (
                <View key={t} style={[styles.rulerMark, { left: t * pps }]}>
                  <View style={styles.tick} />
                  <Text style={styles.rulerText}>{formatRuler(t)}</Text>
                </View>
              ))}
              {/* beat-jelölők: pötty minden beatre, erősebb a downbeatre */}
              {beatTimes.map((t) => (
                <View key={`b${t}`} style={[styles.beatDot, { left: t * pps - 1.5 }]} />
              ))}
              {downbeatTimes.map((t) => (
                <View key={`d${t}`} style={[styles.downbeatDot, { left: t * pps - 2 }]} />
              ))}
              {/* 🔖 szerkezeti jelölők: zászló + felirat, koppintásra odaugrik */}
              {(project.markers ?? []).map((m) => (
                <Pressable
                  key={m.id}
                  hitSlop={8}
                  onPress={() => useEditorStore.getState().setPlayhead(m.time)}
                  style={[styles.markerFlag, { left: m.time * pps }]}
                >
                  <View style={styles.markerStem} />
                  <Text style={styles.markerText} numberOfLines={1}>
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {visibleTracks.map((type) => {
              const track = project.tracks.find((t) => t.type === type);
              return (
                <View
                  key={type}
                  style={[
                    styles.trackRow,
                    // halvány, sáv-színű "lane" háttér (látványterv szerint)
                    {
                      height: th(type),
                      backgroundColor: `${trackColors[type]}0d`,
                    },
                  ]}
                >
                  {track?.clips.map((clip) => (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      trackType={type}
                      pps={pps}
                      height={th(type)}
                      selected={clip.id === selectedClipId}
                      multiSelected={multiSelectIds.includes(clip.id)}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* sáv-címkék (nem görgetődnek) — fejléc-oszlopos módban rejtve */}
        {showHeaders ? null : (
          <View pointerEvents="box-none" style={styles.trackLabels}>
            <View pointerEvents="none" style={{ height: RULER_HEIGHT }} />
            {visibleTracks.map((type) => (
              <View
                key={type}
                pointerEvents="box-none"
                style={[styles.trackLabelRow, { height: th(type) }]}
              >
                <Pressable
                  hitSlop={6}
                  onPress={() => openTrackMenu(type)}
                  style={[styles.trackLabelChip, { borderColor: trackColors[type] }]}
                >
                  <Text style={[styles.trackLabelText, { color: trackColors[type], fontSize: L.font(8) }]}>
                    {trackLabels[type]}
                  </Text>
                  {mutedTracks.includes(type) ? (
                    <Ionicons name="volume-mute" size={9} color={palette.accent2} />
                  ) : null}
                  {soloTracks.includes(type) ? (
                    <Ionicons name="star" size={9} color={palette.accent} />
                  ) : null}
                  {lockedTracks.includes(type) ? (
                    <Ionicons name="lock-closed" size={9} color={palette.accent2} />
                  ) : null}
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* középre rögzített lejátszófej */}
        <View
          pointerEvents="none"
          style={[
            styles.playhead,
            { left: viewportW / 2 - 1, height: RULER_HEIGHT + totalTracksHeight },
          ]}
        />
        </View>
      </View>
    </GestureDetector>
  );
}

const RULER_HEIGHT = 22;

const styles = StyleSheet.create({
  outerRow: {
    flexDirection: 'row',
  },
  headerCol: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    // a sávokkal azonos elválasztó, hogy a fejléc-sorok pixelre igazodjanak
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  headerText: {
    fontWeight: '700',
    flexShrink: 1,
  },
  container: {
    flex: 1,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingBottom: 8,
  },
  ruler: {
    height: RULER_HEIGHT,
  },
  rulerMark: {
    position: 'absolute',
    top: 0,
    alignItems: 'flex-start',
  },
  tick: {
    width: 1,
    height: 6,
    backgroundColor: palette.textDim,
  },
  rulerText: {
    color: palette.textDim,
    fontSize: 9,
    marginTop: 1,
  },
  trackRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  markerFlag: {
    position: 'absolute',
    top: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 110,
  },
  markerStem: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: palette.accent2,
  },
  markerText: {
    color: palette.accent2,
    fontSize: 9,
    fontWeight: '700',
    flexShrink: 1,
  },
  beatDot: {
    position: 'absolute',
    bottom: 1,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: `${palette.accent2}aa`,
  },
  downbeatDot: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: 6,
    borderRadius: 2,
    backgroundColor: palette.accent2,
  },
  trackLabels: {
    position: 'absolute',
    left: 6,
    top: 0,
  },
  trackLabelRow: {
    justifyContent: 'center',
  },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  headerBtn: {
    padding: 2,
  },
  trackLabelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: `${palette.bg}cc`,
  },
  trackLabelText: {
    fontWeight: '700',
  },
  playhead: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: palette.text,
    borderRadius: 1,
  },
});
