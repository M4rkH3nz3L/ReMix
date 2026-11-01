import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import type { ImageLayer } from '@/types/project';

export type LayerMenuAction = 'multi' | 'duplicate' | 'forward' | 'back' | 'unlock' | 'delete';

const ICONS: Record<LayerMenuAction, keyof typeof Ionicons.glyphMap> = {
  multi: 'checkmark-done-outline',
  duplicate: 'copy-outline',
  forward: 'arrow-up-outline',
  back: 'arrow-down-outline',
  unlock: 'lock-open-outline',
  delete: 'trash-outline',
};

/** a zárolt réteg csak feloldható és másolható */
export const layerMenuActions = (layer: ImageLayer): LayerMenuAction[] =>
  layer.locked ? ['unlock', 'duplicate'] : ['multi', 'duplicate', 'forward', 'back', 'delete'];

/** 🖐️ Hosszú nyomásra nyíló menü a vásznon lévő réteghez. */
export function LayerMenuSheet({ layer, onPick, onClose }: { layer: ImageLayer; onPick: (action: LayerMenuAction) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <StudioSheet title={t('studio.image.layerMenu.title')} icon="ellipsis-horizontal-circle-outline" onClose={onClose}>
      <View style={styles.list}>
        {layerMenuActions(layer).map((action) => (
          <Pressable key={action} testID={`layer-menu-${action}`} style={styles.row} onPress={() => onPick(action)} accessibilityRole="button">
            <Ionicons name={ICONS[action]} size={22} color={action === 'delete' ? palette.danger : palette.text} />
            <Text style={[styles.label, action === 'delete' ? styles.danger : null]}>{t(`studio.image.layerMenu.${action}`)}</Text>
          </Pressable>
        ))}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  label: { color: palette.text, fontSize: 15, fontWeight: '600' },
  danger: { color: palette.danger },
});
