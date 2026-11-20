import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';

import type { AiResult } from '@/components/editor/AiActivity';
import { haptics } from '@/design';
import { askAssistant } from '@/lib/ai';
import { buildAiContext } from '@/lib/aiCommands';
import type { AiCommand } from '@/lib/aiCommands';
import type { AiPlanItem } from '@/lib/aiPlan';
import { aiReplyCommands } from '@/lib/assistantPanelOps';
import { toAppError } from '@/lib/errors';
import { isSilenceCutIntent } from '@/lib/localIntent';
import { logCaught } from '@/lib/logCaught';
import { getTimelineTranscript } from '@/lib/transcripts';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { Project } from '@/types/project';

/**
 * ↩️ A projekt visszaállítása egy korábbi pillanatképre: undo-val, amíg a history-ban
 * megvan (a referencia pontosan visszaáll); ha a pillanatkép már kiesett a history-ból
 * (teli, 50 lépés), egyetlen `RESTORE_SNAPSHOT` parancs állítja vissza (B8).
 */
export function revertProjectTo(base: Project | null): void {
  if (!base) return;
  let guard = 0;
  while (
    useEditorStore.getState().project !== base &&
    useEditorStore.getState().past.includes(base) &&
    guard++ < 200
  ) {
    useEditorStore.getState().undo();
  }
  const cur = useEditorStore.getState().project;
  if (cur && cur !== base && cur.id === base.id) {
    useEditorStore.getState().dispatch({ type: 'RESTORE_SNAPSHOT', project: base }, 'user');
  }
}

/**
 * AI-asszisztens (full-plan F3): utasítás → a worker Claude-dal parancslistát
 * készít → jóváhagyás után a Command Bus-on fut le (actor: 'ai'), teljes
 * undo-val. Az AI sosem írja közvetlenül a projektet.
 */
export function useAiReply({
  t,
  cutDeadAir,
  setApplied,
  setAiResult,
}: {
  t: TFunction;
  cutDeadAir: () => Promise<void>;
  setApplied: (message: string | null) => void;
  setAiResult: (result: AiResult | null) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [reply, setReply] = useState<{ message: string; commands: AiCommand[] } | null>(
    null
  );
  // 🤖 before/after preview: az AI-köteg ideiglenesen alkalmazva, megtekintésre
  const [previewing, setPreviewing] = useState(false);
  const [previewCount, setPreviewCount] = useState(0);
  // az undo-verem hossza a preview ELŐTT — a revert EDDIG göngyölít vissza (a köteg
  // + a preview alatt esetleg tett szerkesztések), NEM vak undo() a user editjén
  // a preview ELŐTTI projekt-pillanatkép (referencia) — a history-hossz helyett ehhez
  // göngyölünk vissza: teli (50 lépéses) history-nál a hossz nem nő, a régi összevetés
  // halott „Visszavonás"-t adott (B8)
  const previewBase = useRef<Project | null>(null);
  const previewingRef = useRef(false);

  const send = async (text: string) => {
    const state = useEditorStore.getState();
    if (!state.project || status) {
      return;
    }
    // 🔇 „vágd ki a csendeket" → a csend-vágás (eszközön, ingyen; jóváhagyással,
    // egy undo-lépésben) — nem a modellnek megy, hanem a determinisztikus útra
    if (isSilenceCutIntent(text)) {
      await cutDeadAir();
      return;
    }
    setStatus(t('panels.assistant.thinking'));
    setReply(null);
    setApplied(null);
    try {
      const context = buildAiContext(
        state.project,
        state.playhead,
        state.selectedClipId,
        state.events
      );
      // szemantikus réteg: a videók beszéde idővonal-időben (best-effort,
      // fájlonként cache-elve — worker/Whisper nélkül kimarad)
      const transcript = await withProgress(t('panels.assistant.progressTranscript'), (report) =>
        getTimelineTranscript(state.project!, report)
      ).catch((caught) => { logCaught('components/editor/panels/AssistantPanel.tsx:send', caught); return null; });
      if (transcript && transcript.length > 0) {
        context.transcript = transcript;
      }
      setStatus(t('panels.assistant.thinking'));
      // 🧩 lokál-előút (ingyenes): az egyszerű utasítás helyben fordul parancsra,
      // worker/kvóta nélkül — csak a nem-illeszkedő kérés megy hálózatra
      const answer = await askAssistant(context, text, {
        project: state.project,
        playhead: state.playhead,
        selectedClipId: state.selectedClipId,
      });
      setReply(answer);
      setAiResult({
        ok: true,
        text: answer.commands.length > 0
          ? t('panels.assistant.replyReady', { count: answer.commands.length })
          : t('panels.assistant.replyNoCommands'),
      });
    } catch (err) {
      logCaught('components/editor/panels/AssistantPanel.tsx:send', err);
      // 🧯 kétrétegű hiba: a fejlesztői részlet a logba, a felhasználó barátságos,
      // cselekvésre hívó üzenetet lát (nem nyers „TypeError: …")
      const appErr = toAppError(err);
      console.warn('AI kérés hiba:', appErr.detail);
      const friendly = t('errors.' + appErr.kind);
      setApplied(friendly);
      setAiResult({ ok: false, text: friendly });
    } finally {
      setStatus(null);
    }
  };

  // 👁️ terv-elem előnézete alkalmazás ELŐTT: a lejátszófej az érintett régióra
  // ugrik, és (ha van) kijelöli az érintett klipet — a felhasználó látja, mit
  // fog az AI módosítani, mielőtt jóváhagyja.
  const previewPlanItem = (item: AiPlanItem) => {
    const s = useEditorStore.getState();
    if (item.time != null) {
      s.setPlayhead(item.time);
    }
    if (item.clipId) {
      s.selectClip(item.clipId);
    }
  };

  const apply = () => {
    if (!reply) {
      return;
    }
    // proveniencia (#34): az AI-hozzáadott elemek megkapják az AI indoklását
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const commands = aiReplyCommands(reply, project);
    // #57 smart undo: a teljes AI-köteg EGY undo-lépés (nem parancsonként külön)
    const ok = useEditorStore.getState().applyBatch(commands, 'ai');
    setReply(null);
    setInstruction('');
    setApplied(
      ok > 0
        ? t('panels.assistant.commandsApplied', { count: ok })
        : t('panels.assistant.noApplicableCommand')
    );
  };

  /**
   * 🤖 Before/after preview: az AI-köteget IDEIGLENESEN alkalmazzuk, hogy a
   * felhasználó a preview-felületen lássa a VALÓDI eredményt, majd megtarthatja
   * (marad az undo-előzményben) vagy visszavonhatja. A revert a preview ELŐTTI
   * undo-mélységig göngyölít vissza (lásd `revertToBase`) — nem vak `undo()`.
   */
  const previewAll = () => {
    if (!reply) {
      return;
    }
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const commands = aiReplyCommands(reply, project);
    const baseProject = useEditorStore.getState().project;
    const ok = useEditorStore.getState().applyBatch(commands, 'ai');
    if (ok > 0) {
      previewBase.current = baseProject;
      setPreviewCount(ok);
      setPreviewing(true);
      haptics.selection();
    } else {
      setApplied(t('panels.assistant.noApplicableCommand'));
    }
  };
  const keepPreview = () => {
    setPreviewing(false);
    setReply(null);
    setInstruction('');
    setApplied(t('panels.assistant.commandsApplied', { count: previewCount }));
    haptics.success();
  };
  // a projektet a preview ELŐTTI állapotra göngyölíti vissza a command-buson át
  // (nem vak undo()): a köteget ÉS a preview alatt tett szerkesztéseket is
  // visszavonja, így sosem a user egy random editjét törli.
  const revertToBase = () => revertProjectTo(previewBase.current);
  const revertPreview = () => {
    revertToBase();
    setPreviewing(false);
    haptics.selection();
  };
  // a preview állapotot ref-ben is tartjuk (a unmount-cleanup olvassa)
  useEffect(() => {
    previewingRef.current = previewing;
  }, [previewing]);
  // panel-váltás / unmount PREVIEW közben → AUTO-REVERT: ne maradjon árva, csendben
  // véglegesített ideiglenes köteg (store-only, nincs setState unmountoltan).
  useEffect(
    () => () => {
      if (previewingRef.current) {
        revertProjectTo(previewBase.current);
      }
    },
    []
  );

  return {
    instruction,
    setInstruction,
    status,
    reply,
    setReply,
    previewing,
    send,
    previewPlanItem,
    apply,
    previewAll,
    keepPreview,
    revertPreview,
  };
}
