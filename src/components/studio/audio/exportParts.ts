import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { mixForExport } from '@/lib/audioExportMix';
import { audioExportFileName } from '@/lib/audioExportOptions';
import { rangeSuffix, stemSpecs } from '@/lib/audioStems';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportOfflineStems, exportOfflineWav } from '@/lib/offlineMixClient';
import { useEditorStore } from '@/store/editorStore';
import { withCancellableProgress } from '@/store/progressStore';
import type { Project } from '@/types/project';

/**
 * ✂️🎚️ Tartomány- és stem-export (Hang Stúdió): WAV a telefonon, mindenkinek. A tartomány a
 * transzport In–Out pontja; a stemek a hallható sávok (a némított sáv nem kerül bele — azt
 * kapod, amit hallasz), egy ZIP-ben. `share`: a megosztó lap nyílik (a füstteszt kikapcsolja).
 */
export async function exportParts(
  project: Project,
  scope: { range: boolean; stems: boolean },
  bits: 16 | 24,
  t: TFunction,
  share = true
): Promise<{ uri: string; files?: string[] } | null> {
  const st = useEditorStore.getState();
  const mix = mixForExport(project, st.isTrackAudible, st.masterVolume);
  if (!mix) {
    Alert.alert(t('studio.export'), t('studio.audio.exportSilent'));
    return null;
  }
  const range =
    scope.range && st.rangeIn != null && st.rangeOut != null && st.rangeOut > st.rangeIn ? { from: st.rangeIn, to: st.rangeOut } : undefined;
  const base = audioExportFileName(project.name, 'wav').replace(/\.wav$/, '') + (range ? rangeSuffix(range.from, range.to) : '');
  const lanes = audioLanes(project);
  const label = (type: string) => {
    const lane = lanes.find((l) => l.type === type);
    return lane ? laneLabel(lane, t) : type;
  };
  return withCancellableProgress(t('studio.audio.exportRendering', { format: scope.stems ? 'ZIP' : 'WAV' }), async (report, signal) => {
    const result = scope.stems
      ? await exportOfflineStems(mix, new File(projectExportDir(), `${base}_stems.zip`), stemSpecs(mix, label), report, signal, { range, bits })
      : await exportOfflineWav(mix, new File(projectExportDir(), `${base}.wav`), report, signal, 'pcm16', { range, bits });
    if (share && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(result.uri, { mimeType: scope.stems ? 'application/zip' : 'audio/wav', dialogTitle: t('studio.audio.exportSheet.shareTitle') });
    }
    return result;
  });
}
