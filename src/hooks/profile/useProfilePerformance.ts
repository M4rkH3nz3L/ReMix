import { useCallback, useState } from 'react';

import { type CacheReport, cacheReport, clearCaches } from '@/lib/cacheManager';
import { useEditorStore } from '@/store/editorStore';

/** 🎯 teljesítmény / gyorsítótár (REFACTOR: a useProfile-ból) */
export function useProfilePerformance() {
  const proxyEnabled = useEditorStore((s) => s.proxyEnabled);
  const proxyQuality = useEditorStore((s) => s.proxyQuality);
  const setProxyEnabled = useEditorStore((s) => s.setProxyEnabled);
  const setProxyQuality = useEditorStore((s) => s.setProxyQuality);
  const [cacheInfo, setCacheInfo] = useState<CacheReport>(() => cacheReport());
  const onClearCache = useCallback(() => {
    clearCaches();
    setCacheInfo(cacheReport());
  }, []);
  return { proxyEnabled, proxyQuality, setProxyEnabled, setProxyQuality, cacheInfo, onClearCache };
}
