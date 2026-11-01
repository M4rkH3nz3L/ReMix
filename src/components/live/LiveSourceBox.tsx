import { useMemo, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import { moveTransform, resizeTransform, scaleTransform } from '@/lib/liveTransform';
import type { LiveTransform } from '@/types/live';

const HANDLE = 28;

/**
 * 🖐️ Egy forrás a Stúdió vásznán: egy ujj mozgatja, csippentés méretezi, a kijelöltnek a jobb alsó
 * sarkán fogó van. Húzás közben a szülő a `onDraft` értéket rajzolja, a végén egy `onCommit` megy.
 */
export function LiveSourceBox({
  id,
  transform,
  canvas,
  selected,
  style,
  children,
  onPress,
  onSelect,
  onDraft,
  onCommit,
}: {
  id: string;
  transform: LiveTransform;
  canvas: { w: number; h: number };
  selected: boolean;
  style: ViewStyle | (ViewStyle | false)[];
  children: ReactNode;
  onPress: () => void;
  onSelect: () => void;
  onDraft: (t: LiveTransform) => void;
  onCommit: (t: LiveTransform) => void;
}) {
  const latest = useRef({ transform, canvas, onSelect, onDraft, onCommit });
  latest.current = { transform, canvas, onSelect, onDraft, onCommit };
  const start = useRef(transform);
  const last = useRef(transform);
  const gesture = useMemo(() => {
    const begin = () => {
      start.current = latest.current.transform;
      last.current = latest.current.transform;
      latest.current.onSelect();
    };
    const draft = (next: LiveTransform) => {
      last.current = next;
      latest.current.onDraft(next);
    };
    const finish = () => latest.current.onCommit(last.current);
    const move = Gesture.Pan()
      .withTestId(`live-source-move-${id}`)
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(4)
      .onStart(begin)
      .onUpdate((e) => draft(moveTransform(start.current, e.translationX / latest.current.canvas.w, e.translationY / latest.current.canvas.h)))
      .onEnd(finish);
    const pinch = Gesture.Pinch()
      .withTestId(`live-source-pinch-${id}`)
      .runOnJS(true)
      .onStart(begin)
      .onUpdate((e) => draft(scaleTransform(start.current, e.scale)))
      .onEnd(finish);
    return Gesture.Race(pinch, move);
  }, [id]);
  const handle = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(`live-source-resize-${id}`)
        .runOnJS(true)
        .minDistance(2)
        .onStart(() => {
          start.current = latest.current.transform;
          last.current = latest.current.transform;
        })
        .onUpdate((e) => {
          last.current = resizeTransform(start.current, e.translationX / latest.current.canvas.w, e.translationY / latest.current.canvas.h);
          latest.current.onDraft(last.current);
        })
        .onEnd(() => latest.current.onCommit(last.current)),
    [id]
  );
  return (
    <GestureDetector gesture={gesture}>
      <Pressable testID={`live-source-${id}`} onPress={onPress} style={style} accessibilityRole="button">
        {children}
        {selected ? (
          <GestureDetector gesture={handle}>
            <View style={styles.hit} collapsable={false}>
              <View style={styles.handle} />
            </View>
          </GestureDetector>
        ) : null}
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute', right: -8, bottom: -8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: HANDLE / 1.5, height: HANDLE / 1.5, borderRadius: 4, backgroundColor: palette.accent, borderWidth: 2, borderColor: '#fff' },
});
