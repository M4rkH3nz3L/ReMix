import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a Tár-panel és szekcióinak stílusai (REFACTOR: a LibraryPanel.tsx-ből) */
export const styles = StyleSheet.create({
  search: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  importBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
  },
  importBtnOff: {
    opacity: 0.45,
  },
  importBtnText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
  },
  secInput: {
    width: 60,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  errText: {
    color: palette.danger,
    fontSize: 11,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rowMeta: {
    color: palette.textDim,
    fontSize: 11,
    marginTop: 1,
  },
  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  refreshText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
});
