import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { AdvancedExportControls } from '@/components/editor/panels/export/AdvancedExportControls';
import { styles } from '@/components/editor/panels/export/exportStyles';
import type { ExportSettingsState } from '@/components/editor/panels/export/useExportSettings';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { planBatchExport } from '@/lib/batchExport';
import { CODECS, FPS_OPTIONS, QUALITIES, RESOLUTIONS, toggleBatchPlatform } from '@/lib/exportPanelOps';
import { isNativeRenderAvailable } from '@/lib/nativeRender';
import { PLATFORM_PRESETS } from '@/lib/render';
import type { ExportPlatform, RenderSettings } from '@/lib/render';

/** a videó-export szekció: platform-preset, batch, formátum-chipek, motor, render-gombok */
export function VideoExportSection({
  settings,
  estimatedMb,
  renderStatus,
  isPro,
  buildSettings,
  exportBatch,
  exportLocal,
  exportCloud,
}: {
  settings: ExportSettingsState;
  estimatedMb: number;
  renderStatus: string | null;
  isPro: boolean;
  buildSettings: () => RenderSettings;
  exportBatch: () => Promise<void>;
  exportLocal: () => Promise<void>;
  exportCloud: () => void;
}) {
  const { t } = useTranslation();
  const { setResolution, setFps, setQuality, setCodec, engine, setEngine, platform, batchSet, setBatchSet, applyPlatform } =
    settings;
  const { resolution, fps, quality, codec } = settings.values;
  return (
    <PanelSection title={t('panels.export.videoSection')}>
      <Text style={styles.settingLabel}>{t('panels.export.platformPreset')}</Text>
      <View style={styles.row}>
        {(Object.keys(PLATFORM_PRESETS) as ExportPlatform[]).map((p) => (
          <Chip
            key={p}
            label={`${PLATFORM_PRESETS[p].label} ${PLATFORM_PRESETS[p].aspect}`}
            active={platform === p}
            onPress={() => applyPlatform(p)}
          />
        ))}
      </View>

      {/* 📦 batch-export: több platform kijelölése → egy gombbal sorban rendereli (dedup) */}
      <Text style={styles.settingLabel}>{t('panels.export.batchLabel', { defaultValue: '📦 Batch (több platform egyszerre)' })}</Text>
      <View style={styles.row}>
        {(Object.keys(PLATFORM_PRESETS) as ExportPlatform[]).map((p) => (
          <Chip
            key={`b-${p}`}
            label={PLATFORM_PRESETS[p].label}
            active={batchSet.has(p)}
            onPress={() =>
              setBatchSet((prev) => toggleBatchPlatform(prev, p))
            }
          />
        ))}
      </View>
      {batchSet.size > 0 ? (
        <Pressable style={styles.batchBtn} onPress={() => void exportBatch()} disabled={!!renderStatus}>
          <Text style={styles.batchBtnText}>
            {t('panels.export.batchRun', {
              defaultValue: 'Batch export ({{n}} kimenet)',
              n: planBatchExport([...batchSet], buildSettings()).length,
            })}
          </Text>
        </Pressable>
      ) : null}

      <Text style={styles.settingLabel}>{t('panels.export.resolution')}</Text>
      <View style={styles.row}>
        {RESOLUTIONS.map((r) => (
          <Chip
            key={r.value}
            label={r.label}
            active={resolution === r.value}
            onPress={() => setResolution(r.value)}
          />
        ))}
      </View>
      <Text style={styles.settingLabel}>{t('panels.export.frameRate')}</Text>
      <View style={styles.row}>
        {FPS_OPTIONS.map((f) => (
          <Chip
            key={f}
            label={`${f} fps`}
            active={fps === f}
            onPress={() => setFps(f)}
          />
        ))}
      </View>
      <Text style={styles.settingLabel}>{t('panels.export.quality')}</Text>
      <View style={styles.row}>
        {QUALITIES.map((q) => (
          <Chip
            key={q.id}
            label={t('panels.export.quality_' + q.id)}
            active={quality === q.id}
            onPress={() => setQuality(q.id)}
          />
        ))}
      </View>
      <Text style={styles.settingLabel}>{t('panels.export.codec')}</Text>
      <View style={styles.row}>
        {CODECS.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            active={codec === c.id}
            onPress={() => setCodec(c.id)}
          />
        ))}
      </View>
      <Text style={styles.estimate}>
        {CODECS.find((c) => c.id === codec)?.label ?? 'H.264'} · {fps} fps · ~
        {estimatedMb < 1 ? '<1' : Math.round(estimatedMb)} MB
      </Text>
      <Text style={styles.note}>{t('panels.export.codecCloudNote')}</Text>

      <AdvancedExportControls settings={settings} />

      {/* ⚙️ Pro: render-motor választás — eszköz (ingyen) vagy felhő (mért);
          a posztolás/feed-megosztás is a kiválasztott motort használja */}
      {isPro ? (
        <>
          <Text style={styles.settingLabel}>{t('panels.export.engineLabel')}</Text>
          <View style={styles.row}>
            <Chip
              label={t('panels.export.engineAuto')}
              active={engine === 'auto'}
              onPress={() => setEngine('auto')}
            />
            {isNativeRenderAvailable() ? (
              <Chip
                label={t('panels.export.engineLocal')}
                active={engine === 'local'}
                onPress={() => setEngine('local')}
              />
            ) : null}
            <Chip
              label={t('panels.export.engineCloud')}
              active={engine === 'cloud'}
              onPress={() => setEngine('cloud')}
            />
          </View>
          <Text style={styles.note}>{t('panels.export.engineNote')}</Text>
        </>
      ) : null}

      <PrimaryButton
        icon="phone-portrait-outline"
        label={renderStatus ?? t('panels.export.exportOnDeviceFree')}
        onPress={() => void exportLocal()}
      />
      <Pressable
        style={[styles.cloudBtn, renderStatus ? styles.postBtnOff : null]}
        disabled={renderStatus !== null}
        onPress={exportCloud}
      >
        <Ionicons name="cloud-upload-outline" size={16} color={palette.accent} />
        <Text style={styles.cloudText}>{t('panels.export.cloudHdRender')}</Text>
        <View style={styles.proTag}>
          <Text style={styles.proTagText}>PRO</Text>
        </View>
      </Pressable>
      <Text style={styles.note}>
        {t('panels.export.videoNoteA')}<Text style={styles.strong}>{t('panels.export.videoNoteBoldLocal')}</Text>{t('panels.export.videoNoteB')}<Text style={styles.strong}>{t('panels.export.videoNoteBoldCloud')}</Text>{t('panels.export.videoNoteC')}
        {!isNativeRenderAvailable()
          ? t('panels.export.videoNoteExpoGo')
          : ''}
      </Text>
    </PanelSection>
  );
}
