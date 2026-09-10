import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 🔔 AI-tevékenység sáv.
 *
 * A panelen eddig csak a GOMB FELIRATA változott munka közben — egy statikus
 * szócsere, ami könnyen elsikkad, miközben a gép percekig dolgozik. A
 * felhasználó azt látta, hogy „nem történik semmi".
 *
 * Ez a sáv a panel tetején mindig látszik, amíg bármi fut: pörgő jelzés, a
 * lépés neve, és az ELTELT IDŐ — utóbbi a legfontosabb, mert ez különbözteti
 * meg a „dolgozik" és a „beragadt" állapotot. Hosszú futásnál kiírja, hogy a
 * lokális modell lassú lehet, hogy a várakozás ne tűnjön hibának.
 *
 * Befejezés után az eredmény (siker vagy hiba) itt marad, amíg el nem tünteted
 * — a korábbi hibaüzenet egy 1600 soros panel legalján jelent meg, ahol
 * gyakorlatilag sosem látszott.
 */

export interface AiResult {
  ok: boolean;
  text: string;
}

export function AiActivity({
  busyLabel,
  result,
  onDismiss,
}: {
  /** null = nincs futó munka */
  busyLabel: string | null;
  result: AiResult | null;
  onDismiss: () => void;
}) {
  /**
   * Az eltelt idő MÁSODPERC-KETYEGÉSBŐL jön, nem `Date.now()`-ból: a
   * `react-hooks/purity` tiltja az idő olvasását renderben, a
   * `set-state-in-effect` pedig a szinkron nullázást effektben. A számláló
   * azért indul mindig 0-ról, mert a hívó `key`-t ad a lépés nevéből — új
   * lépésnél a komponens újramountolódik, és az állapot magától nullázódik.
   */
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busyLabel) {
      return;
    }
    const timer = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [busyLabel]);

  if (busyLabel) {
    return (
      <View style={[styles.bar, styles.busy]}>
        <ActivityIndicator size="small" color={palette.accent} />
        <View style={styles.textCol}>
          <Text style={styles.label} numberOfLines={2}>
            {busyLabel}
          </Text>
          <Text style={styles.sub}>
            {t('editor.aiActivity.elapsedSeconds', { count: elapsed })}
            {elapsed >= 12 ? t('editor.aiActivity.slowLocalModel') : ''}
            {elapsed >= 45 ? t('editor.aiActivity.autoStopHint') : ''}
          </Text>
        </View>
      </View>
    );
  }

  if (!result) {
    return null;
  }

  return (
    <Pressable
      onPress={onDismiss}
      style={[styles.bar, result.ok ? styles.ok : styles.fail]}
    >
      <Ionicons
        name={result.ok ? 'checkmark-circle' : 'alert-circle'}
        size={18}
        color={result.ok ? '#8ef6c4' : palette.accent2}
      />
      <View style={styles.textCol}>
        <Text style={styles.label} numberOfLines={4}>
          {result.text}
        </Text>
        <Text style={styles.sub}>{t('editor.aiActivity.tapToHide')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  busy: {
    backgroundColor: `${palette.accent}1f`,
    borderColor: palette.accent,
  },
  ok: {
    backgroundColor: '#8ef6c41a',
    borderColor: '#8ef6c455',
  },
  fail: {
    backgroundColor: `${palette.accent2}1a`,
    borderColor: `${palette.accent2}66`,
  },
  textCol: {
    flex: 1,
  },
  label: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  sub: {
    color: palette.textDim,
    fontSize: 10,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
});
