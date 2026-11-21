import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModeCard } from '@/components/studio/model3d/capture/ModeCard';
import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { palette } from '@/constants/editor';
import { availableCaptureModes } from '@/lib/deviceCaps';
import { storedFormatFor } from '@/lib/model3dExport';
import { Remix3DMeshScanView, Remix3DRoomScanView } from '@/lib/remix3dNative';
import type { Model3DDoc } from '@/types/model3d';

/** 🧭 ÜRES: módválasztó (csak a támogatott módok — §1.1) + fájl-import */
export function CaptureModePicker({
  header,
  doc,
  importing,
  onMeshScan,
  onRoomScan,
  onCapture,
  onImport,
}: {
  header: ReactNode;
  doc: Model3DDoc | undefined;
  importing: boolean;
  onMeshScan: (mode: 'mesh' | 'points') => void;
  onRoomScan: () => void;
  onCapture: () => void;
  onImport: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const modes = availableCaptureModes();
  // az eredmény TÉNYLEGES formátuma a projekt tárolási beállítása szerint (adatvesztés nélkül)
  const fmt = (kind: { textured: boolean; points: boolean }) => storedFormatFor(doc?.storageFormat, kind).toUpperCase();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      {header}
      <ScrollView contentContainerStyle={styles.pickerScroll}>
        <Text style={styles.emoji}>🧊</Text>
        <Text style={styles.bigText}>{t('model3d.empty.title')}</Text>
        <Text style={[styles.dim, styles.centerText]}>{t('model3d.empty.body')}</Text>
        {modes.includes('freeform') && Remix3DMeshScanView ? (
          <ModeCard icon="grid-outline" mode="freeform" format={fmt({ textured: false, points: false })} onPress={() => onMeshScan('mesh')} />
        ) : null}
        {modes.includes('room') && Remix3DRoomScanView ? (
          <ModeCard icon="home-outline" mode="room" format={fmt({ textured: false, points: false })} onPress={onRoomScan} />
        ) : null}
        {modes.includes('pointcloud') && Remix3DMeshScanView ? (
          <ModeCard icon="sparkles-outline" mode="pointcloud" format={fmt({ textured: false, points: true })} onPress={() => onMeshScan('points')} />
        ) : null}
        {modes.includes('object') ? (
          <ModeCard icon="cube-outline" mode="object" format={fmt({ textured: true, points: false })} onPress={onCapture} />
        ) : null}
        {/* 📥 meglévő 3D-fájl (Blender, Sketchfab, más szkenner-app, CAD …) */}
        <ModeCard icon="download-outline" mode="import" format={fmt({ textured: true, points: false })} onPress={() => void onImport()} />
        {importing ? <ActivityIndicator color={palette.accent} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
