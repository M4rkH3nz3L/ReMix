import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { AutoCaptionSection } from '@/components/editor/panels/captions/AutoCaptionSection';
import { CaptionInputSections } from '@/components/editor/panels/captions/CaptionInputSections';
import { CaptionRewriteSections } from '@/components/editor/panels/captions/CaptionRewriteSections';
import { CaptionStudioSection } from '@/components/editor/panels/captions/CaptionStudioSection';
import { createCaptionInsertActions } from '@/components/editor/panels/captions/captionInsertActions';
import { createCaptionLayoutActions } from '@/components/editor/panels/captions/captionLayoutActions';
import { createCaptionFixActions, createTranslateActions } from '@/components/editor/panels/captions/captionRewriteActions';
import { styles } from '@/components/editor/panels/captions/captionsStyles';
import { captionLines } from '@/lib/captionPanelOps';
import { useEditorStore } from '@/store/editorStore';
import type { TextStylePreset } from '@/types/project';

/**
 * Gyors felirat: soronként egy caption, a lejátszófejtől a videósáv végéig
 * egyenletesen elosztva. Ugyanez a belépési pont fogadja majd a beszédfelismerés
 * (auto-caption) eredményét is.
 */
export function CaptionsPanel() {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne a React Compilerrel (előtte kimaradt: a try/finally
  // a gyökérben volt), de a memoizálás bekapcsolása viselkedés-változás → külön döntés
  // (tools/reactCompiler.test.js KNOWN_BAILS).
  'use no memo';
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [preset, setPreset] = useState<TextStylePreset>('bubble');
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [studioStatus, setStudioStatus] = useState<string | null>(null);
  const [layoutStatus, setLayoutStatus] = useState<string | null>(null);
  const [wordStatus, setWordStatus] = useState<string | null>(null);
  const [translateStatus, setTranslateStatus] = useState<string | null>(null);

  const { runWordTimings, runSpeakerColors, runSpeakerLabels, runSmartPosition } = createCaptionLayoutActions({
    t,
    setLayoutStatus,
    setWordStatus,
  });
  const setPanel = useEditorStore((s) => s.setPanel);

  const { runTranslate, runBilingual } = createTranslateActions({ t, translateStatus, setTranslateStatus });
  const { runProfanity, runSafeZone, runCaptionStudio } = createCaptionFixActions({ t, setStudioStatus });

  const lines = captionLines(raw);

  const { importSrt, autoCaptions, addCaptions } = createCaptionInsertActions({ t, preset, lines, setRaw, setPanel });

  return (
    <View>
      <AutoCaptionSection aiStatus={aiStatus} setAiStatus={setAiStatus} autoCaptions={autoCaptions} />

      <CaptionStudioSection
        studioStatus={studioStatus}
        layoutStatus={layoutStatus}
        wordStatus={wordStatus}
        runCaptionStudio={runCaptionStudio}
        runSpeakerColors={runSpeakerColors}
        runWordTimings={runWordTimings}
        runSmartPosition={runSmartPosition}
        runSpeakerLabels={runSpeakerLabels}
        runSafeZone={runSafeZone}
      />

      <CaptionInputSections
        preset={preset}
        setPreset={setPreset}
        raw={raw}
        setRaw={setRaw}
        lines={lines}
        addCaptions={addCaptions}
        importSrt={importSrt}
      />

      <CaptionRewriteSections
        translateStatus={translateStatus}
        runTranslate={runTranslate}
        runBilingual={runBilingual}
        runProfanity={runProfanity}
      />

      <Text style={styles.note}>
        {t('panels.captions.footerNote')}
      </Text>
    </View>
  );
}
