import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { palette, radius } from '@/design';
import { lessonsByLevel, localize, type TutorialLevel } from '@/lib/tutorial';
import { useTutorial } from '@/store/tutorialStore';

const LEVEL_KEY: Record<TutorialLevel, string> = {
  beginner: 'tutorial.levelBeginner',
  advanced: 'tutorial.levelAdvanced',
  pro: 'tutorial.levelPro',
};

/**
 * 🎓 Lecke-választó (alsó lap). A „?" nyitja; szint szerint csoportosít, a
 * befejezett leckén ✓, tap → a felület-vezető indul (TutorialOverlay).
 */
export function TutorialMenu() {
  const visible = useTutorial((s) => s.menuVisible);
  const close = useTutorial((s) => s.closeMenu);
  const start = useTutorial((s) => s.start);
  const completed = useTutorial((s) => s.completed);
  const { t, i18n } = useTranslation();
  const { height } = useWindowDimensions();

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      maxHeightFraction={0.82}
      accessibilityLabel={t('tutorial.menuTitle')}
    >
      <View style={styles.body}>
        <Text style={styles.title}>{t('tutorial.menuTitle')}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: height * 0.62 }}>
          {lessonsByLevel().map((group) => (
            <View key={group.level} style={styles.group}>
              <Text style={styles.groupTitle}>{t(LEVEL_KEY[group.level])}</Text>
              {group.lessons.map((l) => {
                const done = completed.includes(l.id);
                return (
                  <Pressable
                    key={l.id}
                    style={styles.row}
                    onPress={() => start(l.id)}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={done ? 'checkmark-circle' : 'play-circle-outline'}
                      size={22}
                      color={done ? palette.ok : palette.accent}
                    />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {localize(l.title, i18n.language)}
                    </Text>
                    {l.pro ? <Text style={styles.proTag}>PRO</Text> : null}
                    <Ionicons name="chevron-forward" size={16} color={palette.textDim} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, gap: 4, paddingBottom: 4 },
  title: { color: palette.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  group: { marginBottom: 10 },
  groupTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowText: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '600' },
  proTag: {
    color: palette.accent2,
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderColor: palette.accent2,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
});
