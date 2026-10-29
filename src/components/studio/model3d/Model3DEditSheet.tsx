import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { formatLength } from '@/lib/model3d';
import { setEnvironment } from '@/lib/model3dDoc';
import { cutRange, modelRotation, resetRotation, rotate90, type RotationAxis, type SimplifyLevel } from '@/lib/model3dLook';
import { DEFAULT_STORAGE_FORMAT, STORAGE_FORMATS, storedFormatFor } from '@/lib/model3dExport';
import type { MeshFormat, Model3DDoc, Model3DEnvironmentPreset, Model3DMesh } from '@/types/model3d';

const PRESETS: Model3DEnvironmentPreset[] = ['studio', 'outdoor', 'night'];
const AXES: RotationAxis[] = ['x', 'y', 'z'];
/** a vágósík léptetése (méter) */
const CUT_STEP = 0.005;

/**
 * ✏️ A 3D-modell szerkesztése: 🔄 forgatás 90°-onként (talpra állítás), 💡 fény-preset +
 * fényerő, ✂️ padló levágása (élő vágósík a nézőben) és 🔻 egyszerűsítés. A forgatás és a
 * fény NEM roncsoló (a dokumentumban él, a kivitel is azt adja); a levágás és az
 * egyszerűsítés új hálót készít (visszavonható csere). A lap alul ül, a néző fölötte látszik.
 */
export function Model3DEditSheet({
  visible,
  onClose,
  doc,
  mesh,
  onDoc,
  onCutPreview,
  onProcess,
  onBackground,
  onStorageFormat,
}: {
  /** 🗄️ a tárolási formátum váltása (a jelenlegi modell átalakításával) */
  onStorageFormat: (format: MeshFormat) => Promise<void>;
  /** a háttér körbeléptetése (sötét / világos / átlátszó …) */
  onBackground: () => void;
  visible: boolean;
  onClose: () => void;
  doc: Model3DDoc;
  mesh: Model3DMesh;
  /** a módosított dokumentum (a command buson, címkével) */
  onDoc: (next: Model3DDoc, label: string) => void;
  /** a vágósík élő előnézete a nézőben (null → rejtett) */
  onCutPreview: (y: number | null) => void;
  /** ✂️/🔻 háló-feldolgozás (natív `processMesh`) */
  onProcess: (op: { cutY?: number; simplify?: SimplifyLevel }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const range = cutRange(mesh.bounds, modelRotation(doc));
  const [cutY, setCutY] = useState(range.min + (range.max - range.min) * 0.1);
  // ✂️/🔻 csak a nyers hálós szkennél (textúrás tárgynál, pontfelhőnél, parametrikus szobánál nem)
  const meshEditable = !mesh.textured && !mesh.points && doc.capture?.mode !== 'room';

  // a lap megnyitásakor a vágósík látszik (csak hálós szkennél), bezáráskor eltűnik
  useEffect(() => {
    onCutPreview(visible && meshEditable ? cutY : null);
  }, [visible, meshEditable, cutY, onCutPreview]);

  const run = async (op: { cutY?: number; simplify?: SimplifyLevel }) => {
    if (busy) return;
    setBusy(true);
    try {
      await onProcess(op);
    } finally {
      setBusy(false);
    }
  };

  const env = doc.environment;
  const exposureStep = (d: number) =>
    onDoc(setEnvironment(doc, { exposure: Math.max(0.25, Math.min(2, Math.round((env.exposure + d) * 4) / 4)) }), t('model3d.viewer.editExposure'));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()} accessibilityRole="button" accessibilityLabel={t('common.close')}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.head}>{t('model3d.viewer.edit')}</Text>

          <Text style={styles.section}>{t('model3d.viewer.editRotate')}</Text>
          <View style={styles.row}>
            {AXES.map((a) => (
              <Chip key={a} label={`↻ ${a.toUpperCase()}`} active={false} onPress={() => onDoc(rotate90(doc, a), t('model3d.viewer.editRotate'))} />
            ))}
            <Chip label={t('model3d.viewer.editReset')} active={false} onPress={() => onDoc(resetRotation(doc), t('model3d.viewer.editReset'))} />
          </View>

          <Text style={styles.section}>{t('model3d.viewer.editLight')}</Text>
          <View style={styles.row}>
            {PRESETS.map((p) => (
              <Chip key={p} label={t(`model3d.viewer.preset_${p}`)} active={env.preset === p} onPress={() => onDoc(setEnvironment(doc, { preset: p }), t('model3d.viewer.editLight'))} />
            ))}
            <Chip label={t('model3d.viewer.background')} active={false} onPress={onBackground} />
          </View>
          <View style={styles.stepper}>
            <Text style={styles.label}>{t('model3d.viewer.editExposure')}</Text>
            <Step icon="remove" label={`${t('model3d.viewer.editExposure')} −`} onPress={() => exposureStep(-0.25)} />
            <Text style={styles.value}>{Math.round(env.exposure * 100)}%</Text>
            <Step icon="add" label={`${t('model3d.viewer.editExposure')} +`} onPress={() => exposureStep(0.25)} />
          </View>

          {meshEditable ? (
            <>
              <Text style={styles.section}>{t('model3d.viewer.editCut')}</Text>
              <Text style={styles.hint}>{t('model3d.viewer.editCutHint')}</Text>
              <View style={styles.stepper}>
                <Step icon="chevron-down" label={`${t('model3d.viewer.editCut')} −`} onPress={() => setCutY((y) => Math.max(range.min, y - CUT_STEP))} />
                <Text style={styles.value}>{formatLength(cutY - range.min)}</Text>
                <Step icon="chevron-up" label={`${t('model3d.viewer.editCut')} +`} onPress={() => setCutY((y) => Math.min(range.max, y + CUT_STEP))} />
                <Chip label={t('model3d.viewer.editCutApply')} active onPress={() => void run({ cutY })} />
              </View>

              <Text style={styles.section}>{t('model3d.viewer.editSimplify')}</Text>
              <Text style={styles.hint}>{t('model3d.viewer.editSimplifyHint', { tris: mesh.triangles.toLocaleString() })}</Text>
              <View style={styles.row}>
                <Chip label={t('model3d.viewer.editSimplifyLight')} active={false} onPress={() => void run({ simplify: 'light' })} />
                <Chip label={t('model3d.viewer.editSimplifyStrong')} active={false} onPress={() => void run({ simplify: 'strong' })} />
              </View>
            </>
          ) : (
            <Text style={styles.hint}>{t('model3d.viewer.editOnlyMesh')}</Text>
          )}

          <Text style={styles.section}>{t('model3d.storage.title')}</Text>
          <Text style={styles.hint}>
            {t('model3d.storage.current', { format: mesh.format.toUpperCase() })}
          </Text>
          <View style={styles.row}>
            {STORAGE_FORMATS.filter((f) => storedFormatFor(f, { textured: mesh.textured, points: !!mesh.points }) === f).map((f) => (
              <Chip
                key={f}
                label={f.toUpperCase()}
                active={(doc.storageFormat ?? DEFAULT_STORAGE_FORMAT) === f}
                onPress={() => {
                  if (busy) return;
                  setBusy(true);
                  void onStorageFormat(f).finally(() => setBusy(false));
                }}
              />
            ))}
          </View>

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.hint}>{t('model3d.viewer.editProcessing')}</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Step({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.step} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // átlátszó háttér: a néző (és a vágósík) a lap fölött látszik
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 8,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 4 },
  head: { color: palette.text, fontSize: 17, fontWeight: '800' },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
  },
  label: { color: palette.text, fontSize: 14, fontWeight: '600', marginRight: 'auto' },
  value: { color: palette.text, fontSize: 15, fontWeight: '700', minWidth: 64, textAlign: 'center' },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 17 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
});
