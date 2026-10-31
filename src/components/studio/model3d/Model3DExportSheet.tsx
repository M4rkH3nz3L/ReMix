import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { device3DCaps } from '@/lib/deviceCaps';
import {
  availableExportFormats,
  defaultExportSettings,
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  EXPORT_UNITS,
  exportOptionsJson,
  exportWarnings,
  withFormat,
  type ExportDestination,
  type ExportSettings,
} from '@/lib/model3dExport';
import {
  cancelModelRender,
  exportModelFile,
  renderModelStill,
  renderModelTurntable,
  turntableAvailable,
} from '@/lib/model3dRenderClient';
import { checkSyncCapacity, requestProjectSync, setProjectSyncEnabled } from '@/lib/projectSyncClient';
import { remix3dErrorKey } from '@/lib/remix3dNative';
import { formatBytes } from '@/lib/storageQuota';
import { useEditorStore } from '@/store/editorStore';
import type { Model3DDoc, Model3DMesh } from '@/types/model3d';
import type { Project } from '@/types/project';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** a forgó videó választható képarányai (a közösségi platformok szokásos formái) */
const VIDEO_ASPECTS = ['9:16', '1:1', '16:9'] as const;
const DESTINATIONS: { id: ExportDestination; icon: IoniconName }[] = [
  { id: 'device', icon: 'phone-portrait-outline' },
  { id: 'remix', icon: 'cloud-upload-outline' },
  { id: 'share', icon: 'share-outline' },
];

/** megerősítő kérdés Promise-ként */
function confirmAsync(title: string, body: string, ok: string, cancel: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, body, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ])
  );
}

/**
 * 📤 A 3D-modell kivitele: 🖼️ állókép, 🎬 360°-os forgó videó és 📦 SZABVÁNYOS 3D-fájl —
 * GLB (alap) · FBX · OBJ (+MTL+textúra zip) · USDZ · USD · PLY · STL, választható
 * geometria-minőséggel (az eredeti megmarad, az optimalizált külön fájl), egységgel
 * (m/cm/mm — egyszer skálázva), textúrával/színnel. A kész fájl helye: a projekt mappája
 * a telefonon (`Export/`), a ReMix Storage (a projekt-szinkronnal) vagy a megosztás-lap.
 */
export function Model3DExportSheet({
  visible,
  onClose,
  modelUri,
  mesh,
  project,
  doc,
  background,
  onCurrentView,
  lookJson,
}: {
  /** a stúdió megjelenése (forgatás + fény) → a kép/videó azt adja, amit a néző mutat */
  lookJson: string;
  visible: boolean;
  onClose: () => void;
  /** 📸 állókép a néző AKTUÁLIS nézetéből (PNG uri) — ha a néző elérhető */
  onCurrentView?: () => Promise<string>;
  modelUri: string;
  mesh: Model3DMesh;
  project: Project;
  doc: Model3DDoc;
  background: string | null;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [aspect, setAspect] = useState<(typeof VIDEO_ASPECTS)[number]>('9:16');
  const formats = availableExportFormats(mesh, device3DCaps());
  const [settingsState, setSettings] = useState<ExportSettings>(() => defaultExportSettings(formats[0]));
  // a modell cseréje (pl. pontfelhő) után a választott formátum már nem biztos, hogy elérhető
  const settings = formats.includes(settingsState.format) ? settingsState : withFormat(settingsState, formats[0]);
  const [dest, setDest] = useState<ExportDestination>('device');
  const spec = EXPORT_FORMATS[settings.format];
  const carriesColor = spec.textures || spec.colors;
  const warnings = exportWarnings(mesh, settings.format, settings.textures);

  const share = async (uri: string, mimeType?: string) => {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('model3d.export.shareUnavailable');
    }
    await Sharing.shareAsync(uri, mimeType ? { mimeType } : undefined);
  };

  const run = async (key: string, job: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(key);
    setProgress(0);
    try {
      await job();
    } catch (e) {
      const k = remix3dErrorKey(e);
      if (k !== 'model3d.error.cancelled') {
        Alert.alert(t('model3d.export.title'), t(k));
      }
    } finally {
      setBusy(null);
    }
  };

  const still = () =>
    run('still', async () => {
      const uri = await renderModelStill(modelUri, { transparent: true, toCache: true, optionsJson: lookJson });
      await share(uri, 'image/png');
    });

  const currentView = () =>
    run('current', async () => {
      if (!onCurrentView) return;
      await share(await onCurrentView(), 'image/png');
    });

  const video = () =>
    run('video', async () => {
      const { uri } = await renderModelTurntable(
        modelUri,
        { aspectRatio: aspect, seconds: 6, fps: 30, background, toCache: true, optionsJson: lookJson },
        setProgress
      );
      await share(uri, 'video/mp4');
    });

  /** ☁️ a ReMix Storage-hoz a projekt-szinkron kell — ha ki van kapcsolva, kvóta-ellenőrzés + kérdés */
  const remixReady = async (): Promise<'on' | 'enable' | null> => {
    const live = useEditorStore.getState().project ?? project;
    if (live.syncToRemix) {
      return 'on';
    }
    const cap = await checkSyncCapacity(live);
    if (!cap.signedIn) {
      Alert.alert(t('model3d.export.destRemix'), t('model3d.export.remixSignIn'));
      return null;
    }
    if (!cap.ok) {
      Alert.alert(t('model3d.export.destRemix'), t('model3d.export.remixQuota', { size: formatBytes(cap.missingBytes) }));
      return null;
    }
    const ok = await confirmAsync(
      t('model3d.export.remixEnableTitle'),
      t('model3d.export.remixEnableBody', { size: formatBytes(cap.uploadBytes) }),
      t('model3d.export.remixEnable'),
      t('common.cancel')
    );
    return ok ? 'enable' : null;
  };

  const exportFile = () =>
    run('file', async () => {
      if (warnings.length) {
        const go = await confirmAsync(settings.format.toUpperCase(), warnings.map((w) => t(w)).join('\n'), t('model3d.export.continue'), t('common.cancel'));
        if (!go) return;
      }
      const remix = dest === 'remix' ? await remixReady() : null;
      if (dest === 'remix' && !remix) return;
      const uri = await exportModelFile(modelUri, project.name, settings, exportOptionsJson(doc, mesh, settings), dest === 'share');
      const name = decodeURIComponent(uri.split('/').pop() ?? '');
      if (dest === 'share') {
        await share(uri);
      } else if (dest === 'device') {
        Alert.alert(t('model3d.export.savedTitle'), t('model3d.export.savedDevice', { name, folder: project.folder ?? project.name }));
      } else {
        const live = useEditorStore.getState().project ?? project;
        if (remix === 'enable') {
          await setProjectSyncEnabled(live.id, true);
        } else {
          void requestProjectSync(live, { manual: true });
        }
        Alert.alert(t('model3d.export.savedTitle'), t('model3d.export.savedRemix', { name }));
      }
    });

  const set = (patch: Partial<ExportSettings>) => {
    if (!busy) setSettings({ ...settings, ...patch });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      {/* a háttér-koppintó és a lap TESTVÉREK (nem egymásba ágyazott Pressable-ök) — a
          beágyazott Pressable ellopta a görgetést, a lap alja (Export gomb) elérhetetlen volt */}
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => !busy && onClose()}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.head}>{t('model3d.export.title')}</Text>
            <Row busy={busy} progress={progress} cancelLabel={t('common.cancel')} k="still" icon="image-outline" title={t('model3d.export.still')} sub={t('model3d.export.stillSub')} onPress={() => void still()} />
            {onCurrentView ? (
              <Row busy={busy} progress={progress} cancelLabel={t('common.cancel')} k="current" icon="camera-outline" title={t('model3d.export.currentView')} sub={t('model3d.export.currentViewSub')} onPress={() => void currentView()} />
            ) : null}
            <Row
              busy={busy}
              progress={progress}
              cancelLabel={t('common.cancel')}
              k="video"
              icon="film-outline"
              title={t('model3d.export.turntable')}
              sub={turntableAvailable() ? t('model3d.export.turntableSub') : t('model3d.error.needsNewBuild')}
              onPress={() => void video()}
              disabled={!turntableAvailable()}
            />
            {turntableAvailable() ? (
              <View style={styles.aspectRow} accessibilityLabel={t('model3d.export.aspect')}>
                {VIDEO_ASPECTS.map((a) => (
                  <Chip key={a} label={a} active={aspect === a} onPress={() => !busy && setAspect(a)} />
                ))}
              </View>
            ) : null}

            {/* ── 📦 3D-fájl ── */}
            <Text style={styles.section}>{t('model3d.export.fileTitle')}</Text>
            <View style={styles.chips} accessibilityLabel={t('model3d.export.format')}>
              {formats.map((f) => (
                <Chip key={f} label={f.toUpperCase()} active={settings.format === f} onPress={() => !busy && setSettings(withFormat(settings, f))} />
              ))}
            </View>
            <Text style={styles.hint}>{t(spec.useKey)}</Text>

            <Text style={styles.label}>{t('model3d.export.quality')}</Text>
            <View style={styles.chips}>
              {EXPORT_QUALITIES.map((q) => (
                <Chip key={q} label={t(`model3d.export.quality_${q}`)} active={settings.quality === q} onPress={() => set({ quality: q })} />
              ))}
            </View>
            <Text style={styles.hint}>{t(`model3d.export.qualityHint_${settings.quality}`)}</Text>

            <Text style={styles.label}>{t('model3d.export.unit')}</Text>
            {spec.units ? (
              <View style={styles.chips}>
                {EXPORT_UNITS.map((u) => (
                  <Chip key={u} label={t(`model3d.export.unit_${u}`)} active={settings.unit === u} onPress={() => set({ unit: u })} />
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>{t('model3d.export.unitFixed', { format: settings.format.toUpperCase() })}</Text>
            )}

            {carriesColor ? (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('model3d.export.textures')}</Text>
                <Switch
                  value={settings.textures}
                  onValueChange={(v) => set({ textures: v })}
                  accessibilityLabel={t('model3d.export.textures')}
                  trackColor={{ true: palette.accent }}
                />
              </View>
            ) : null}

            <Text style={styles.label}>{t('model3d.export.destination')}</Text>
            <View style={styles.chips}>
              {DESTINATIONS.map((d) => (
                <Chip key={d.id} label={t(`model3d.export.dest_${d.id}`)} active={dest === d.id} onPress={() => !busy && setDest(d.id)} />
              ))}
            </View>
            <Text style={styles.hint}>{t(`model3d.export.destHint_${dest}`)}</Text>

            {warnings.map((w) => (
              <Text key={w} style={styles.warn}>
                ⚠️ {t(w)}
              </Text>
            ))}

            <Pressable
              onPress={() => void exportFile()}
              disabled={busy !== null}
              style={({ pressed }) => [styles.primary, busy !== null && styles.dim, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('model3d.export.run', { format: settings.format.toUpperCase() })}
              accessibilityState={{ busy: busy === 'file' }}
            >
              {busy === 'file' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>{t('model3d.export.run', { format: settings.format.toUpperCase() })}</Text>
              )}
            </Pressable>
            <Text style={styles.hint}>{t('model3d.export.videoHint')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** egy kiviteli sor (a futó elemnél haladás / megszakítás vagy pörgő jelző) */
function Row({
  k,
  icon,
  title,
  sub,
  onPress,
  disabled,
  busy,
  progress,
  cancelLabel,
}: {
  k: string;
  icon: IoniconName;
  title: string;
  sub: string;
  onPress: () => void;
  disabled?: boolean;
  busy: string | null;
  progress: number;
  cancelLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy !== null}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={sub}
      accessibilityState={{ disabled: !!disabled || busy !== null, busy: busy === k }}
      style={({ pressed }) => [styles.row, (disabled || (busy && busy !== k)) && styles.dim, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={palette.accent} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
        {busy === k && k === 'video' ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(2, progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {busy === k ? (
        k === 'video' ? (
          <Pressable onPress={cancelModelRender} style={styles.cancelBtn} accessibilityRole="button" accessibilityLabel={cancelLabel}>
            <Text style={styles.cancel}>{cancelLabel}</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={palette.accent} />
        )
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000a' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '88%',
  },
  scroll: { gap: 4, paddingBottom: 36 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  label: { color: palette.text, fontSize: 13, fontWeight: '700', marginTop: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, minHeight: 44 },
  switchLabel: { color: palette.text, fontSize: 14, fontWeight: '600', flex: 1 },
  warn: { color: palette.warning, fontSize: 12, lineHeight: 17, marginTop: 6 },
  primary: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 8 },
  head: { color: palette.text, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  body: { flex: 1, gap: 2 },
  title: { color: palette.text, fontSize: 15, fontWeight: '700' },
  sub: { color: palette.textDim, fontSize: 12 },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  track: { height: 5, borderRadius: 3, backgroundColor: palette.surfaceHigh, overflow: 'hidden', marginTop: 6 },
  fill: { height: 5, borderRadius: 3, backgroundColor: palette.accent },
  cancel: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  cancelBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  aspectRow: { flexDirection: 'row', gap: 8, paddingLeft: 36, paddingBottom: 6 },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 16, marginTop: 4 },
});
