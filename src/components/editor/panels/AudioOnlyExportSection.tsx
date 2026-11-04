import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text } from 'react-native';

import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { mixForExport } from '@/lib/audioExportMix';
import { audioExportFileName, audioExportSettings, audioFormatInfo, type AudioExportFormat, type AudioExportQuality } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportAudioToFile, isRenderCancelledError } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import { guardPro, usePaywall } from '@/store/paywallStore';
import { withCancellableProgress } from '@/store/progressStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 🎧 Csak hang export a videó-szerkesztőből (PRO-AUDIO 17/20): a videó-projekt teljes hangja
 * (a videóklipek hangja + a hangsávok) egy fájlba, ugyanazzal a formátum- és minőségválasztóval,
 * mint a Hang Stúdióban, és azzal a keveréssel, amit a felhasználó hall (`mixForExport`).
 * A videóklipek hangját ma a szerver keveri (Pro); a telefonos változat külön lépés.
 */
export function AudioOnlyExportSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isPro = useEntitlement((s) => s.isPro());

  const download = (format: AudioExportFormat, quality: AudioExportQuality) => {
    setOpen(false);
    const st = useEditorStore.getState();
    const project = st.project;
    if (!project) {
      return;
    }
    const mix = mixForExport(project, st.isTrackAudible, st.masterVolume);
    if (!mix) {
      Alert.alert(t('studio.export'), t('studio.audio.exportSilent'));
      return;
    }
    if (!isPro) {
      usePaywall.getState().open('cloudRender');
      return;
    }
    const info = audioFormatInfo(format);
    void guardPro(
      () =>
        withCancellableProgress(t('studio.audio.exportRendering', { format: info.label }), async (report, signal) => {
          const target = new File(projectExportDir(), audioExportFileName(project.name, format));
          const uri = await exportAudioToFile(mix, audioExportSettings(format, quality), target, report, signal);
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, { mimeType: info.mime, dialogTitle: t('studio.audio.exportSheet.shareTitle') });
          } else {
            Alert.alert(t('studio.audio.exportSheet.savedTitle'), t('studio.audio.exportSheet.savedBody', { name: target.name }));
          }
        }),
      (e) => {
        logCaught('components/editor/panels/AudioOnlyExportSection.tsx:download', e);
        if (!isRenderCancelledError(e)) {
          Alert.alert(t('studio.export'), e.message);
        }
      }
    );
  };

  return (
    <PanelSection title={t('panels.export.audioOnlySection')}>
      <Text style={styles.hint}>{isPro ? t('panels.export.audioOnlyHint') : t('panels.export.audioOnlyHintFree')}</Text>
      <PrimaryButton icon="musical-notes-outline" label={t('panels.export.audioOnlyButton')} onPress={() => setOpen(true)} />
      {open ? <AudioExportSheet onClose={() => setOpen(false)} onDownload={download} /> : null}
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  hint: { color: palette.textDim, fontSize: 12, marginBottom: 8 },
});
