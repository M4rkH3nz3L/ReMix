import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

export type ToolKey =
  | 'layers'
  | 'photo'
  | 'text'
  | 'shape'
  | 'pen'
  | 'lasso'
  | 'wand'
  | 'brush'
  | 'svg'
  | 'psd'
  | 'pdf'
  | 'style'
  | 'adjust'
  | 'develop'
  | 'fx'
  | 'pattern'
  | 'crop'
  | 'guides'
  | 'align'
  | 'boolean'
  | 'forward'
  | 'back'
  | 'rotate'
  | 'flipH'
  | 'flipV'
  | 'duplicate'
  | 'delete';

interface Tool {
  key: ToolKey;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}

/**
 * Az eszközök kategóriái (Hozzáadás / Rendezés / Stílus / Réteg).
 */
const TOOL_GROUPS: { labelKey: string; tools: Tool[] }[] = [
  {
    labelKey: 'studio.imageGroups.add',
    tools: [
      { key: 'photo', icon: 'image-outline', labelKey: 'studio.imageTools.photo' },
      { key: 'text', icon: 'text-outline', labelKey: 'studio.imageTools.text' },
      { key: 'shape', icon: 'shapes-outline', labelKey: 'studio.imageTools.shape' },
      { key: 'pen', icon: 'pencil-outline', labelKey: 'studio.imageTools.pen' },
      { key: 'lasso', icon: 'ellipse-outline', labelKey: 'studio.imageTools.lasso' },
      { key: 'wand', icon: 'color-wand-outline', labelKey: 'studio.imageTools.wand' },
      { key: 'brush', icon: 'brush-outline', labelKey: 'studio.imageTools.brush' },
      { key: 'svg', icon: 'download-outline', labelKey: 'studio.imageTools.svg' },
      { key: 'psd', icon: 'layers-outline', labelKey: 'studio.imageTools.psd' },
      { key: 'pdf', icon: 'document-outline', labelKey: 'studio.imageTools.pdf' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.arrange',
    tools: [
      { key: 'crop', icon: 'crop-outline', labelKey: 'studio.imageTools.crop' },
      { key: 'guides', icon: 'grid-outline', labelKey: 'studio.imageTools.guides' },
      { key: 'align', icon: 'magnet-outline', labelKey: 'studio.imageTools.align' },
      { key: 'boolean', icon: 'git-merge-outline', labelKey: 'studio.imageTools.boolean' },
      { key: 'rotate', icon: 'refresh-outline', labelKey: 'studio.imageTools.rotate' },
      { key: 'flipH', icon: 'swap-horizontal-outline', labelKey: 'studio.imageTools.flipH' },
      { key: 'flipV', icon: 'swap-vertical-outline', labelKey: 'studio.imageTools.flipV' },
      { key: 'forward', icon: 'chevron-up-outline', labelKey: 'studio.imageTools.forward' },
      { key: 'back', icon: 'chevron-down-outline', labelKey: 'studio.imageTools.back' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.style',
    tools: [
      { key: 'style', icon: 'options-outline', labelKey: 'studio.imageTools.style' },
      { key: 'fx', icon: 'sparkles-outline', labelKey: 'studio.imageTools.fx' },
      { key: 'pattern', icon: 'grid-outline', labelKey: 'studio.imageTools.pattern' },
      { key: 'adjust', icon: 'contrast-outline', labelKey: 'studio.imageTools.adjust' },
      { key: 'develop', icon: 'aperture-outline', labelKey: 'studio.imageTools.develop' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.layer',
    tools: [
      { key: 'layers', icon: 'layers-outline', labelKey: 'studio.imageTools.layers' },
      { key: 'duplicate', icon: 'copy-outline', labelKey: 'studio.imageTools.duplicate' },
      { key: 'delete', icon: 'trash-outline', labelKey: 'studio.imageTools.delete' },
    ],
  },
];

/** kijelölésnél a csoport-sorrend: Stílus · Rendezés · Réteg · Hozzáadás (a TOOL_GROUPS indexei) */
const SELECTED_ORDER = [2, 1, 3, 0] as const;

/**
 * 🧰 Szerszámsín — a csoportosított eszközök függőleges, görgethető sora a munkaterület
 * bal szélén, összecsukható. Az eszköz-koppintás és a láthatóság a bodyból jön propból.
 */
export function ImageStudioToolbar({
  onTool,
  toolDisabled,
  toolVisible,
  hasSelection = false,
  width,
  onCollapse,
}: {
  onTool: (key: ToolKey) => void;
  toolDisabled: (key: ToolKey) => boolean;
  /** a jelenlegi kijelöléssel nem használható eszköz nem jelenik meg */
  toolVisible: (key: ToolKey) => boolean;
  /** van kijelölt réteg → a réteg-műveletek (Stílus, Rendezés, Réteg) kerülnek ELŐRE */
  hasSelection?: boolean;
  width: number;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  // 🧭 kontextusfüggő sorrend (MOBILE-UI §6.4, T1/12): kijelöléskor nem a Hozzáadás áll elöl,
  // hanem amit a kijelölt réteggel tenni lehet; a `key` váltás a görgetést is az elejére állítja
  const ordered = hasSelection ? SELECTED_ORDER.map((i) => TOOL_GROUPS[i]) : TOOL_GROUPS;
  const groups = ordered
    .map((group) => ({ ...group, tools: group.tools.filter((tool) => toolVisible(tool.key)) }))
    .filter((group) => group.tools.length > 0);
  return (
    <View style={[styles.rail, { width }]}>
      <Pressable style={styles.collapse} onPress={onCollapse} accessibilityRole="button" accessibilityLabel={t('studio.image.toolsHide')}>
        <Ionicons name="chevron-back" size={18} color={palette.textDim} />
      </Pressable>
      <ScrollView key={hasSelection ? 'selected' : 'idle'} showsVerticalScrollIndicator={false} contentContainerStyle={styles.railContent}>
        {groups.map((group, gi) => (
          <View key={group.labelKey} style={styles.group}>
            <Text style={styles.groupLabel} numberOfLines={1}>
              {t(group.labelKey)}
            </Text>
            {group.tools.map((tool) => {
              const disabled = toolDisabled(tool.key);
              const danger = tool.key === 'delete';
              const color = disabled ? palette.border : danger ? palette.danger : palette.textDim;
              return (
                <Pressable
                  key={tool.key}
                  style={styles.tool}
                  onPress={() => onTool(tool.key)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={t(tool.labelKey)}
                >
                  <Ionicons name={tool.icon} size={22} color={color} />
                  <Text style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]} numberOfLines={1}>
                    {t(tool.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
            {gi < groups.length - 1 ? <View style={styles.groupDivider} /> : null}
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
  toolLabel: { fontSize: 9, fontWeight: '600' },
});
