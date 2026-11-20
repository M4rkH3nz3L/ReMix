import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { shared } from '@/components/live/studio/liveStudioStyles';
import { palette } from '@/constants/editor';
import { removeScene, setActiveScene } from '@/lib/liveDoc';
import type { LiveDoc } from '@/types/live';

export interface ScenesPanelProps {
  live: LiveDoc;
  commit: (next: LiveDoc, label?: string) => void;
  onAddScene: () => void;
}

/** 🎬 jelenet-sáv: váltás, hosszú nyomásra törlés, új jelenet */
export function ScenesPanel({ live, commit, onAddScene }: ScenesPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* scene-strip */}
      <Text style={shared.sectionLabel}>{t('live.studio.scenes', { defaultValue: 'Scenes' })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sceneStrip}>
        {live.scenes.map((s) => {
          const on = s.id === live.activeSceneId;
          return (
            <Pressable
              key={s.id}
              onPress={() => commit(setActiveScene(live, s.id))}
              onLongPress={() =>
                live.scenes.length > 1 &&
                Alert.alert(s.name, undefined, [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => commit(removeScene(live, s.id)),
                  },
                ])
              }
              style={[styles.sceneChip, on && styles.sceneChipOn]}
            >
              <Text style={[styles.sceneChipText, on && styles.sceneChipTextOn]} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.sceneChipCount}>{s.sources.length}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onAddScene} style={[styles.sceneChip, styles.sceneChipAdd]}>
          <Ionicons name="add" size={18} color={palette.accent} />
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  sceneStrip: { gap: 8, paddingVertical: 2 },
  sceneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    maxWidth: 160,
  },
  sceneChipOn: { borderColor: palette.accent, backgroundColor: palette.accent + '22' },
  sceneChipText: { color: palette.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  sceneChipTextOn: { color: palette.accent },
  sceneChipCount: { color: palette.textDim, fontSize: 11, fontWeight: '800' },
  sceneChipAdd: { paddingHorizontal: 14 },
});
