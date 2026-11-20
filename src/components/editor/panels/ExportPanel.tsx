import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { AudioOnlyExportSection } from '@/components/editor/panels/AudioOnlyExportSection';
import { CloudMediaSection } from '@/components/editor/panels/CloudMediaSection';
import { ExportLintList } from '@/components/editor/panels/ExportLintList';
import { CaptionsSection } from '@/components/editor/panels/export/CaptionsSection';
import { InteractiveSection } from '@/components/editor/panels/export/InteractiveSection';
import { PostSection } from '@/components/editor/panels/export/PostSection';
import { ProjectFileSection } from '@/components/editor/panels/export/ProjectFileSection';
import { ProStatusBanner } from '@/components/editor/panels/export/ProStatusBanner';
import { createProjectFileActions } from '@/components/editor/panels/export/projectFileActions';
import { createThumbActions } from '@/components/editor/panels/export/thumbActions';
import { ThumbnailStudioSection } from '@/components/editor/panels/export/ThumbnailStudioSection';
import { useExportSettings } from '@/components/editor/panels/export/useExportSettings';
import { useThumbStudioState } from '@/components/editor/panels/export/useThumbStudioState';
import { createVideoExportActions } from '@/components/editor/panels/export/videoExportActions';
import { VideoExportSection } from '@/components/editor/panels/export/VideoExportSection';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import { buildRenderSettings, estimateExportMb } from '@/lib/exportPanelOps';
import { projectDuration } from '@/lib/projectUtils';
import type { RenderSettings } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';

/**
 * Videó-export panel — kompozíciós gyökér. Az állapot a `panels/export/` hookjaiban
 * (a bontás előtti useState-sorrendben), a műveletek renderenként létrehozott
 * `create*Actions` gyárakban, a szekciók ugyanott; a tiszta mag: `@/lib/exportPanelOps`.
 */
export function ExportPanel() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const restoreProject = useEditorStore((s) => s.restoreProject);
  const isPro = useEntitlement((s) => s.isPro());
  const proUntil = useEntitlement((s) => s.proUntil);
  const openPaywall = usePaywall((s) => s.open);
  // 🧪 füstteszt: a telefonos export ugyanazon az úton indul, mint a gombról (az érték lent, az exportLocal után)
  const exportLocalRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => registerDevAction('video.exportLocal', () => exportLocalRef.current()), []);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [collectStatus, setCollectStatus] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  const settings = useExportSettings();
  const thumbState = useThumbStudioState();

  if (!project) {
    return null;
  }

  const { loadHeadlines, pickThumb } = createThumbActions(project, t, thumbState);

  const durationSec = projectDuration(project);
  const estimatedMb = estimateExportMb(durationSec, settings.values);

  // az összes chip → egyetlen RenderSettings (a worker/natív render ezt kapja)
  const buildSettings = (): RenderSettings => buildRenderSettings(settings.values);

  const { exportLocal, exportBatch, exportCloud, shareToFeed, postTo } = createVideoExportActions({
    project,
    t,
    renderStatus,
    setRenderStatus,
    buildSettings,
    batchSet: settings.batchSet,
    isPro,
    engine: settings.engine,
  });

  exportLocalRef.current = exportLocal;

  const { guard, exportCaptions, cloudBackup, cloudRestore } = createProjectFileActions({
    project,
    t,
    cloudStatus,
    setCloudStatus,
    restoreProject,
  });

  return (
    <View style={{ gap: 12 }}>
      <ProStatusBanner isPro={isPro} proUntil={proUntil} openPaywall={openPaywall} />

      {/* 🧹 export előtti tartalom-ellenőrzés (helyőrző, offline média, néma kimenet) */}
      <ExportLintList project={project} />

      <PrimaryButton
        label={t('feed.shareToFeed')}
        icon="play-circle-outline"
        onPress={shareToFeed}
        disabled={!!renderStatus}
      />
      {project.rendered ? (
        <Text style={{ color: palette.textDim, fontSize: 12, textAlign: 'center' }}>
          {t('panels.export.renderedReady')}
        </Text>
      ) : null}

      <VideoExportSection
        settings={settings}
        estimatedMb={estimatedMb}
        renderStatus={renderStatus}
        isPro={isPro}
        buildSettings={buildSettings}
        exportBatch={exportBatch}
        exportLocal={exportLocal}
        exportCloud={exportCloud}
      />

      <AudioOnlyExportSection />

      <PostSection renderStatus={renderStatus} postTo={postTo} />

      <ThumbnailStudioSection
        project={project}
        thumbState={thumbState}
        pickThumb={pickThumb}
        loadHeadlines={loadHeadlines}
      />

      <CaptionsSection exportCaptions={exportCaptions} />

      <InteractiveSection project={project} guard={guard} />

      <ProjectFileSection
        project={project}
        guard={guard}
        collectStatus={collectStatus}
        setCollectStatus={setCollectStatus}
        cloudStatus={cloudStatus}
        cloudBackup={cloudBackup}
        cloudRestore={cloudRestore}
      />

      {/* 🎯 fájlonkénti visszaállítás: felhő-mentésből (R2 / saját tár, pl. Drive) és .rp-ből */}
      <CloudMediaSection project={project} />
    </View>
  );
}
