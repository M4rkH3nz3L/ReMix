import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a hang-panel szekcióinak közös stílusai (REFACTOR: az AudioPanel.tsx-ből) */
export const styles = StyleSheet.create({
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ttsInput: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  ttsBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  trackList: {
    gap: 6,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  trackIcon: {
    fontSize: 14,
  },
  trackName: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  trackDuration: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  matchToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: 6,
  },
  matchToggleOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  matchToggleText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  matchToggleTextOn: {
    color: palette.accent,
  },
  matchBadge: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
