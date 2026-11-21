import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import type { Phase, SetState } from '@/components/studio/model3d/studioTypes';
import { palette } from '@/constants/editor';
import type { WireframeMode } from '@/lib/remix3dNative';
import type { Vec3 } from '@/types/model3d';

/** a háló-megjelenítés ciklusa a nézőben */
const WIREFRAME_CYCLE: WireframeMode[] = ['off', 'overlay', 'only'];

/** a néző eszközsora: forgás, szerkesztés, háló, mérés, export, AR, új szken */
export function ViewerToolbar({
  autoRotate,
  setAutoRotate,
  editOpen,
  setEditOpen,
  wireframe,
  setWireframe,
  measuring,
  setMeasuring,
  setPendingPoint,
  setExportOpen,
  isPoints,
  onAR,
  setPicking,
  setPhase,
}: {
  autoRotate: boolean;
  setAutoRotate: SetState<boolean>;
  editOpen: boolean;
  setEditOpen: SetState<boolean>;
  wireframe: WireframeMode;
  setWireframe: SetState<WireframeMode>;
  measuring: boolean;
  setMeasuring: SetState<boolean>;
  setPendingPoint: SetState<Vec3 | null>;
  setExportOpen: SetState<boolean>;
  isPoints: boolean;
  onAR: () => Promise<void>;
  setPicking: SetState<boolean>;
  setPhase: SetState<Phase>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.toolbar}>
      <Tool icon={autoRotate ? 'pause-circle-outline' : 'sync-outline'} label={t('model3d.viewer.autoRotate')} active={autoRotate} onPress={() => setAutoRotate((v) => !v)} />
      <Tool icon="options-outline" label={t('model3d.viewer.edit')} active={editOpen} onPress={() => setEditOpen(true)} />
      <Tool
        icon="grid-outline"
        label={t(`model3d.viewer.wireframe_${wireframe}`)}
        active={wireframe !== 'off'}
        onPress={() => setWireframe(WIREFRAME_CYCLE[(WIREFRAME_CYCLE.indexOf(wireframe) + 1) % WIREFRAME_CYCLE.length])}
      />
      <Tool
        icon="resize-outline"
        label={t('model3d.viewer.measure')}
        active={measuring}
        onPress={() => {
          setMeasuring((v) => !v);
          setPendingPoint(null);
        }}
      />
      <Tool icon="share-outline" label={t('model3d.export.title')} onPress={() => setExportOpen(true)} />
      {/* 🥽 AR Gyorsnézet — pontfelhőt az AR nem jelenít meg (USDZ háló kell) */}
      {isPoints ? null : <Tool icon="cube-outline" label={t('model3d.ar.short')} onPress={() => void onAR()} />}
      <Tool
        icon="scan-outline"
        label={t('model3d.viewer.newScan')}
        onPress={() => {
          setPicking(true);
          setPhase('empty');
        }}
      />
    </View>
  );
}

function Tool({ icon, label, onPress, active }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.tool} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={active ? palette.accent : palette.text} />
      <Text style={[styles.toolLabel, active ? { color: palette.accent } : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
