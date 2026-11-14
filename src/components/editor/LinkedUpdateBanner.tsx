import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import { linkedAssets, relinkPlan, staleLinks, type StaleLink } from '@/lib/linkedAsset';
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
      const versions = new Map<string, string | null>();
      for (const a of linked) {
        const pid = a.source!.projectId;
        if (!versions.has(pid)) versions.set(pid, await sourceVersionOf(pid));
      }
      if (run !== checkRef.current) return;
      const cur = useEditorStore.getState().project;
      setStale(cur && linked.length > 0 ? staleLinks(cur, (pid) => versions.get(pid) ?? null) : []);
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
      const file = await withCancellableProgress(t('editor.linked.rendering', { name: source.name }), (report, signal) => renderMixdown(source, report, signal));
      const st = useEditorStore.getState();
      if (!file || !st.project) return;
      const plan = relinkPlan(st.project, link.asset.id, file);
      if (plan.commands.length === 0) return;
      st.applyBatch(plan.commands, 'user');
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
    ];
    return () => offs.forEach((off) => off());
  }, [check]);

  if (stale.length === 0) return null;
  const first = stale[0];
  const name = first.asset.source?.name ?? first.asset.name ?? '';
  return (
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
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.accent },
  text: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  btn: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#ffffff26' },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
