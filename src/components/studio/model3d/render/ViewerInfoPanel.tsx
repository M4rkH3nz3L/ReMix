import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { palette } from '@/constants/editor';
import { formatLength } from '@/lib/model3d';
import { removeMeasurement } from '@/lib/model3dDoc';
import { formatArea, measurementValue } from '@/lib/model3dMeasure';
import { roomCounts } from '@/lib/model3dStudioOps';
import { roomStats } from '@/lib/roomPlanSummary';
import { useEditorStore } from '@/store/editorStore';
import type { Model3DDoc, Model3DMesh, Vec3 } from '@/types/model3d';

/** a néző alatti sáv: statisztika + mérés-lista / szoba-kártya / útmutatás */
export function ViewerInfoPanel({
  doc,
  mesh,
  size,
  measuring,
  pendingPoint,
  onFloorPlan,
}: {
  doc: Model3DDoc | undefined;
  mesh: Model3DMesh;
  size: Vec3;
  measuring: boolean;
  pendingPoint: Vec3 | null;
  onFloorPlan: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={[styles.dim, styles.centerText, styles.stats]}>
        {t('model3d.viewer.stats', {
          tris: mesh.points ? t('model3d.mesh.points', { count: mesh.points }) : mesh.triangles.toLocaleString(),
          size: `${formatLength(size.x)} × ${formatLength(size.y)} × ${formatLength(size.z)}`,
        })}
      </Text>
      {measuring ? (
        <View style={styles.measurePanel}>
          <Text style={[styles.dim, styles.centerText]}>
            {t(pendingPoint ? 'model3d.viewer.measureSecond' : 'model3d.viewer.measureFirst')}
            {(doc?.measurements.length ?? 0) > 0 ? ` ${t('model3d.viewer.measureTapToDelete')}` : ''}
          </Text>
          <View style={styles.measureList}>
            {(doc?.measurements ?? []).map((m) => {
              const v = measurementValue(m);
              return (
                <Pressable
                  key={m.id}
                  style={styles.measureChip}
                  accessibilityRole="button"
                  accessibilityLabel={`${v != null ? formatLength(v) : '—'} — ${t('model3d.viewer.measureTapToDelete')}`}
                  onPress={() => {
                    const latest = useEditorStore.getState().project?.model3d;
                    if (latest) {
                      useEditorStore
                        .getState()
                        .dispatch({ type: 'SET_MODEL3D_DOC', doc: removeMeasurement(latest, m.id), label: t('model3d.viewer.measureDelete') }, 'user');
                    }
                  }}
                >
                  <Ionicons name="resize-outline" size={14} color={palette.accent} />
                  <Text style={styles.measureText}>{v != null ? formatLength(v) : '—'}</Text>
                  <Ionicons name="close" size={14} color={palette.textDim} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : doc?.capture?.room ? (
        <View style={styles.measurePanel}>
          <Text style={[styles.roomLine, styles.centerText]}>
            {`${t('model3d.room.area')}: ${formatArea(doc.capture.room.floorArea)} · ${t('model3d.room.walls')}: ${formatLength(roomStats(doc.capture.room).wallLength, 'm')} · ${t('model3d.room.ceiling')}: ${formatLength(roomStats(doc.capture.room).ceilingHeight, 'm')}`}
          </Text>
          <Text style={[styles.dim, styles.centerText]}>{t('model3d.room.counts', roomCounts(doc.capture.room))}</Text>
          <Pressable onPress={() => void onFloorPlan()} style={styles.measureChip} accessibilityRole="button">
            <Ionicons name="map-outline" size={16} color={palette.accent} />
            <Text style={styles.measureText}>{t('model3d.room.floorPlan')}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.dim, styles.centerText]}>{t('model3d.viewer.hint')}</Text>
      )}
    </>
  );
}
