import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { RAIL_GROUPS, type RailTool, TOOL_ICONS, toolLabelKey } from '@/lib/imageMenu';

/**
 * 🧰 Szerszámsín — a csoportosított eszközök függőleges, görgethető sora a munkaterület
 * bal szélén, összecsukható. Csak szerszámok: a kijelölt elem műveletei az alsó sávban vannak.
 */
export function ImageStudioToolbar({
  onTool,
  width,
  onCollapse,
}: {
  onTool: (key: RailTool) => void;
  width: number;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.rail, { width }]}>
      <Pressable style={styles.collapse} onPress={onCollapse} accessibilityRole="button" accessibilityLabel={t('studio.image.toolsHide')}>
        <Ionicons name="chevron-back" size={18} color={palette.textDim} />
      </Pressable>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.railContent}>
        {RAIL_GROUPS.map((group, gi) => (
          <View key={group.labelKey} style={styles.group}>
            <Text style={styles.groupLabel} numberOfLines={1}>
              {t(group.labelKey)}
            </Text>
            {group.tools.map((key) => (
              <Pressable key={key} style={styles.tool} onPress={() => onTool(key)} accessibilityRole="button" accessibilityLabel={t(toolLabelKey(key))}>
                <Ionicons name={TOOL_ICONS[key] as keyof typeof Ionicons.glyphMap} size={22} color={palette.textDim} />
                <Text style={styles.toolLabel} numberOfLines={2}>
                  {t(toolLabelKey(key))}
                </Text>
              </Pressable>
            ))}
            {gi < RAIL_GROUPS.length - 1 ? <View style={styles.groupDivider} /> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: palette.border,
  },
  collapse: { height: 44, alignItems: 'center', justifyContent: 'center' },
  railContent: { paddingBottom: 12 },
  group: { alignItems: 'stretch' },
  groupLabel: {
    color: palette.textDim,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'center',
    opacity: 0.7,
    paddingHorizontal: 2,
    marginTop: 4,
    marginBottom: 2,
  },
  groupDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: 10, marginTop: 6 },
  tool: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 2 },
  toolLabel: { color: palette.textDim, fontSize: 9, fontWeight: '600', textAlign: 'center' },
});
