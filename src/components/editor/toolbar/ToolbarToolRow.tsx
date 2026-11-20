import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { ToolButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { ToolId } from '@/lib/toolbarSpec';
import type { PanelId } from '@/store/editorStore';

import type { ToolDef } from './toolRegistry';

/** egy eszköz-cella: a sávban, a railen vagy (`onAfter`-rel) a „Több" rácsban */
export function ToolCell({
  def,
  rail,
  activePanel,
  togglePanel,
  setPendingMoreAction,
  onAfter,
}: {
  def: ToolDef;
  rail: boolean;
  activePanel: PanelId;
  togglePanel: (panel: NonNullable<PanelId>) => void;
  setPendingMoreAction: (fn: (() => void) | null) => void;
  onAfter?: () => void;
}) {
  // a vízszintes sávban (nem a railen / nem a „Több" rácsban) egyenlő cellák
  const fillCell = !rail && !onAfter;
  const button = (
    <ToolButton
      fill={fillCell}
      icon={def.icon}
      label={def.label}
      active={def.panel ? activePanel === def.panel : def.active}
      onPress={() => {
        onAfter?.();
        if (def.panel) {
          togglePanel(def.panel);
        } else if (onAfter) {
          setPendingMoreAction(def.onPress ?? null);
        } else {
          def.onPress?.();
        }
      }}
    />
  );
  return def.tutorialId && !onAfter ? (
    <TutorialTarget id={def.tutorialId} style={fillCell ? styles.cell : undefined}>
      {button}
    </TutorialTarget>
  ) : (
    <View style={fillCell ? styles.cell : undefined}>
      {button}
    </View>
  );
}

/**
 * Az eszközsor: „Kész" (króm) · elsődleges eszközök · „Több" · elválasztó + „Törlés"
 * (króm). A sor NEM remountol a készlet-váltáskor, csak átúszik (`toolRowStyle`).
 */
export function ToolbarToolRow({
  rail,
  toolRowStyle,
  hasSelection,
  rowTools,
  hasMoreTools,
  tools,
  activePanel,
  togglePanel,
  setPendingMoreAction,
  multi,
  batchCount,
  onDone,
  onMore,
  onRemove,
}: {
  rail: boolean;
  toolRowStyle: StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>;
  hasSelection: boolean;
  rowTools: ToolId[];
  hasMoreTools: boolean;
  tools: Record<ToolId, ToolDef>;
  activePanel: PanelId;
  togglePanel: (panel: NonNullable<PanelId>) => void;
  setPendingMoreAction: (fn: (() => void) | null) => void;
  multi: boolean;
  batchCount: number;
  onDone: () => void;
  onMore: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Animated.View style={[rail ? styles.toolColumn : styles.toolRow, toolRowStyle]}>
      {hasSelection ? (
        <View style={rail ? undefined : styles.cell}>
          <ToolButton
            fill={!rail}
            icon="checkmark-circle-outline"
            label={t('common.done')}
            onPress={onDone}
          />
        </View>
      ) : null}
      {rowTools.map((id) => (
        <ToolCell
          key={id}
          def={tools[id]}
          rail={rail}
          activePanel={activePanel}
          togglePanel={togglePanel}
          setPendingMoreAction={setPendingMoreAction}
        />
      ))}
      {hasMoreTools ? (
        <View style={rail ? undefined : styles.cell}>
          <ToolButton
            fill={!rail}
            icon="ellipsis-horizontal-circle-outline"
            label={t('editor.toolbar.more')}
            onPress={onMore}
          />
        </View>
      ) : null}
      {hasSelection ? (
        <>
          {/* elválasztó: a destruktív Törlés elkülönül a többi eszköztől */}
          <View style={rail ? styles.toolSepH : styles.toolSep} />
          <View style={rail ? undefined : styles.cell}>
            <ToolButton
              fill={!rail}
              icon="trash-outline"
              label={multi ? t('editor.toolbar.deleteCount', { count: batchCount }) : t('common.delete')}
              danger
              onPress={onRemove}
            />
          </View>
        </>
      ) : null}
      {/* Export SZÁNDÉKOSAN nincs itt: a fejléc jobb felső Export gombja az
          egyetlen belépő (a duplikáció megszüntetve — lásd editor/[id].tsx). */}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toolColumn: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  toolSepH: {
    height: 1,
    width: 28,
    alignSelf: 'center',
    marginVertical: 8,
    backgroundColor: palette.border,
  },
  // a vízszintes sáv: egyenlő cellák a teljes szélességen
  toolRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  cell: { flex: 1, minWidth: 0 },
  // függőleges elválasztó a destruktív művelet (Törlés) elkülönítéséhez
  toolSep: {
    width: 1,
    height: 28,
    alignSelf: 'center',
    marginHorizontal: 8,
    backgroundColor: palette.border,
  },
});
