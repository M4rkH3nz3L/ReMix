import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { useWebAlert, type WebAlertButton } from '@/lib/webAlert';

/**
 * 🌐 A web-Alert modál-hostja. A react-native-web `Alert` no-op-ja helyett ez
 * rajzolja a title/message + gombos kártyát (prompt esetén egy beviteli mezővel).
 * A gombok `onPress`-e a MEGLÉVŐ `Alert.alert(...)` hívásokból jön → weben is
 * lefutnak. Csak weben renderel; natíven a rendszer-Alert megy, ez `null`.
 */
export function WebAlertHost() {
  const visible = useWebAlert((s) => s.visible);
  const kind = useWebAlert((s) => s.kind);
  const title = useWebAlert((s) => s.title);
  const message = useWebAlert((s) => s.message);
  const buttons = useWebAlert((s) => s.buttons);
  const input = useWebAlert((s) => s.input);
  const setInput = useWebAlert((s) => s.setInput);
  const dismiss = useWebAlert((s) => s.dismiss);

  if (Platform.OS !== 'web' || !visible) {
    return null;
  }

  const pick = (b: WebAlertButton) => {
    dismiss();
    b.onPress?.(kind === 'prompt' ? input : undefined);
  };

  // háttérre kattintás = a „cancel" gomb (ha van), különben csak bezár
  const onBackdrop = () => {
    const c = buttons.find((b) => b.style === 'cancel');
    dismiss();
    c?.onPress?.(kind === 'prompt' ? input : undefined);
  };

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onBackdrop} />
      <View style={styles.card}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {kind === 'prompt' ? (
          <TextInput
            value={input}
            onChangeText={setInput}
            autoFocus
            style={styles.input}
            placeholderTextColor={palette.textDim}
          />
        ) : null}
        <View style={styles.buttons}>
          {buttons.map((b, i) => (
            <Pressable
              key={`${b.text ?? 'ok'}-${i}`}
              onPress={() => pick(b)}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel={b.text ?? 'OK'}
            >
              <Text
                style={[
                  styles.buttonText,
                  b.style === 'destructive' ? styles.destructive : null,
                  b.style === 'cancel' ? styles.cancel : null,
                ]}
              >
                {b.text ?? 'OK'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 24,
    // az Alert a legfelső réteg — a paywall/progress/tutorial fölé is
    zIndex: 10000,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    gap: 10,
  },
  title: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '800',
  },
  message: {
    color: palette.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    backgroundColor: palette.surface,
    fontSize: 15,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: palette.surface,
  },
  buttonText: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  destructive: {
    color: palette.danger,
  },
  cancel: {
    color: palette.textDim,
  },
});
