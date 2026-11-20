import { useEffect, useState } from 'react';

import { logCaught } from '@/lib/logCaught';

/**
 * 📲 Átviteli tár: ha van hiányzó média, megnézzük, vár-e ránk letölthető
 * csomag ehhez a projekthez (B eszköz). A szerkesztő-képernyőből kiemelve.
 */
export function useTransferAvailability(id: string, missingCount: number) {
  // 📲 átviteli tár: van-e letölthető csomag ehhez a projekthez (B eszköz)
  const [transferSize, setTransferSize] = useState<number | null>(null);

  // 📲 átviteli tár: ha van hiányzó média, megnézzük, vár-e ránk csomag (B eszköz)
  useEffect(() => {
    let alive = true;
    if (missingCount === 0) {
      // a setState mikrotaszkban (react-hooks/set-state-in-effect)
      void Promise.resolve().then(() => {
        if (alive) {
          setTransferSize(null);
        }
      });
      return () => {
        alive = false;
      };
    }
    void import('@/lib/transferClient')
      .then((m) => m.fetchProjectTransfer(id))
      .then((meta) => {
        if (alive) {
          setTransferSize(meta && !meta.expired ? meta.sizeBytes : null);
        }
      })
      .catch((caught) => { logCaught('app/editor/[id].tsx:EditorScreen', caught); });
    return () => {
      alive = false;
    };
  }, [missingCount, id]);

  return [transferSize, setTransferSize] as const;
}
