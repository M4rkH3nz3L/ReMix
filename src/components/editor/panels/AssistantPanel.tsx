import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { AiActivity } from '@/components/editor/AiActivity';
import type { AiResult } from '@/components/editor/AiActivity';
import { AiCharacterPicker } from '@/components/editor/AiCharacterPicker';
import { AutoEditSection } from '@/components/editor/panels/assistant/AutoEditSection';
import { BrandKitSection } from '@/components/editor/panels/assistant/BrandKitSection';
import { CommandBarSection } from '@/components/editor/panels/assistant/CommandBarSection';
import { CutToolsSection } from '@/components/editor/panels/assistant/CutToolsSection';
import { HooksSection } from '@/components/editor/panels/assistant/HooksSection';
import { InstructionSection } from '@/components/editor/panels/assistant/InstructionSection';
import { LookPacksSection } from '@/components/editor/panels/assistant/LookPacksSection';
import { SmartSearchSection } from '@/components/editor/panels/assistant/SmartSearchSection';
import { SocialPresetsSection } from '@/components/editor/panels/assistant/SocialPresetsSection';
import { SoundDesignSection } from '@/components/editor/panels/assistant/SoundDesignSection';
import { SuggestionSection } from '@/components/editor/panels/assistant/SuggestionSection';
import { useAiReply } from '@/components/editor/panels/assistant/useAiReply';
import { useAutoEdit } from '@/components/editor/panels/assistant/useAutoEdit';
import { useCutTools } from '@/components/editor/panels/assistant/useCutTools';
import { useFootageInsights } from '@/components/editor/panels/assistant/useFootageInsights';
import { useReframeTools } from '@/components/editor/panels/assistant/useReframeTools';
import { useWorkerDiag } from '@/components/editor/panels/assistant/useWorkerDiag';
import { PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { partitionAiCommands } from '@/lib/aiCommands';
import { useEditorStore } from '@/store/editorStore';

/**
 * AI-asszisztens (full-plan F3): utasítás → a worker Claude-dal parancslistát
 * készít → jóváhagyás után a Command Bus-on fut le (actor: 'ai'), teljes
 * undo-val. Az AI sosem írja közvetlenül a projektet.
 *
 * Kompozíciós gyökér: az állapot és a műveletek a `panels/assistant/` hookjaiban,
 * a szekciók ugyanott. A hookok sorrendje az effektek eredeti sorrendjét őrzi
 * (worker-diag → változat-előnézet leállítása → preview-ref → unmount-revert).
 */
export function AssistantPanel() {
  const { t } = useTranslation();
  const [applied, setApplied] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const workerDiag = useWorkerDiag(t);

  // 🪝 kiemelt AI-módok busy-állapota: a MEGLÉVŐ busyLabel-aggregációt megőrizve
  // a panel tartja a slotot, a szekciók vezérlik propból (controlled status)
  const [hookBusy, setHookBusy] = useState<string | null>(null);
  const [productBusy, setProductBusy] = useState<string | null>(null);
  const [sfxBusy, setSfxBusy] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState<string | null>(null);

  const { cutStatus, cutDeadAir, sceneStatus, splitAtScenes, beatStatus, fxStatus, applyBeatFx, splitOnBeats } =
    useCutTools(t, setApplied);
  const { footageStatus, brollStatus, findBroll, footageCheck } = useFootageInsights(t);
  const autoEdit = useAutoEdit(t, setApplied);
  const { reframeStatus, smartReframe, applySocialPreset } = useReframeTools(t, setApplied);
  const chat = useAiReply({ t, cutDeadAir, setApplied, setAiResult });

  /**
   * 🔔 A tevékenység-sáv a MEGLÉVŐ állapotokból származik — nem kellett a 13
   * hívási helyet átírni. Bármelyik fut, a sáv látszik, és mutatja az eltelt
   * időt is (ez különbözteti meg a „dolgozik"-ot a „beragadt"-tól).
   */
  const busyLabel =
    chat.status ??
    hookBusy ??
    productBusy ??
    cutStatus ??
    sceneStatus ??
    autoEdit.autoStatus ??
    beatStatus ??
    fxStatus ??
    sfxBusy ??
    reframeStatus ??
    searchBusy ??
    autoEdit.highlightStatus ??
    footageStatus ??
    brollStatus ??
    null;

  // 🤖 B17: a válasz parancsai a VALÓDI projekt ellen szétválogatva — a lista, a darabszám
  // és a végrehajtás is ebből jön (eddig a nyers listát mutattuk, a kiszűrtekkel együtt)
  const planProject = useEditorStore.getState().project;
  const plan = chat.reply && planProject ? partitionAiCommands(chat.reply.commands, planProject) : null;

  return (
    <View>
      <AiActivity
        key={busyLabel ?? 'idle'}
        busyLabel={busyLabel}
        result={aiResult}
        onDismiss={() => setAiResult(null)}
      />
      <PanelSection title={t('panels.assistant.modelSection')}>
        <AiCharacterPicker task="assistant" />
        <Text style={styles.modelHint}>{t('panels.assistant.modelHint')}</Text>
      </PanelSection>

      <CommandBarSection
        cutDeadAir={cutDeadAir}
        splitOnBeats={splitOnBeats}
        smartReframe={smartReframe}
        setTargetSeconds={autoEdit.setTargetSeconds}
        startAutoEdit={autoEdit.startAutoEdit}
        send={chat.send}
      />

      <AutoEditSection
        targetSeconds={autoEdit.targetSeconds}
        setTargetSeconds={autoEdit.setTargetSeconds}
        autoStatus={autoEdit.autoStatus}
        autoResult={autoEdit.autoResult}
        startAutoEdit={autoEdit.startAutoEdit}
        previewingId={autoEdit.previewingId}
        previewVariant={autoEdit.previewVariant}
        applyVariant={autoEdit.applyVariant}
        highlightStatus={autoEdit.highlightStatus}
        highlights={autoEdit.highlights}
        findShorts={autoEdit.findShorts}
      />

      <InstructionSection
        instruction={chat.instruction}
        setInstruction={chat.setInstruction}
        status={chat.status}
        send={chat.send}
      />

      <SmartSearchSection busy={searchBusy} setBusy={setSearchBusy} />

      <HooksSection busy={hookBusy} setBusy={setHookBusy} setApplied={setApplied} />

      <LookPacksSection busy={productBusy} setBusy={setProductBusy} setApplied={setApplied} />

      <BrandKitSection />

      <CutToolsSection
        cutStatus={cutStatus}
        cutDeadAir={cutDeadAir}
        sceneStatus={sceneStatus}
        splitAtScenes={splitAtScenes}
        beatStatus={beatStatus}
        splitOnBeats={splitOnBeats}
        fxStatus={fxStatus}
        applyBeatFx={applyBeatFx}
        reframeStatus={reframeStatus}
        smartReframe={smartReframe}
        footageStatus={footageStatus}
        footageCheck={footageCheck}
        brollStatus={brollStatus}
        findBroll={findBroll}
      />

      <SocialPresetsSection applySocialPreset={applySocialPreset} />

      <SoundDesignSection busy={sfxBusy} setBusy={setSfxBusy} />

      {chat.reply ? (
        <SuggestionSection
          message={chat.reply.message}
          plan={plan}
          planProject={planProject}
          previewing={chat.previewing}
          previewPlanItem={chat.previewPlanItem}
          keepPreview={chat.keepPreview}
          revertPreview={chat.revertPreview}
          previewAll={chat.previewAll}
          apply={chat.apply}
          discard={() => chat.setReply(null)}
        />
      ) : null}

      {applied ? <Text style={styles.note}>{applied}</Text> : null}

      <Text style={styles.note}>{t('panels.assistant.assistantFooter')}</Text>
      <Text style={styles.note}>{workerDiag}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modelHint: {
    color: palette.textDim,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
