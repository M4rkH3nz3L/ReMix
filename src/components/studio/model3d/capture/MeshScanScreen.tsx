import { Ionicons } from '@expo/vector-icons';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import type { SetState } from '@/components/studio/model3d/studioTypes';
import { DARK_LIGHT, meshFinishDisabled } from '@/lib/model3dStudioOps';
import type { MeshScanHandle, MeshScanStateEvent, Remix3DMeshScanView } from '@/lib/remix3dNative';

/** 🕸️ szabad szken (Focus): élő háló / pontfelhő a kameraképen, számlálóval és útmutatással */
export function MeshScanScreen({
  MeshView,
  meshRef,
  scanState,
  setScanState,
  scanMode,
  savingMesh,
  onCancel,
  onFinish,
}: {
  MeshView: NonNullable<typeof Remix3DMeshScanView>;
  meshRef: RefObject<MeshScanHandle | null>;
  scanState: MeshScanStateEvent;
  setScanState: SetState<MeshScanStateEvent>;
  scanMode: 'mesh' | 'points';
  savingMesh: boolean;
  onCancel: () => void;
  onFinish: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dark = scanState.light < DARK_LIGHT;
  const hint = dark ? t('model3d.mesh.dark') : t(`model3d.mesh.tracking_${scanState.tracking}`);
  return (
    <View style={styles.fill}>
      <MeshView ref={meshRef} style={StyleSheet.absoluteFill} onScanState={(ev) => setScanState(ev.nativeEvent)} />
      <SafeAreaView style={styles.fill} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.capTop} pointerEvents="box-none">
          <Pressable
            onPress={onCancel}
            hitSlop={10}
            style={styles.capBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.capture.cancel')}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <View style={styles.fill} />
          <View style={styles.meshCount}>
            <Text style={styles.meshCountText}>
              {scanMode === 'points'
                ? t('model3d.mesh.points', { count: scanState.points ?? 0 })
                : t('model3d.mesh.triangles', { count: scanState.triangles })}
            </Text>
          </View>
        </View>
        <View style={styles.fill} pointerEvents="none" />
        <View style={styles.capBottom}>
          <Text style={styles.capHint} accessibilityLiveRegion="polite">
            {savingMesh ? t('model3d.mesh.saving') : hint}
          </Text>
          {savingMesh ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Pressable
              onPress={() => void onFinish()}
              disabled={meshFinishDisabled(scanMode, scanState)}
              style={[styles.capPrimary, meshFinishDisabled(scanMode, scanState) ? styles.disabled : null]}
              accessibilityRole="button"
            >
              <Text style={styles.capPrimaryText}>{t('model3d.mesh.done')}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
