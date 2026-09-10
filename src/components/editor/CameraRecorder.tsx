import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { filters, palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { ensureProxy } from '@/lib/proxy';
import { useEditorStore } from '@/store/editorStore';
import type { FilterId } from '@/types/project';

const MAX_SEC = 60; // short-video felső korlát (auto-stop)
const SPEEDS = [0.5, 1, 2, 3] as const;

/**
 * In-app kamera-felvétel (short-video belépő) — TikTok-szerű, kreatív:
 * élő szűrő-előnézet (a vibe már felvétel közben látszik ÉS a klipbe ég),
 * sebesség-preset (a klip speed-jét állítja), harmadoló rács, elöl/hátsó
 * kamera, torch, visszaszámláló, felvételi idő + 60 mp auto-stop. A felvett
 * klip natívan iOS-kompatibilis H.264/AAC mp4-ként a videósáv végére kerül,
 * a választott szűrővel és sebességgel.
 */
export function CameraRecorder({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [torch, setTorch] = useState(false);
  const [grid, setGrid] = useState(false);
  const [filterId, setFilterId] = useState<FilterId>('none');
  const [speed, setSpeed] = useState<number>(1);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // engedélyek kérése a felvevő megnyitásakor
  useEffect(() => {
    if (visible) {
      if (!camPerm?.granted) {
        requestCam();
      }
      if (!micPerm?.granted) {
        requestMic();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const saveAndAdd = async (uri: string, recorded: number) => {
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const dir = new Directory(Paths.document, 'media');
    try {
      dir.create();
    } catch {
      /* már létezik */
    }
    const target = new File(dir, `rec_${makeId('v')}.mp4`);
    try {
      new File(uri).copy(target);
    } catch {
      /* ha a másolás nem megy, a cache-uri marad */
    }
    const finalUri = target.exists ? target.uri : uri;
    const src = Math.max(0.5, Math.round(recorded * 10) / 10);
    // a sebesség a klip idővonal-hosszát rövidíti (2× → fele annyi idő), a
    // választott szűrő a klipre kerül és a renderben ég be
    ensureProxy(finalUri).catch(() => {});
    useEditorStore.getState().addClip(
      'video',
      {
        kind: 'video',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration: Math.max(0.3, src / speed),
        uri: finalUri,
        trimIn: 0,
        sourceDuration: src,
        speed,
        volume: 1,
        filterId,
      },
      { id: makeId('ast'), kind: 'video', uri: finalUri, provider: 'local', duration: src }
    );
  };

  const beginRecording = async () => {
    if (recording || !cameraRef.current) {
      return;
    }
    setRecording(true);
    elapsedRef.current = 0;
    setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      elapsedRef.current = s;
      setElapsed(s);
      if (s >= MAX_SEC) {
        cameraRef.current?.stopRecording();
      }
    }, 200);
    try {
      const res = await cameraRef.current.recordAsync({ maxDuration: MAX_SEC });
      clearTimer();
      setRecording(false);
      if (res?.uri) {
        await saveAndAdd(res.uri, elapsedRef.current);
        onClose();
      }
    } catch {
      clearTimer();
      setRecording(false);
    }
  };

  // 3 mp visszaszámláló, majd felvétel
  const startWithCountdown = () => {
    if (recording || countdown > 0) {
      return;
    }
    setCountdown(3);
    const t0 = Date.now();
    const iv = setInterval(() => {
      const left = 3 - Math.floor((Date.now() - t0) / 1000);
      if (left <= 0) {
        clearInterval(iv);
        setCountdown(0);
        beginRecording();
      } else {
        setCountdown(left);
      }
    }, 200);
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const granted = camPerm?.granted && micPerm?.granted;
  const filter = filters.find((f) => f.id === filterId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        {granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode="video"
            enableTorch={torch}
          />
        ) : (
          <View style={styles.permWrap}>
            <Ionicons name="videocam-outline" size={48} color={palette.textDim} />
            <Text style={styles.permText}>A felvételhez kamera- és mikrofon-engedély kell.</Text>
            <Pressable
              style={styles.permBtn}
              onPress={() => {
                requestCam();
                requestMic();
              }}
            >
              <Text style={styles.permBtnText}>Engedélyezés</Text>
            </Pressable>
          </View>
        )}

        {/* 🎨 élő szűrő-előnézet (a valódi filter a renderben ég be a klipre) */}
        {filter?.overlay ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: filter.overlay, opacity: filter.opacity },
            ]}
          />
        ) : null}

        {/* harmadoló rács */}
        {grid ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.gridV, { left: '33.33%' }]} />
            <View style={[styles.gridV, { left: '66.66%' }]} />
            <View style={[styles.gridH, { top: '33.33%' }]} />
            <View style={[styles.gridH, { top: '66.66%' }]} />
          </View>
        ) : null}

        {/* felső sáv: bezárás + rács + torch + flip */}
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.topBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={() => setGrid((g) => !g)} hitSlop={10} style={styles.topBtn}>
              <Ionicons name="grid-outline" size={22} color={grid ? palette.accent : '#fff'} />
            </Pressable>
            <Pressable
              onPress={() => setTorch((t) => !t)}
              hitSlop={10}
              style={styles.topBtn}
              disabled={facing === 'front'}
            >
              <Ionicons name={torch ? 'flash' : 'flash-off'} size={24} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              hitSlop={10}
              style={styles.topBtn}
            >
              <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* felvételi idő / visszaszámláló */}
        {recording ? (
          <View style={styles.timerPill}>
            <View style={styles.recDot} />
            <Text style={styles.timerText}>{fmt(elapsed)}</Text>
          </View>
        ) : null}
        {countdown > 0 ? (
          <View style={styles.countdownWrap} pointerEvents="none">
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        ) : null}

        {/* alsó kreatív vezérlők + felvevő-gomb */}
        {granted ? (
          <View style={styles.bottomBar}>
            {/* sebesség-presetek */}
            <View style={styles.speedRow}>
              {SPEEDS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setSpeed(s)}
                  style={[styles.speedPill, speed === s ? styles.speedPillActive : null]}
                >
                  <Text style={[styles.speedText, speed === s ? styles.speedTextActive : null]}>
                    {s}×
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* szűrő-karusszel */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {filters.map((f) => (
                <Pressable key={f.id} onPress={() => setFilterId(f.id)} style={styles.filterItem}>
                  <View
                    style={[
                      styles.filterSwatch,
                      { backgroundColor: f.overlay ?? palette.surfaceHigh },
                      filterId === f.id ? styles.filterSwatchActive : null,
                    ]}
                  >
                    {f.id === 'none' ? (
                      <Ionicons name="ban-outline" size={16} color="#fff" />
                    ) : null}
                  </View>
                  <Text style={styles.filterLabel} numberOfLines={1}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* felvevő-gomb */}
            <Pressable
              onPress={recording ? stopRecording : startWithCountdown}
              style={styles.shutterOuter}
            >
              <View style={recording ? styles.shutterStop : styles.shutterInner} />
            </Pressable>
            <Text style={styles.hint}>
              {recording ? 'Koppints a leállításhoz' : 'Koppints a felvételhez (max 60 mp)'}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#ffffff55',
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ffffff55',
  },
  topBar: {
    position: 'absolute',
    top: 54,
    left: 18,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerPill: {
    position: 'absolute',
    top: 58,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#00000088',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.danger,
  },
  timerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  countdownWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    color: '#fff',
    fontSize: 96,
    fontWeight: '800',
    textShadowColor: '#000',
    textShadowRadius: 12,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
  },
  speedRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#00000066',
    borderRadius: 999,
    padding: 4,
  },
  speedPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  speedPillActive: {
    backgroundColor: '#ffffff',
  },
  speedText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  speedTextActive: {
    color: '#000',
  },
  filterRow: {
    gap: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  filterItem: {
    alignItems: 'center',
    gap: 4,
    width: 56,
  },
  filterSwatch: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterSwatchActive: {
    borderColor: '#fff',
  },
  filterLabel: {
    color: '#ffffffcc',
    fontSize: 10,
    fontWeight: '600',
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: palette.danger,
  },
  shutterStop: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: palette.danger,
  },
  hint: {
    color: '#ffffffcc',
    fontSize: 12,
    fontWeight: '600',
  },
  permWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 32,
  },
  permText: {
    color: palette.text,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  permBtn: {
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  permBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
