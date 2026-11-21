import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a szöveg-panel szekcióinak közös stílusai (REFACTOR: a TextPanel.tsx-ből) */
export const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    padding: 3,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: palette.accent,
  },
  tabText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#fff',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  fontChip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: palette.surfaceHigh,
    minWidth: 64,
    alignItems: 'center',
  },
  fontChipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  fontChipText: {
    color: palette.textDim,
    fontSize: 16,
  },
  fontChipTextActive: {
    color: '#fff',
  },
});
