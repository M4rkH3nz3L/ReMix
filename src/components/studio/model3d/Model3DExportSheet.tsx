import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { EXPORT_FORMATS, exportWarnings } from '@/lib/model3dExport';
import {
  cancelModelRender,
  exportModelFile,
  renderModelStill,
  renderModelTurntable,
  turntableAvailable,
} from '@/lib/model3dRenderClient';
import { remix3dErrorKey } from '@/lib/remix3dNative';
import type { MeshFormat, Model3DMesh } from '@/types/model3d';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** a készüléken exportálható formátumok (a GLB szerver-oldali → 3D-6) */
const LOCAL_FORMATS: MeshFormat[] = (Object.keys(EXPORT_FORMATS) as MeshFormat[]).filter((f) => EXPORT_FORMATS[f].local);

/** a forgó videó választható képarányai (a közösségi platformok szokásos formái) */
const VIDEO_ASPECTS = ['9:16', '1:1', '16:9'] as const;

/**
 * 📤 A 3D-modell kivitele: 🖼️ állókép (átlátszó PNG, a projekt mappájába), 🎬 360°-os
 * forgó videó (MP4, haladással és megszakítással), 📦 modell-fájl (USDZ/OBJ/STL/PLY,
 * figyelmeztetésekkel). Mindhárom a rendszer megosztás-lapjára visz (mentés Fájlokba,
 * AirDrop, Drive …). A videóba illesztés a videószerkesztő Matrica-paneljén megy.
 */
export function Model3DExportSheet({
  visible,
  onClose,
  modelUri,
  mesh,
  projectName,
  background,
  onCurrentView,
  optionsJson,
}: {
  /** a stúdió megjelenése (forgatás + fény) → a kivitel azt adja, amit a néző mutat */
  optionsJson: string;
  visible: boolean;
  onClose: () => void;
  /** 📸 állókép a néző AKTUÁLIS nézetéből (PNG uri) — ha a néző elérhető */
  onCurrentView?: () => Promise<string>;
  modelUri: string;
  mesh: Model3DMesh;
  projectName: string;
  background: string | null;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [aspect, setAspect] = useState<(typeof VIDEO_ASPECTS)[number]>('9:16');

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
      const uri = await renderModelStill(modelUri, { transparent: true, toCache: true, optionsJson });
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
        { aspectRatio: aspect, seconds: 6, fps: 30, background, toCache: true, optionsJson },
        setProgress
      );
      await share(uri, 'video/mp4');
    });

  const file = (format: MeshFormat) => {
    const warnings = exportWarnings(mesh, format);
    const go = () =>
      run(format, async () => {
        const uri = await exportModelFile(modelUri, projectName, format, optionsJson);
        await share(uri);
      });
    if (warnings.length) {
      Alert.alert(format.toUpperCase(), warnings.map((w) => t(w)).join('\n'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('model3d.export.continue'), onPress: () => void go() },
      ]);
    } else {
      void go();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
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
          <Text style={styles.section}>{t('model3d.export.fileTitle')}</Text>
          {(mesh.points ? (['ply'] as MeshFormat[]) : LOCAL_FORMATS).map((f) => (
            <Row key={f} busy={busy} progress={progress} cancelLabel={t('common.cancel')} k={f} icon="cube-outline" title={f.toUpperCase()} sub={t(EXPORT_FORMATS[f].useKey)} onPress={() => file(f)} />
          ))}
          <Text style={styles.hint}>{t('model3d.export.videoHint')}</Text>
        </Pressable>
      </Pressable>
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
    padding: 16,
    paddingBottom: 32,
    gap: 4,
  },
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
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 16, marginTop: 10 },
});
