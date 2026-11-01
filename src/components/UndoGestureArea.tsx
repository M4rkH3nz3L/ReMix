import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { useUndoRedoGestures } from '@/hooks/useUndoRedoGestures';
import { useEditorStore } from '@/store/editorStore';

/** 🖐️ A teljes képernyőn él a visszavonás és az újra; `enabled=false` alatt a gesztus nem csinál semmit. */
export function UndoGestureArea({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const run = (action: 'undo' | 'redo') => () => {
    if (enabled) {
      useEditorStore.getState()[action]();
    }
  };
  const gesture = useUndoRedoGestures(run('undo'), run('redo'));
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.area} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ area: { flex: 1 } });
