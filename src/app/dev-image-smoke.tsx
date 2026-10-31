import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * 🧪 KÉP-STÚDIÓ ESZKÖZ-FÜSTTESZT — csak dev-buildben, deep linkkel:
 * `remix://dev-image-smoke?phase=all`. Ember nélkül futtatja a valódi natív utakat a
 * telefonon (Skia, kép-mentés, a valódi vászon + captureRef, autosave), az eredményt a
 * Metro-konzolra írja `[IMG-SMOKE]` előtaggal. Ideiglenes projektet használ, és törli.
 */
const TAG = '[IMG-SMOKE]';
const SMOKE_KILL_ID = 'smoke_image_kill';

export default function ImageSmokeScreen() {
  const { phase = 'all' } = useLocalSearchParams<{ phase?: string }>();
  if (!__DEV__) {
    return null;
  }
  return <Smoke phase={String(phase)} />;
}

function Smoke({ phase }: { phase: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [harness, setHarness] = useState<React.ReactNode>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (started.current === phase) {
      return;
    }
    started.current = phase;
    const log = (ok: boolean | null, name: string, detail = '') => {
      const line = `${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`;
      console.log(`${TAG} ${line}`);
      setLines((l) => [...l, line]);
    };
    // a __DEV__-ág miatt a smoke-kód a release bundle-ből kimarad (mint a renderSmoke)
    if (!__DEV__) {
      return;
    }
    void (async () => {
      const m = await import('@/lib/imageSmoke');
      await m.runImageSmoke(phase, log, setHarness, PixelRatio.get(), SMOKE_KILL_ID);
      console.log(`${TAG} DONE phase=${phase}`);
      if (phase === 'ui') {
        const id = await m.firstImageProjectId();
        if (id) {
          router.replace(`/studio/image/${id}`);
        }
      }
    })().catch((e) => log(false, 'smoke elhasalt', String((e as Error)?.stack ?? e).slice(0, 400)));
  }, [phase]);

  return (
    <View style={styles.root}>
      <View style={styles.harness}>{harness}</View>
      <ScrollView style={styles.log}>
        {lines.map((l, i) => (
          <Text key={i} style={[styles.line, l.startsWith('FAIL') && styles.fail]}>
            {l}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#20242e', paddingTop: 60 },
  harness: { height: 320, alignItems: 'center', justifyContent: 'center' },
  log: { flex: 1, padding: 12 },
  line: { color: '#b7f7c4', fontSize: 12, marginBottom: 4 },
  fail: { color: '#ff8a8a', fontWeight: '700' },
});
