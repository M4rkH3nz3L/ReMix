import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a Precíziós panel szekcióinak közös stílusai */
export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  range: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
