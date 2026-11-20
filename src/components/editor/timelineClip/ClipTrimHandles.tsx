import { StyleSheet, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';

/** ✂️ A kijelölt klip két szélső trim-fogantyúja (a gesztusok a useTimelineClipGestures-ből). */
export function ClipTrimHandles({ trimLeftPan, trimRightPan }: { trimLeftPan: GestureType; trimRightPan: GestureType }) {
  return (
    <>
      <GestureDetector gesture={trimLeftPan}>
        <View style={[styles.handle, styles.handleLeft]}>
          <View style={styles.handleBar} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={trimRightPan}>
        <View style={[styles.handle, styles.handleRight]}>
          <View style={styles.handleBar} />
        </View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  handle: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.text,
  },
  handleLeft: {
    left: -10,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  handleRight: {
    right: -10,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  handleBar: {
    width: 2,
    height: '40%',
    borderRadius: 1,
    backgroundColor: palette.bg,
  },
});
