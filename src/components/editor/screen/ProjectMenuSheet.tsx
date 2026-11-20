import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { palette } from '@/constants/editor';
import { useTutorial } from '@/store/tutorialStore';

/**
 * ⋯ A projekt-menü lap: Mentés most / Mentés másként, telefonon (compact) a
 * fejléc ritka elemei is (képarány, közreműködők, bemutató). Az akció a lap
 * TELJES lezárulása után fut (`menuAction` → onDismissed). A szerkesztő-képernyőből kiemelve.
 */
export function ProjectMenuSheet({
  visible,
  onClose,
  onDismissed,
  isCompact,
  aspectRatio,
  menuAction,
  saveNow,
  saveAsCopy,
  cycleAspect,
  openCollabScreen,
}: {
  visible: boolean;
  onClose: () => void;
  onDismissed: () => void;
  isCompact: boolean;
  aspectRatio: string | undefined;
  menuAction: (fn: () => void) => () => void;
  saveNow: () => void;
  saveAsCopy: () => void;
  cycleAspect: () => void;
  openCollabScreen: () => void;
}) {
  const { t } = useTranslation();
  const projectMenuItems: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
  }[] = [
    { icon: 'save-outline', label: t('editorScreen.saveNow'), onPress: menuAction(saveNow) },
    { icon: 'copy-outline', label: t('editorScreen.saveAsCopy'), onPress: menuAction(saveAsCopy) },
    ...(isCompact
      ? ([
          {
            icon: 'crop-outline',
            label: t('editorScreen.menuAspect', { aspect: aspectRatio ?? '' }),
            onPress: cycleAspect,
          },
          { icon: 'people-outline', label: t('collab.title'), onPress: menuAction(openCollabScreen) },
          {
            icon: 'help-circle-outline',
            label: t('tutorial.launch'),
            onPress: menuAction(() => useTutorial.getState().openMenu()),
          },
        ] as const)
      : []),
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onDismissed={onDismissed}
      accessibilityLabel={t('editorScreen.projectMenuTitle')}
    >
      <Text style={styles.menuTitle}>{t('editorScreen.projectMenuTitle')}</Text>
      {projectMenuItems.map((item) => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          style={styles.menuRow}
          accessibilityRole="button"
        >
          <Ionicons name={item.icon} size={20} color={palette.text} />
          <Text style={styles.menuLabel}>{item.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  menuTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  menuLabel: {
    color: palette.text,
    fontSize: 15,
  },
});
