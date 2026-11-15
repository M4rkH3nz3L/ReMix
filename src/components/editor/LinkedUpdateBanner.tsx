import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { clearCswcrLog, cswcrStats, logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { registerDevAction } from '@/lib/devActions';
import { RenderStage, renderOnDevice } from '@/components/studio/image/RenderStage';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { linkedAssets, relinkPlan, staleLinks, stillRelinkCommands, STILL_OUTPUT, type AssetSource, type StaleLink } from '@/lib/linkedAsset';
import { loadSourceProject, renderMixdown, sourceVersionOf } from '@/lib/linkedAssetClient';
import { logCaught } from '@/lib/logCaught';
import { isRenderCancelledError } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import { withCancellableProgress } from '@/store/progressStore';

/**
 * 🔗 „Frissítés elérhető” sáv (ReMix.md 5.3 · SC2 · AUDIO-PROD C2): a videó-projekt hivatkozott
 * (linkelt) assetjei mögött a forrás hang-projekt újabb verziója van. A csere EGY koppintás: a
 * forrás mixdownja a telefonon renderelődik (preview = export, felhő nélkül), és egy köteg cseréli
 * a fájlt + a verziót + a klipek hosszát (`relinkPlan`) — egy visszavonás. Néma automatikus csere
 * nincs: a felhasználó dönt (a vágás az új hosszhoz igazodhat; a rövidült klipeket jelezzük).
 */
export function LinkedUpdateBanner() {
  const { t } = useTranslation();
  const projectId = useEditorStore((s) => s.project?.id);
  const assets = useEditorStore((s) => s.project?.assets);
  const [stale, setStale] = useState<StaleLink[]>([]);
  const [busy, setBusy] = useState(false);
  const checkRef = useRef(0);

  const check = useCallback(() => {
    const run = ++checkRef.current;
    void (async () => {
      // a tárolóból olvasunk → az állapot sosem az effekt szinkron futásában változik
      await Promise.resolve();
      const project = useEditorStore.getState().project;
      const linked = project ? linkedAssets(project) : [];
      // a kép-hivatkozás lapra pontos (egy kép-projektnek több lapja lehet)
      const keyOf = (src: Pick<AssetSource, 'projectId' | 'output' | 'docId'>) => `${src.projectId}|${src.output}|${src.docId ?? ''}`;
      const versions = new Map<string, string | null>();
      for (const a of linked) {
        const key = keyOf(a.source!);
        if (!versions.has(key)) versions.set(key, await sourceVersionOf(a.source!.projectId, a.source!));
      }
      if (run !== checkRef.current) return;
      const cur = useEditorStore.getState().project;
      setStale(cur && linked.length > 0 ? staleLinks(cur, (_pid, src) => versions.get(keyOf(src)) ?? null) : []);
    })();
  }, []);

  // megnyitáskor és a hang-projektből visszatérve (fókusz), meg ha az assetek változtak (csere után)
  useEffect(check, [check, projectId, assets]);
  useFocusEffect(check);

  const update = async (link: StaleLink) => {
    if (busy) return;
    const source = await loadSourceProject(link.asset.source!.projectId);
    if (!source) return;
    setBusy(true);
    try {
      if (link.asset.source!.output === STILL_OUTPUT) {
        await updateStill(link, source);
        return;
      }
      const file = await withCancellableProgress(t('editor.linked.rendering', { name: source.name }), (report, signal) => renderMixdown(source, report, signal));
      const st = useEditorStore.getState();
      if (!file || !st.project) return;
      const plan = relinkPlan(st.project, link.asset.id, file);
      if (plan.commands.length === 0) return;
      st.applyBatch(plan.commands, 'user');
      // 📊 CSWCR: a „Frissítés elérhető" elfogadása (7.4 frissítés-elfogadás)
      logCswcr({ type: 'relink', projectId: st.project.id, kind: studioKindOf(st.project.kind) });
      if (plan.shortened.length > 0) {
        Alert.alert(t('editor.linked.title'), t('editor.linked.shortened', { count: plan.shortened.length }));
      }
    } catch (caught) {
      logCaught('components/editor/LinkedUpdateBanner.tsx:update', caught);
      if (!isRenderCancelledError(caught)) Alert.alert(t('editor.linked.title'), (caught as Error).message);
    } finally {
      setBusy(false);
      check();
    }
  };

  /** 🖼️ CORE K2: a kép-lap új képe a telefonon (render-színpad), és a videóba ágyazott rétegek is */
  const updateStill = async (link: StaleLink, source: NonNullable<Awaited<ReturnType<typeof loadSourceProject>>>) => {
    const doc = source.imageDocs?.find((d) => d.id === link.asset.source!.docId);
    if (!doc) return;
    const uri = await renderOnDevice(doc, effectiveCanvas(doc).height, { format: 'png' });
    const st = useEditorStore.getState();
    if (!uri || !st.project) {
      Alert.alert(t('editor.linked.title'), t('studio.image.renderFailBody'));
      return;
    }
    const commands = stillRelinkCommands(st.project, link.asset.id, { uri, version: link.currentVersion }, doc);
    if (commands.length === 0) return;
    st.applyBatch(commands, 'user');
    logCswcr({ type: 'relink', projectId: st.project.id, kind: studioKindOf(st.project.kind) });
  };

  // 🧪 füstteszt: a sáv állapota és a frissítés gombja
  const staleRef = useRef(stale);
  staleRef.current = stale;
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    const offs = [
      registerDevAction('linked.stale', () => staleRef.current.map((s) => `${s.asset.id}:${s.currentVersion}`)),
      registerDevAction('linked.check', () => {
        check();
        return true;
      }),
      registerDevAction('linked.update', async () => {
        const first = staleRef.current[0];
        if (!first) return false;
        await updateRef.current(first);
        return true;
      }),
      // 📊 a CSWCR-mérőszámok a telefonon (a mérésnek)
      registerDevAction('cswcr.stats', () => cswcrStats()),
      registerDevAction('cswcr.clear', () => clearCswcrLog().then(() => true)),
    ];
    return () => offs.forEach((off) => off());
  }, [check]);

  // a kép-frissítés telefonos render-színpada (rejtett; a szerkesztő eltakarja)
  const stage = linkedAssets({ assets: assets ?? [] }).some((a) => a.source?.output === STILL_OUTPUT) ? <RenderStage /> : null;
  if (stale.length === 0) return stage;
  const first = stale[0];
  const name = first.asset.source?.name ?? first.asset.name ?? '';
  return (
    <>
    {stage}
    <View style={styles.bar} accessibilityRole="alert" testID="linked-update-banner">
      <Ionicons name="link" size={14} color="#fff" />
      <Text style={styles.text} maxFontSizeMultiplier={1.4} numberOfLines={2}>
        {stale.length > 1 ? t('editor.linked.availableMany', { name, count: stale.length - 1 }) : t('editor.linked.available', { name })}
      </Text>
      <Pressable
        onPress={() => void update(first)}
        disabled={busy}
        style={[styles.btn, busy && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={t('editor.linked.update')}
        accessibilityState={{ disabled: busy }}
        testID="linked-update-apply"
      >
        <Text style={styles.btnText}>{busy ? '…' : t('editor.linked.update')}</Text>
      </Pressable>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.accent },
  text: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  btn: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#ffffff26' },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
