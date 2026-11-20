import { useEffect, useRef } from 'react';

import { isDeepLinkPanel } from '@/lib/editorScreenOps';
import { useEditorStore, type PanelId } from '@/store/editorStore';

/**
 * 🤖 Mély-link a szerkesztő egy paneljéhez (pl. a kezdőképernyő „AI eszközök"
 * füléből: ?panel=assistant) — a projekt betöltése után EGYSZER nyitjuk meg.
 * A szerkesztő-képernyőből kiemelve.
 */
export function usePanelDeepLink(panel: string | undefined, projectId: string | undefined, id: string) {
  const panelOpenedRef = useRef(false);
  useEffect(() => {
    if (panelOpenedRef.current || !panel || projectId !== id) {
      return;
    }
    // csak a kijelölés nélkül is nyitható (standalone) paneleket engedjük paramból
    if (isDeepLinkPanel(panel)) {
      useEditorStore.getState().setPanel(panel as PanelId);
      panelOpenedRef.current = true;
    }
  }, [panel, projectId, id]);
}
