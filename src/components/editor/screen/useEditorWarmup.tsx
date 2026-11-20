import { setAudioModeAsync } from 'expo-audio';
import { useEffect } from 'react';

import { pruneProxyCache, pruneRenderCache } from '@/lib/cacheManager';
import { videoClipUris } from '@/lib/editorScreenOps';
import { logCaught } from '@/lib/logCaught';
import { prewarmProxies } from '@/lib/proxy';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🔥 A szerkesztő bemelegítése: hang-mód (némító kapcsolón is szóljon), vágási
 * proxyk előmelegítése és a cache-ek halasztott nyírása. A szerkesztő-képernyőből kiemelve.
 */
export function useEditorWarmup(projectId: string | undefined) {
  // némító kapcsolón is szóljon az előnézet
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch((caught) => { logCaught('app/editor/[id].tsx:EditorScreen', caught); });
  }, []);

  // vágási proxyk előmelegítése a projekt videóihoz (fire-and-forget)
  useEffect(() => {
    if (!projectId) {
      return;
    }
    const current = useEditorStore.getState().project;
    if (!current) {
      return;
    }
    prewarmProxies(videoClipUris(current));
    // 🧹 a proxy lemez-cache budget-nyírása (06 §2.9): a legrégebbi proxykat
    // kiüríti, ha a mappa túlnőtt — halasztva, hogy a megnyitást ne blokkolja.
    const prune = setTimeout(() => {
      try {
        pruneProxyCache();
        pruneRenderCache(); // 🎬 a renderelt kimenetek (renders/) LRU-nyírása (VIDEOT §8)
      } catch (caught) {
        logCaught('app/editor/[id].tsx:prune', caught);
        /* best-effort — a cache-nyírás sosem akaszthatja a szerkesztőt */
      }
    }, 3000);
    return () => clearTimeout(prune);
  }, [projectId]);
}
