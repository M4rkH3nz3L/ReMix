import { type ReactNode, useEffect, useRef } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import type { Rect, TutorialTargetId } from '@/lib/tutorial';
import { useTutorial } from '@/store/tutorialStore';

/**
 * 🎯 Egy kiemelhető UI-elem burka a tutorialhoz. A gyerekét egy mérhető View-ba
 * teszi (`collapsable={false}` az Android-mérhetőségért), és regisztrál egy
 * „mérd meg magad" függvényt a store-ba a `id` kulcson. A TutorialOverlay ezt
 * hívja meg, hogy a spotlight a VALÓS elem képernyő-koordinátáira üljön.
 *
 * Kevéssé invazív: nem kell a meglévő komponenseket módosítani, csak köréjük
 * tenni ott, ahol egy lecke lépése kiemeli őket.
 */
export function TutorialTarget({
  id,
  children,
  style,
}: {
  id: TutorialTargetId;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<View>(null);
  const register = useTutorial((s) => s.registerTarget);
  const unregister = useTutorial((s) => s.unregisterTarget);

  useEffect(() => {
    register(
      id,
      () =>
        new Promise<Rect | null>((resolve) => {
          const node = ref.current;
          if (!node) {
            resolve(null);
            return;
          }
          node.measureInWindow((x, y, width, height) => {
            if (!width && !height) {
              resolve(null);
            } else {
              resolve({ x, y, width, height });
            }
          });
        })
    );
    return () => unregister(id);
  }, [id, register, unregister]);

  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}
