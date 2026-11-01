import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import { gestures, haptics } from '@/design';
import { movePanel, panelIndexAfterDrag, type LivePanelId } from '@/lib/livePanels';

/** 🧩 Panelek ujjal rendezve: a fogót megnyomva és húzva a panel új helyre kerül. */
export function LivePanelList({
  order,
  panels,
  onOrder,
}: {
  order: LivePanelId[];
  panels: Partial<Record<LivePanelId, ReactNode>>;
  onOrder: (order: LivePanelId[]) => void;
}) {
  const { t } = useTranslation();
  const heights = useRef<Partial<Record<LivePanelId, number>>>({});
  const [drag, setDrag] = useState<{ id: LivePanelId; dy: number } | null>(null);
  const shown = order.filter((id) => panels[id] != null);
  const handle = (id: LivePanelId) =>
    Gesture.Pan()
      .withTestId(`live-panel-drag-${id}`)
      .runOnJS(true)
      .activateAfterLongPress(gestures.longPress.drag)
      .onStart(() => {
        haptics.impact();
        setDrag({ id, dy: 0 });
      })
      .onUpdate((e) => setDrag({ id, dy: e.translationY }))
      .onEnd((e) => {
        setDrag(null);
        const from = shown.indexOf(id);
        const to = panelIndexAfterDrag(shown.map((p) => heights.current[p] ?? 0), from, e.translationY);
        if (to !== from) {
          // a rejtett panelek a helyükön maradnak: a teljes sorrendben a célpanel helyére kerül
          onOrder(movePanel(order, order.indexOf(id), order.indexOf(shown[to])));
        }
      })
      .onFinalize((_e, success) => {
        if (!success) {
          setDrag(null);
        }
      });
  return (
    <View style={styles.list}>
      {shown.map((id) => (
        <View
          key={id}
          testID={`live-panel-${id}`}
          onLayout={(e) => {
            heights.current[id] = e.nativeEvent.layout.height;
          }}
          style={[styles.panel, drag?.id === id ? [styles.lifted, { transform: [{ translateY: drag.dy }] }] : null]}
        >
          <GestureDetector gesture={handle(id)}>
            <View style={styles.handle} collapsable={false} accessibilityLabel={t('live.studio.movePanel')} accessibilityRole="adjustable">
              <Ionicons name="reorder-three" size={22} color={palette.textDim} />
            </View>
          </GestureDetector>
          {panels[id]}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  panel: { gap: 12 },
  lifted: { zIndex: 10, opacity: 0.9 },
  handle: { position: 'absolute', top: -12, left: '50%', marginLeft: -22, zIndex: 5, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
