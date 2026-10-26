import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * ⌨️ Látszik-e a szoftveres billentyűzet. iOS-en a `Will`-eseményekre figyel, így a
 * layout a billentyűzet animációjával EGYÜTT vált (nem utána ugrik); Androidon csak
 * `Did`-események vannak.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
