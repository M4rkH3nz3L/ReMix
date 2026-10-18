import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 🗂️ A Stúdió alsó fül-sávja: Projektek (tetejére-görgetés) / Sablonok
 * (aljára-görgetés) / AI eszközök. A tényleges akciókat a szülő adja át.
 */
export function StudioTabBar({
  onScrollTop,
  onScrollEnd,
  onAiTools,
}: {
  onScrollTop: () => void;
  onScrollEnd: () => void;
  onAiTools: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.tabBar}>
      {(
        [
          {
            icon: 'albums',
            label: t('home.tabProjects'),
            active: true,
            // aktív fül újra-koppintása → a lista tetejére (iOS-minta)
            onPress: onScrollTop,
          },
          {
            icon: 'grid-outline',
            label: t('home.tabTemplates'),
            // a sablonok a lista alján (karusszel) → odagörgetünk, nem create-modal
            onPress: onScrollEnd,
          },
          {
            icon: 'sparkles-outline',
            label: t('home.tabAiTools'),
            onPress: onAiTools,
          },
        ] as const
      ).map((tab) => (
        <Pressable key={tab.label} style={styles.tabItem} onPress={tab.onPress}>
          <Ionicons
            name={tab.icon}
            size={20}
            color={'active' in tab && tab.active ? palette.accent : palette.textDim}
          />
          <Text
            style={[
              styles.tabLabel,
              'active' in tab && tab.active ? styles.tabLabelActive : null,
            ]}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  tabLabel: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: palette.accent,
  },
});
