import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 🎥 host: élő jelenet-váltó (OBS-szerű) — REFACTOR: a src/app/live/[id].tsx-ből. A gyökér
 * csak akkor rendereli, ha a host több jelenetet visz.
 */

export interface LiveSceneSwitcherProps {
  hostScenes: { id: string; name: string }[];
  activeSceneId: string | undefined;
  switchScene: (sceneId: string) => void;
}

export function LiveSceneSwitcher({ hostScenes, activeSceneId, switchScene }: LiveSceneSwitcherProps) {
  return (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sceneSwitchRow}
            keyboardShouldPersistTaps="handled"
          >
            {hostScenes.map((sc) => {
              const on = sc.id === activeSceneId;
              return (
                <Pressable
                  key={sc.id}
                  onPress={() => switchScene(sc.id)}
                  style={[styles.sceneSwitchChip, on && styles.sceneSwitchChipOn]}
                >
                  <Text style={[styles.sceneSwitchText, on && styles.sceneSwitchTextOn]} numberOfLines={1}>
                    {sc.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
  );
}

const styles = StyleSheet.create({
  sceneSwitchRow: { gap: 8, paddingVertical: 10 },
  sceneSwitchChip: {
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#ffffff22',
    maxWidth: 160,
  },
  sceneSwitchChipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  sceneSwitchText: { color: '#ffffffcc', fontSize: 13, fontWeight: '700' },
  sceneSwitchTextOn: { color: '#fff' },
});
