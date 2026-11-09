import { useEffect } from 'react';

import { useCollabLive } from '@/store/collabLiveStore';
import { useEditorStore } from '@/store/editorStore';

/**
 * 👥 Élő közös szerkesztés egy betöltött projektre (videó-szerkesztő ÉS Hang Stúdió — eddig csak a
 * videóból nyitott hang szerkesztése volt közös): megosztott projektnél realtime csatorna (presence +
 * parancs-szinkron + klip-zárak), a saját lejátszófej ~150 ms-onként a többieknek; kilépéskor le.
 * A `start()` maga ellenőrzi a tagságot — nem megosztott projektnél no-op.
 */
export function useLiveCollab(projectId: string | undefined, ownerId: string | null | undefined): void {
  const loadedId = useEditorStore((s) => s.project?.id);
  useEffect(() => {
    if (!ownerId || !projectId || loadedId !== projectId) {
      return;
    }
    void useCollabLive.getState().start(projectId);
    let last = 0;
    const unsubCursor = useEditorStore.subscribe((s, prev) => {
      if (s.playhead === prev.playhead) {
        return;
      }
      const now = Date.now();
      if (now - last < 150) {
        return;
      }
      last = now;
      useCollabLive.getState().sendCursor(s.playhead);
    });
    return () => {
      unsubCursor();
      useCollabLive.getState().stop();
    };
  }, [ownerId, projectId, loadedId]);
}
