import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * A belépés / regisztráció kártyáinak közös stílusai (REFACTOR: a src/app/auth.tsx-ből) —
 * a kártya, a címek, a mezők, a hiba/súgó sorok és a váltó-linkek minden lapon azonosak.
 */
export const authStyles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 24,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 22,
    gap: 8,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.textDim,
    fontSize: 13,
    marginBottom: 8,
    lineHeight: 18,
  },
  fieldLabel: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  inputError: {
    borderColor: palette.danger,
  },
  /* az SMS-kód mező: nagy, ritkított számjegyek */
  otpInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: palette.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  error: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  submitWrap: {
    marginTop: 14,
  },
  busyBox: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 2,
  },
  switchText: {
    color: palette.textDim,
    fontSize: 13,
  },
  switchAction: {
    color: palette.accent,
    fontWeight: '700',
  },
});
