import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ProjectThumb } from '@/components/studio/ProjectThumb';
import { PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { lookOptionsJson } from '@/lib/model3dLook';
import { currentModel } from '@/lib/model3dMedia';
import {
  cancelModelRender,
  model3dRenderAvailable,
  renderModelStill,
  renderModelTurntable,
  turntableAvailable,
} from '@/lib/model3dRenderClient';
import { remix3dErrorKey } from '@/lib/remix3dNative';
import { listProjects, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { ProjectMeta } from '@/types/project';

/** a forgó videó hossza a videóban (mp) */
const TURNTABLE_SECONDS = 6;

/**
 * 🧊→🎬 „Saját 3D-modelljeim” a videószerkesztőben: a user LiDAR-szkenjei (a 3D
 * Stúdió projektjei) állóképként (átlátszó PNG → overlay-forma, árnyékkal — mint a
 * 3D-matricák) vagy 360°-os forgó videóként (MP4 → PiP-klip) a lejátszófejhez. A kép/
 * videó a VIDEÓ-projekt saját mappájába renderelődik → a videó önálló marad (a 3D-
 * projekt törlése nem viszi el), és a felhő-render is látja.
 */
/** `onInserted` az ÁLLÓKÉP (overlay-forma) beszúrása után hív — pl. a Forma panel nyitásához */
export function My3DModelsSection({ onInserted }: { onInserted?: () => void }) {
  const { t } = useTranslation();
  const [models, setModels] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    if (!model3dRenderAvailable()) {
      return;
    }
    void listProjects()
      .then((metas) => setModels(metas.filter((m) => m.kind === 'model3d')))
      .catch(() => setModels([]));
  }, []);

  if (!model3dRenderAvailable() || models.length === 0) {
    return null;
  }

  /** a modell-fájl + a 3D-stúdióban beállított megjelenés (forgatás, fény) */
  const modelOf = async (meta: ProjectMeta): Promise<{ uri: string; optionsJson: string } | null> => {
    const p = await loadProject(meta.id);
    const uri = p ? (currentModel(p.model3d?.meshes, p.assets)?.asset.uri ?? null) : null;
    return p && uri ? { uri, optionsJson: lookOptionsJson(p.model3d) } : null;
  };

  const insertStill = async (meta: ProjectMeta) => {
    const model = await modelOf(meta);
    if (!model) {
      Alert.alert(t('panels.sticker.my3dTitle'), t('panels.sticker.my3dEmpty'));
      return;
    }
    const uri = await withProgress(t('panels.sticker.my3dRendering'), () => renderModelStill(model.uri, { transparent: true, optionsJson: model.optionsJson }));
    const { playhead, addClip, selectClip, project } = useEditorStore.getState();
    const id = makeId('clip');
    // a négyzetes PNG a vásznon is négyzet maradjon: h = w × (vászon-szélesség / -magasság)
    // (eddig fixen 9:16-ra számolt → 16:9-es projektben torzult)
    const [aw, ah] = (project?.aspectRatio ?? '9:16').split(':').map(Number);
    const canvasRatio = aw > 0 && ah > 0 ? aw / ah : 9 / 16;
    const w = Math.min(0.4, 0.8 / canvasRatio);
    addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: playhead,
        duration: 4,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.45 },
        w,
        h: w * canvasRatio,
        fill: 'transparent',
        imageUri: uri,
        // mint a 3D-matricáknál: az árnyéktól „ül” a jelenetben
        shadow: true,
      },
      { id: makeId('ast'), kind: 'image', uri, provider: 'local', name: meta.name }
    );
    selectClip(id);
    onInserted?.();
  };

  const insertTurntable = async (meta: ProjectMeta) => {
    const model = await modelOf(meta);
    if (!model) {
      Alert.alert(t('panels.sticker.my3dTitle'), t('panels.sticker.my3dEmpty'));
      return;
    }
    const aspectRatio = useEditorStore.getState().project?.aspectRatio ?? '9:16';
    const { uri, seconds } = await withProgress(
      t('panels.sticker.my3dRenderingVideo'),
      (report) =>
        renderModelTurntable(model.uri, { aspectRatio, seconds: TURNTABLE_SECONDS, optionsJson: model.optionsJson }, (ratio) =>
          report({ phase: t('panels.sticker.my3dRenderingVideo'), ratio })
        ),
      cancelModelRender
    );
    const { playhead, addClip, selectClip } = useEditorStore.getState();
    const id = makeId('clip');
    addClip(
      'pip',
      {
        kind: 'video',
        id,
        start: playhead,
        duration: seconds,
        uri,
        trimIn: 0,
        sourceDuration: seconds,
        speed: 1,
        volume: 0,
        filterId: 'none',
      },
      { id: makeId('ast'), kind: 'video', uri, provider: 'local', name: meta.name, duration: seconds }
    );
    // a PiP-videóklip kijelölve marad (a Forma panel csak az állóképhez való)
    selectClip(id);
  };

  const choose = (meta: ProjectMeta) => {
    const guard = (fn: () => Promise<void>) => () => {
      fn().catch((e) => {
        const k = remix3dErrorKey(e);
        if (k !== 'model3d.error.cancelled') {
          Alert.alert(t('panels.sticker.my3dTitle'), t(k));
        }
      });
    };
    Alert.alert(meta.name, t('panels.sticker.my3dHow'), [
      { text: t('panels.sticker.my3dStill'), onPress: guard(() => insertStill(meta)) },
      ...(turntableAvailable()
        ? [{ text: t('panels.sticker.my3dTurntable', { seconds: TURNTABLE_SECONDS }), onPress: guard(() => insertTurntable(meta)) }]
        : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  return (
    <PanelSection title={t('panels.sticker.my3dTitle')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {models.map((m) => (
          <Pressable key={m.id} style={styles.cell} onPress={() => choose(m)} accessibilityRole="button">
            <View style={styles.thumb}>
              <ProjectThumb id={m.id} kind="model3d" version={m.updatedAt} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {m.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.hint}>{t('panels.sticker.my3dHint')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 4 },
  cell: { width: 84, alignItems: 'center', gap: 4 },
  thumb: { width: 76, height: 76, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.surfaceHigh },
  name: { color: palette.text, fontSize: 11, fontWeight: '600' },
  hint: { color: palette.textDim, fontSize: 11, lineHeight: 15, marginTop: 6 },
});
