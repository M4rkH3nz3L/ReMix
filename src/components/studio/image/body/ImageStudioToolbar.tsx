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
  | 'style'
  | 'adjust'
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
 * 📱 Telefon-optimalizált, CSOPORTOSÍTOTT eszköztár (vízszintesen görgethető) —
 * a lapos 9-elemű sor helyett kategóriák (Hozzáadás / Rendezés / Stílus / Réteg),
 * így a teljes eszközkészlet kézre esik a kis kijelzőn is.
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

/**
 * 📱 Eszköztár — a csoportosított, vízszintesen görgethető eszköz-sor. VISELKEDÉS-
 * MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: azonos `TOOL_GROUPS`, render-sorrend
 * és UI; az eszköz-koppintás (`onTool`) és a letiltás-logika (`toolDisabled`) a
 * bodyból érkezik PROPBÓL.
 */
export function ImageStudioToolbar({
  onTool,
  toolDisabled,
}: {
  onTool: (key: ToolKey) => void;
  toolDisabled: (key: ToolKey) => boolean;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.toolBar}
      contentContainerStyle={styles.toolBarContent}
    >
      {TOOL_GROUPS.map((group, gi) => (
        <View key={group.labelKey} style={styles.toolGroupRow}>
          <View style={styles.toolGroup}>
            <Text style={styles.groupLabel}>{t(group.labelKey)}</Text>
            <View style={styles.groupTools}>
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
                    <Text
                      style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]}
                      numberOfLines={1}
                    >
                      {t(tool.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {gi < TOOL_GROUPS.length - 1 ? <View style={styles.groupDivider} /> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  toolBar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    flexGrow: 0,
  },
  toolBarContent: {
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 8,
  },
  toolGroupRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  toolGroup: {
    paddingHorizontal: 6,
  },
  groupLabel: {
    color: palette.textDim,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: 6,
    marginBottom: 2,
    opacity: 0.7,
  },
  groupTools: {
    flexDirection: 'row',
  },
  groupDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: 4,
    marginHorizontal: 2,
  },
  tool: { width: 60, alignItems: 'center', gap: 4, paddingVertical: 2 },
  toolLabel: { fontSize: 10, fontWeight: '600' },
});
