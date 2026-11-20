import { useTranslation } from 'react-i18next';
import { Alert, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/shape/shapeStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import { booleanShapes, type BooleanOp } from '@/lib/boolean';
import { makeId } from '@/lib/id';
import { findClip } from '@/lib/projectUtils';
import { booleanResultClip } from '@/lib/shapePanelOps';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** boolean-műveletek (unió / kivonás / metszet / kizárás) a másik kijelölt formával */
export function BooleanSection({ clip, multiSelectIds }: { clip: ShapeClip; multiSelectIds: string[] }) {
  const { t } = useTranslation();

  // 🔗 Boolean: az elsődleges formát a MÁSIK kijelölt formával kombinálja
  const combineWith = (op: BooleanOp) => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || state.multiSelectIds.length !== 1) {
      return;
    }
    const other = findClip(project, state.multiSelectIds[0])?.clip;
    if (!other || other.kind !== 'shape') {
      return;
    }
    const result = booleanShapes(clip, other, op);
    if (!result) {
      Alert.alert(t('panels.shape.boolTitle'), t('panels.shape.boolFail'));
      return;
    }
    const id = makeId('clip');
    const combined = booleanResultClip(clip, other, result, id);
    state.removeClip(clip.id);
    state.removeClip(other.id);
    state.addClip('overlay', combined);
    state.selectClip(id);
  };

  return (
    <PanelSection title={t('panels.shape.boolTitle')}>
      {multiSelectIds.length === 1 ? (
        <View style={styles.row}>
          {(['union', 'subtract', 'intersect', 'exclude'] as const).map((op) => (
            <Chip
              key={op}
              label={t('panels.shape.bool_' + op)}
              active={false}
              onPress={() => combineWith(op)}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.note}>{t('panels.shape.boolHint')}</Text>
      )}
    </PanelSection>
  );
}
