import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a felirat-panel szekcióinak közös stílusai (REFACTOR: a CaptionsPanel.tsx-ből) */
export const styles = StyleSheet.create({
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    minHeight: 80,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
});
