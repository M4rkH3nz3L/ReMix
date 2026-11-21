import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { palette } from '@/constants/editor';
import { modelRotation } from '@/lib/model3dLook';
import { measureLineCoords } from '@/lib/model3dStudioOps';
import type { ModelViewHandle, Remix3DModelView, WireframeMode } from '@/lib/remix3dNative';
import type { Model3DDoc, Vec3 } from '@/types/model3d';
import type { Asset } from '@/types/project';

/** 👀 a natív 3D-néző (forgatás, nagyítás, mérés, vágósík) + a betöltési hiba jelzése */
export function ModelViewport({
  ModelView,
  viewRef,
  asset,
  doc,
  bg,
  autoRotate,
  cutPreviewY,
  measuring,
  pendingPoint,
  wireframe,
  loadFailed,
  onTapPoint,
  onLoad,
  onError,
}: {
  ModelView: NonNullable<typeof Remix3DModelView>;
  viewRef: RefObject<ModelViewHandle | null>;
  asset: Asset;
  doc: Model3DDoc | undefined;
  bg: string | null;
  autoRotate: boolean;
  cutPreviewY: number | null;
  measuring: boolean;
  pendingPoint: Vec3 | null;
  wireframe: WireframeMode;
  loadFailed: boolean;
  onTapPoint: (e: { nativeEvent: { x: number; y: number; z: number } }) => void;
  onLoad: () => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.viewer, { backgroundColor: bg ?? palette.bg }]}>
      <ModelView
        ref={viewRef}
        style={StyleSheet.absoluteFill}
        modelUri={asset.uri}
        background={bg}
        autoRotate={autoRotate}
        modelRotation={(() => {
          const q = modelRotation(doc);
          return [q.x, q.y, q.z, q.w];
        })()}
        lightingPreset={doc?.environment.preset ?? 'studio'}
        exposure={doc?.environment.exposure ?? 1}
        cutPlaneY={cutPreviewY}
        measureMode={measuring}
        measureLines={measureLineCoords(doc?.measurements ?? [])}
        measureDots={pendingPoint ? [pendingPoint.x, pendingPoint.y, pendingPoint.z] : []}
        onTapPoint={onTapPoint}
        wireframe={wireframe}
        onLoad={onLoad}
        onError={onError}
      />
      {loadFailed ? (
        <View style={styles.loadFailed} pointerEvents="none">
          <Text style={[styles.dim, styles.centerText]}>{t('model3d.viewer.loadFailed')}</Text>
        </View>
      ) : null}
    </View>
  );
}
