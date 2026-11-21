import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { styles } from '@/components/editor/cameraRecorder/cameraRecorderStyles';
import { filters, palette } from '@/constants/editor';
import { SPEEDS } from '@/lib/cameraRecorderOps';
import type { FilterId } from '@/types/project';

/** 🎥 A kamera-felvevő vezérlői (REFACTOR: a CameraRecorder.tsx-ből): felső sáv, alsó kreatív sáv. */

/** felső sáv: bezárás + rács + torch + flip */
export function CameraTopBar({
  onClose,
  grid,
  setGrid,
  torch,
  setTorch,
  facing,
  setFacing,
}: {
  onClose: () => void;
  grid: boolean;
  setGrid: Dispatch<SetStateAction<boolean>>;
  torch: boolean;
  setTorch: Dispatch<SetStateAction<boolean>>;
  facing: 'front' | 'back';
  setFacing: Dispatch<SetStateAction<'front' | 'back'>>;
}) {
  return (
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
  );
}

/** alsó kreatív vezérlők + felvevő-gomb */
export function CameraBottomBar({
  t,
  speed,
  setSpeed,
  filterId,
  setFilterId,
  recording,
  stopRecording,
  startWithCountdown,
}: {
  t: TFunction;
  speed: number;
  setSpeed: Dispatch<SetStateAction<number>>;
  filterId: FilterId;
  setFilterId: Dispatch<SetStateAction<FilterId>>;
  recording: boolean;
  stopRecording: () => void;
  startWithCountdown: () => void;
}) {
  return (
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
              {t(f.label)}
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
        {recording
          ? t('editor.cameraRecorder.tapToStop')
          : t('editor.cameraRecorder.tapToRecord')}
      </Text>
    </View>
  );
}
