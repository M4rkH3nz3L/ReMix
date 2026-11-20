import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a Forma-panel szekcióinak közös stílusai */
export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  stopBlock: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    gap: 4,
  },
  stopLabel: {
    color: palette.text,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
