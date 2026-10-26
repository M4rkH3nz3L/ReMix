import { useEffect, useRef } from 'react';

import { pushBack } from '@/lib/backStack';

/**
 * ↩️ Egy nyitott felület (lap, Focus, workspace, precíziós mód) bejegyzése a
 * vissza-verembe (`@/lib/backStack`). `null` = nincs nyitva → nincs bejegyzés.
 *
 * A kezelő refből olvasott, így a bejegyzés csak nyitás/zárás-kor változik, a
 * render-enként új closure nem okoz újra-bejegyzést (és a verem-sorrend megmarad).
 */
export function useBackLayer(onBack: (() => void) | null): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  const active = onBack !== null;
  useEffect(() => {
    if (!active) {
      return;
    }
    return pushBack(() => ref.current?.());
  }, [active]);
}
