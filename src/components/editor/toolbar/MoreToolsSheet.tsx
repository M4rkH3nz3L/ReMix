import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { palette } from '@/constants/editor';
import type { ToolId } from '@/lib/toolbarSpec';
import type { PanelId } from '@/store/editorStore';

import type { ToolDef } from './toolRegistry';
import { ToolCell } from './ToolbarToolRow';

/** ⋯ „Több" — ikonrács modális lapon (menü, nem élő szerkesztés → a scrim rendben) */
export function MoreToolsSheet({
  visible,
  onClose,
  onDismissed,
  moreTools,
  tools,
  rail,
  activePanel,
  togglePanel,
  setPendingMoreAction,
}: {
  visible: boolean;
  onClose: () => void;
  onDismissed: () => void;
  moreTools: ToolId[];
  tools: Record<ToolId, ToolDef>;
  rail: boolean;
  activePanel: PanelId;
  togglePanel: (panel: NonNullable<PanelId>) => void;
  setPendingMoreAction: (fn: (() => void) | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onDismissed={onDismissed}
      maxHeightFraction={0.6}
      accessibilityLabel={t('editor.toolbar.more')}
    >
      <Text style={styles.moreTitle}>{t('editor.toolbar.moreTitle')}</Text>
      <ScrollView contentContainerStyle={styles.moreGrid}>
        {moreTools.map((id) => (
          <View key={id} style={styles.moreCell}>
            <ToolCell
              def={tools[id]}
              rail={rail}
              activePanel={activePanel}
              togglePanel={togglePanel}
              setPendingMoreAction={setPendingMoreAction}
              onAfter={onClose}
            />
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  moreTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // ⋯ „Több" ikonrács: 4 oszlop
  moreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  moreCell: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 6,
  },
});
