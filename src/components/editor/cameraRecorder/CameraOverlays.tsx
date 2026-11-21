import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { styles } from '@/components/editor/cameraRecorder/cameraRecorderStyles';
import { palette } from '@/constants/editor';
import { formatRecordTime } from '@/lib/cameraRecorderOps';

/**
 * 🎥 A kamera-kép fölötti rétegek (REFACTOR: a CameraRecorder.tsx-ből): engedély-kérő,
 * szűrő-előnézet + rács, felvételi idő + visszaszámláló.
 */

/** engedély nélkül: magyarázat + újrakérés (a kérést a hívó natív hookjai végzik) */
export function CameraPermissionPrompt({
  t,
  requestCam,
  requestMic,
}: {
  t: TFunction;
  requestCam: () => unknown;
  requestMic: () => unknown;
}) {
  return (
    <View style={styles.permWrap}>
      <Ionicons name="videocam-outline" size={48} color={palette.textDim} />
      <Text style={styles.permText}>{t('editor.cameraRecorder.permissionNeeded')}</Text>
      <Pressable
        style={styles.permBtn}
        onPress={() => {
          requestCam();
          requestMic();
        }}
      >
        <Text style={styles.permBtnText}>{t('editor.cameraRecorder.grantPermission')}</Text>
      </Pressable>
    </View>
  );
}

/** élő szűrő-előnézet + harmadoló rács */
export function FilterGridOverlay({
  filter,
  grid,
}: {
  filter: { overlay: string | null; opacity: number } | undefined;
  grid: boolean;
}) {
  return (
    <>
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
    </>
  );
}

/** felvételi idő / visszaszámláló */
export function RecordingIndicators({
  recording,
  elapsed,
  countdown,
}: {
  recording: boolean;
  elapsed: number;
  countdown: number;
}) {
  return (
    <>
      {recording ? (
        <View style={styles.timerPill}>
          <View style={styles.recDot} />
          <Text style={styles.timerText}>{formatRecordTime(elapsed)}</Text>
        </View>
      ) : null}
      {countdown > 0 ? (
        <View style={styles.countdownWrap} pointerEvents="none">
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      ) : null}
    </>
  );
}
