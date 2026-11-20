import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveSourceBox } from '@/components/live/LiveSourceBox';
import { SOURCE_ICON } from '@/components/live/studio/liveStudioConstants';
import { palette } from '@/constants/editor';
import { activeScene as getActiveScene, sortedSources } from '@/lib/liveDoc';
import { fitCanvas, sourceRect } from '@/lib/liveStudioOps';
import type { LiveDoc, LiveSource, LiveTransform } from '@/types/live';

/** Program-előnézet (SZERKESZTŐ mód): a jelenet forrásait 0–1 dobozokként rajzolja.
 *  A `camera` forrás ÉLŐ `expo-camera` előnézetet kap (a host saját kamerája, pontosan
 *  a forrás transformjában pozicionálva → OBS-szerű valós kompozíció). A Studio élő ELŐTTI
 *  (a LiveKit csak a „Start streaming"-re indul), így a kamera itt szabad — nem ütközik a
 *  publisherrel, és nem a (New-Arch alatt feketén renderelő) WebRTC-nézeten megy.
 *
 *  ⚠️ New-Arch (Fabric) + expo-camera workaround (expo/expo#49760, #31597, #50015): a
 *  Fabric a gyerek-sorrend változását Remove+Insert mutációként commitálja → a `CameraView`
 *  natív nézete `removeFromSuperview`-t kapna JS-unmount nélkül, és NEM inicializálna újra
 *  (fekete, pedig a zöld pont ég). Ezért a `CameraView` egy `collapsable={false}` wrapper
 *  EGYEDÜLI gyereke, külön STABIL rétegben (mindig a vászon első gyereke), és soha nem
 *  rendeződik át; a feliratok/keret FÖLÖTTE, abszolút overlayként jönnek. Egyszerre csak EGY
 *  kamera aktív (iOS), ezért csak az `primaryCameraId` kap élő képet. */
export function LiveCanvas({
  doc,
  width,
  aspect,
  maxHeight,
  selectedId,
  onSelect,
  onMoveSource,
  facing,
  cameraGranted,
  primaryCameraId,
  onRequestCamera,
  onFlip,
  releasing,
}: {
  /** a Go-live alatt az előnézet elengedi a kamerát (L40) */
  releasing?: boolean;
  doc: LiveDoc;
  width: number;
  aspect: number;
  maxHeight: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveSource: (id: string, transform: LiveTransform) => void;
  facing: 'front' | 'back';
  cameraGranted: boolean;
  primaryCameraId: string | null;
  onRequestCamera: () => void;
  onFlip: () => void;
}) {
  const scene = getActiveScene(doc);
  // húzás közben csak a keret mozog, a dokumentum a gesztus végén változik (egy undo)
  const [draft, setDraft] = useState<{ id: string; t: LiveTransform } | null>(null);
  const transformOf = (src: LiveSource) => (draft?.id === src.id ? draft.t : src.transform);
  // a 9:16 vászon túl magas lenne teljes szélességen → ha kell, a magasságra
  // korlátozzuk és a szélességet arányosan csökkentjük (középre igazítva).
  const { w, height } = fitCanvas(width, aspect, maxHeight);
  // az élő kamera-forrás (az első látható) — a preview KÜLÖN, STABIL rétegben megy
  const primaryCam = scene?.sources.find((s) => s.id === primaryCameraId) ?? null;
  const showCamera = !!primaryCam && cameraGranted;
  const camT = primaryCam ? transformOf(primaryCam) : null;
  return (
    <View style={[styles.canvas, { width: w, height }]}>
      {showCamera && camT && (
        <View
          collapsable={false}
          pointerEvents="none"
          style={{
            position: 'absolute',
            ...sourceRect(camT, w, height),
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: '#000',
          }}
        >
          {releasing ? null : <CameraView style={StyleSheet.absoluteFill} facing={facing} mode="video" />}
        </View>
      )}
      {scene &&
        sortedSources(scene).map((src) => {
          const t = transformOf(src);
          const selected = src.id === selectedId;
          const isCamera = src.kind === 'camera';
          const liveCamera = isCamera && src.visible && src.id === primaryCameraId && cameraGranted;
          return (
            <LiveSourceBox
              key={src.id}
              id={src.id}
              transform={src.transform}
              canvas={{ w, h: height }}
              selected={selected}
              onPress={() => (isCamera && !cameraGranted ? onRequestCamera() : onSelect(src.id))}
              onSelect={() => onSelect(src.id)}
              onDraft={(next) => setDraft({ id: src.id, t: next })}
              onCommit={(next) => {
                setDraft(null);
                onMoveSource(src.id, next);
              }}
              style={[
                styles.srcBox,
                liveCamera && styles.srcBoxLive,
                {
                  ...sourceRect(t, w, height),
                  opacity: src.visible ? 1 : 0.35,
                  borderColor: selected ? palette.accent : '#ffffff55',
                  borderWidth: selected ? 2 : 1,
                },
              ]}
            >
              {liveCamera ? (
                <View pointerEvents="none" style={styles.camTag}>
                  <Ionicons name="videocam" size={11} color="#fff" />
                  <Text style={styles.camTagText}>{src.label || 'Camera'}</Text>
                </View>
              ) : isCamera ? (
                <>
                  <Ionicons name="videocam-off" size={18} color="#fff" />
                  <Text style={styles.srcBoxLabel} numberOfLines={1}>
                    {cameraGranted ? src.label || 'Camera' : 'Tap to enable camera'}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name={SOURCE_ICON[src.kind]} size={16} color="#fff" />
                  <Text style={styles.srcBoxLabel} numberOfLines={1}>
                    {src.label || src.kind}
                  </Text>
                </>
              )}
            </LiveSourceBox>
          );
        })}
      {(!scene || scene.sources.length === 0) && (
        <View style={styles.canvasEmpty}>
          <Ionicons name="add-circle-outline" size={28} color={palette.textDim} />
          <Text style={styles.canvasEmptyText}>—</Text>
        </View>
      )}
      {showCamera && (
        <Pressable onPress={onFlip} style={styles.flipBtn} hitSlop={8}>
          <Ionicons name="camera-reverse" size={20} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: '#000', borderRadius: 14, overflow: 'hidden', alignSelf: 'center' },
  srcBox: {
    position: 'absolute',
    backgroundColor: '#ffffff14',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  srcBoxLabel: { color: '#fff', fontSize: 10, fontWeight: '700' },
  srcBoxLive: { backgroundColor: 'transparent' },
  camTag: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#00000073',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  camTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  flipBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00000073',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffffff44',
  },
  canvasEmpty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  canvasEmptyText: { color: palette.textDim },
});
