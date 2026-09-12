import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { loadProject } from '@/lib/storage';
import type { Project } from '@/types/project';

/** egy származási-lánc elem: a projekt neve/id-ja + elérhető-e helyben */
interface LineageNode {
  id: string;
  name: string;
  available: boolean;
}

const MAX_DEPTH = 12;

/**
 * 🔀 Remix Graph (#34) — a projekt SZÁRMAZÁSI lánca: „honnan jött ez?". A
 * `project.remixOf` hivatkozást követve, helyi tárból (loadProject) bejárva
 * felépíti az ős-láncot (jelenlegi → szülő → nagyszülő …). Kizárólag
 * szerkesztő-oldali (nem renderelődik); a kereszt-user remix-gráf külön, felhős.
 */
export function RemixGraphModal({
  visible,
  onClose,
  project,
}: {
  visible: boolean;
  onClose: () => void;
  project: Project | null;
}) {
  const { t } = useTranslation();
  const [chain, setChain] = useState<LineageNode[]>([]);

  useEffect(() => {
    if (!visible || !project) {
      return;
    }
    let cancelled = false;
    // a láncot aszinkron építjük (loadProject), ciklus- és mélység-védelemmel
    const walk = async () => {
      const out: LineageNode[] = [];
      const seen = new Set<string>([project.id]);
      let ref = project.remixOf ?? null;
      for (let i = 0; i < MAX_DEPTH && ref; i++) {
        if (seen.has(ref.projectId)) {
          break; // ciklus
        }
        seen.add(ref.projectId);
        const loaded = await loadProject(ref.projectId).catch(() => null);
        out.push({ id: ref.projectId, name: loaded?.name ?? ref.name, available: !!loaded });
        ref = loaded?.remixOf ?? null;
      }
      if (!cancelled) {
        setChain(out);
      }
    };
    void walk();
    return () => {
      cancelled = true;
    };
  }, [visible, project]);

  const openProject = (id: string) => {
    onClose();
    router.push(`/editor/${id}`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t('editor.remixGraph.title')}</Text>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {/* a jelenlegi projekt a lánc alja („itt vagy") */}
            <View style={[styles.row, styles.current]}>
              <Text style={styles.dot}>●</Text>
              <Text style={styles.name} numberOfLines={1}>
                {project?.name ?? '…'}
              </Text>
              <Text style={styles.hereTag}>{t('editor.remixGraph.current')}</Text>
            </View>
            {chain.length === 0 ? (
              <Text style={styles.empty}>{t('editor.remixGraph.empty')}</Text>
            ) : (
              chain.map((n, i) => (
                <View key={`${n.id}-${i}`}>
                  <Text style={styles.arrow}>↑</Text>
                  <Pressable
                    style={styles.row}
                    disabled={!n.available}
                    onPress={() => openProject(n.id)}
                  >
                    <Text style={styles.dot}>○</Text>
                    <Text
                      style={[styles.name, !n.available ? styles.nameOff : null]}
                      numberOfLines={1}
                    >
                      🔀 {n.name}
                    </Text>
                    <Text style={styles.action}>
                      {n.available ? t('editor.remixGraph.open') : t('editor.remixGraph.unavailable')}
                    </Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 6,
  },
  title: { color: palette.text, fontSize: 18, fontWeight: '800' },
  list: { maxHeight: 420 },
  empty: { color: palette.textDim, fontSize: 13, paddingVertical: 12, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  current: { borderColor: palette.accent },
  dot: { color: palette.accent, fontSize: 12 },
  name: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '600' },
  nameOff: { color: palette.textDim },
  hereTag: {
    color: palette.accent,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  action: { color: palette.accent, fontSize: 12, fontWeight: '700' },
  arrow: { color: palette.textDim, fontSize: 14, textAlign: 'center', marginVertical: 2 },
});
