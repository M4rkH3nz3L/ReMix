import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';

/** a stúdió fejléce: vissza, cím; a nézőben projekt-beállítás + visszavonás / újra */
export function StudioHeader({
  projectId,
  projectName,
  showActions,
  canUndo,
  canRedo,
  onBack,
}: {
  projectId: string;
  projectName: string;
  showActions: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Ionicons name="chevron-back" size={26} color={palette.text} />
      </Pressable>
      <View style={styles.headerTitle}>
        <Text style={styles.kindTag}>🧊 {t('model3d.title')}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {projectName}
        </Text>
      </View>
      {showActions ? (
        <View style={styles.headerActions}>
          {/* ⚙️ projekt-beállítások: mappa, ReMix Storage-szinkron, borító */}
          <Pressable
            onPress={() => router.push(`/collab/${projectId}`)}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.viewer.projectSettings')}
          >
            <Ionicons name="settings-outline" size={22} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => useEditorStore.getState().undo()}
            disabled={!canUndo}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.viewer.undo')}
            accessibilityState={{ disabled: !canUndo }}
          >
            <Ionicons name="arrow-undo" size={22} color={canUndo ? palette.text : palette.border} />
          </Pressable>
          <Pressable
            onPress={() => useEditorStore.getState().redo()}
            disabled={!canRedo}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.viewer.redo')}
            accessibilityState={{ disabled: !canRedo }}
          >
            <Ionicons name="arrow-redo" size={22} color={canRedo ? palette.text : palette.border} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
