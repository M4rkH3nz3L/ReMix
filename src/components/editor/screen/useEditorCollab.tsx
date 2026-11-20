import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { useLiveCollab } from '@/hooks/useLiveCollab';
import { openProjectConversation } from '@/lib/chat';
import { currentUserId, ensureShared, myMembership, type CollabRole } from '@/lib/collab';
import { logCaught } from '@/lib/logCaught';
import { useChat } from '@/store/chatStore';
import { useEditorStore } from '@/store/editorStore';

/**
 * 👥 Megosztott projekt: a tagságom (szerep), az élő collab-csatorna és a
 * projekt-szoba megnyitása. A szerkesztő-képernyőből kiemelve.
 */
export function useEditorCollab(id: string, projectId: string | undefined) {
  const [collab, setCollab] = useState<{ ownerId: string; role: CollabRole } | null>(null);

  // 👥 megosztott projekt-e + a szerepem (a fejléc-jelzéshez / Studio-linkhez)
  useEffect(() => {
    if (projectId === id) {
      myMembership(id).then(setCollab).catch((caught) => { logCaught('app/editor/[id].tsx:EditorScreen', caught); });
    }
  }, [projectId, id]);

  // 👥 ÉLŐ collab: megosztott projektnél realtime csatorna (presence + parancs-szinkron) — közös hook
  useLiveCollab(id, collab?.ownerId);

  // 💬 projekt-szoba: MINDIG elérhető — a „nincs kollaboráció" csak annyit jelent,
  // hogy még nincs behívva senki. Tulajként az első megnyitás hozza létre a szobát
  // (tag-sor + felhő-terv), aztán a beszélgetés nyílik a chat-képernyőn.
  const openCollabChat = () => {
    const run = async () => {
      let owner = collab?.ownerId;
      if (!owner) {
        const me = currentUserId();
        const proj = useEditorStore.getState().project;
        if (!me || !proj || proj.id !== id) {
          return;
        }
        await ensureShared(proj);
        setCollab({ ownerId: me, role: 'owner' });
        owner = me;
      }
      const convId = await openProjectConversation(owner, id);
      void useChat.getState().loadInbox(); // a fejléc-cím/kind azonnal helyes legyen
      router.push(`/chat/${convId}`);
    };
    void run().catch((caught) => { logCaught('app/editor/[id].tsx:openCollabChat', caught); });
  };

  return { collab, openCollabChat };
}
