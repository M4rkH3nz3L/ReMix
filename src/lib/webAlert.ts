import { Alert, Platform } from 'react-native';
import { create } from 'zustand';

/**
 * 🌐 Web-Alert — a react-native-web `Alert` egy ÜRES no-op (`class Alert { static
 * alert() {} }`), ezért weben MINDEN `Alert.alert` / `Alert.prompt` hívás (a
 * teljes appban ~340) csendben elnyelődik: a megerősítők, akció-lapok és
 * hibaüzenetek gombjai „nem csinálnak semmit". Itt egy VALÓDI, gombos modált
 * kötünk az `Alert.alert`/`Alert.prompt` mögé, így a meglévő hívások EGYETLEN
 * sor módosítása nélkül működnek weben. A modált a `<WebAlertHost/>` rajzolja
 * (a `_layout`-ban mountolva). Natíven mindez no-op → marad a rendszer-Alert.
 */

export type WebAlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type WebAlertKind = 'alert' | 'prompt';

type WebAlertState = {
  visible: boolean;
  kind: WebAlertKind;
  title?: string;
  message?: string;
  buttons: WebAlertButton[];
  /** a prompt beviteli mező aktuális értéke (a store-ban → nincs effekt-alapú seed) */
  input: string;
  show: (opts: {
    kind: WebAlertKind;
    title?: string;
    message?: string;
    buttons?: WebAlertButton[];
    defaultValue?: string;
  }) => void;
  setInput: (value: string) => void;
  dismiss: () => void;
};

export const useWebAlert = create<WebAlertState>((set) => ({
  visible: false,
  kind: 'alert',
  title: undefined,
  message: undefined,
  buttons: [],
  input: '',
  show: ({ kind, title, message, buttons, defaultValue }) =>
    set({
      visible: true,
      kind,
      title,
      message,
      // gombok nélkül a rendszer-Alert egy „OK" gombot ad — ezt utánozzuk
      buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }],
      input: defaultValue ?? '',
    }),
  setInput: (value) => set({ input: value }),
  dismiss: () => set({ visible: false }),
}));

let installed = false;

/**
 * Weben felülírja az `Alert.alert`/`Alert.prompt`-ot a gombos modállal.
 * Idempotens; natíven no-op. Cast a react-native-web üres Alert-osztályára,
 * hogy a statikus metódusokat felülírhassuk (nincs `@ts-expect-error`-függés).
 */
export function installWebAlert(): void {
  if (Platform.OS !== 'web' || installed) {
    return;
  }
  installed = true;

  const AlertShim = Alert as unknown as {
    alert: (title?: string, message?: string, buttons?: WebAlertButton[]) => void;
    prompt: (
      title?: string,
      message?: string,
      callbackOrButtons?: ((value: string) => void) | WebAlertButton[],
      type?: unknown,
      defaultValue?: string
    ) => void;
  };

  // Alert.alert(title, message?, buttons?, options?) — az options-t nem használjuk
  AlertShim.alert = (title, message, buttons) => {
    useWebAlert.getState().show({ kind: 'alert', title, message, buttons });
  };

  // Alert.prompt(title, message?, callbackOrButtons?, type?, defaultValue?)
  // A hívók `typeof Alert.prompt === 'function'`-nal gate-elnek → ettől igaz lesz.
  AlertShim.prompt = (title, message, callbackOrButtons, _type, defaultValue) => {
    const cb = typeof callbackOrButtons === 'function' ? callbackOrButtons : undefined;
    const buttons: WebAlertButton[] = Array.isArray(callbackOrButtons)
      ? callbackOrButtons
      : [
          { text: 'Mégse', style: 'cancel' },
          { text: 'OK', onPress: (value) => cb?.(value ?? '') },
        ];
    useWebAlert.getState().show({ kind: 'prompt', title, message, buttons, defaultValue });
  };
}

// import-időben azonnal beköti (a `_layout` is meghívja — kettős biztosíték)
installWebAlert();
