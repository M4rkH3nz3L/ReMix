import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { describeCommand } from '@/lib/commands';
import type { EventActor } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { loadVersions, saveVersions, type ProjectVersion } from '@/lib/storage';
import { compareProjects } from '@/lib/versionDiff';
import { useEditorStore } from '@/store/editorStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** ki végezte a műveletet — felhasználó / AI / rendszer */
const ACTOR_ICON: Record<EventActor, IoniconName> = {
  user: 'person-outline',
  ai: 'sparkles',
  system: 'settings-outline',
};
const ACTOR_COLOR: Record<EventActor, string> = {
  user: palette.textDim,
  ai: palette.accent,
  system: palette.textDim,
};

/** ISO → HH:MM (rövid idő a bejegyzéshez) */
function shortTime(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : '';
}

/**
 * 🕓 Szerkesztési előzmények (#38): a művelet-napló emberi nyelven, KI végezte
 * (felhasználó / AI) jelzéssel. Read-only áttekintés — „mi történt, mit csinált
 * az AI". A vissza/előre a transport-sávon marad.
 */
export function HistoryModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const events = useEditorStore((s) => s.events);
  const projectId = useEditorStore((s) => s.project?.id);
  const restore = useEditorStore((s) => s.restoreProject);
  const data = [...events].reverse(); // legújabb elöl
  const [versions, setVersions] = useState<ProjectVersion[]>([]);

  // 🕓 a mentett verziók betöltése a modal megnyitásakor (async → nem sync setState)
  useEffect(() => {
    if (visible && projectId) {
      loadVersions(projectId).then(setVersions).catch(() => setVersions([]));
    }
  }, [visible, projectId]);

  const saveCurrentVersion = () => {
    const p = useEditorStore.getState().project;
    if (!p) {
      return;
    }
    const v: ProjectVersion = {
      id: makeId('ver'),
      name: t('editor.versions.defaultName', { n: versions.filter((x) => x.kind !== 'auto').length + 1 }),
      at: new Date().toISOString(),
      project: p,
      kind: 'manual',
    };
    const next = [...versions, v];
    setVersions(next);
    saveVersions(p.id, next).catch(() => {});
  };

  // 📑 verzió duplikálása → új (kézi) verzió-bejegyzés ugyanabból az állapotból
  const duplicateVersion = (v: ProjectVersion) => {
    if (!projectId) {
      return;
    }
    const copy: ProjectVersion = {
      id: makeId('ver'),
      name: `${v.name || t('editor.versions.autoLabel')} ${t('editor.versions.copySuffix')}`,
      at: new Date().toISOString(),
      project: v.project,
      kind: 'manual',
    };
    const next = [...versions, copy];
    setVersions(next);
    saveVersions(projectId, next).catch(() => {});
  };

  // 🔍 összehasonlítás a JELENLEGI állapottal (mi változott a pillanatkép óta)
  const compareVersion = (v: ProjectVersion) => {
    const cur = useEditorStore.getState().project;
    if (!cur) {
      return;
    }
    const d = compareProjects(v.project, cur);
    Alert.alert(
      t('editor.versions.compareTitle'),
      t('editor.versions.compareBody', {
        durA: d.durationA,
        durB: d.durationB,
        clipsA: d.clipsA,
        clipsB: d.clipsB,
        added: d.added,
        removed: d.removed,
        changed: d.changed,
      })
    );
  };

  const restoreVersion = (v: ProjectVersion) => {
    Alert.alert(t('editor.versions.restoreTitle'), t('editor.versions.restoreConfirm', { name: v.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('editor.versions.restore'),
        onPress: () => {
          restore(v.project);
          onClose();
        },
      },
    ]);
  };

  const deleteVersion = (v: ProjectVersion) => {
    const next = versions.filter((x) => x.id !== v.id);
    setVersions(next);
    if (projectId) {
      saveVersions(projectId, next).catch(() => {});
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.grabber} />

          {/* 🕓 Verziók (Phase 5.2): névvel mentett pillanatképek + visszaállítás */}
          <View style={styles.versionHead}>
            <Text style={styles.title}>{t('editor.versions.title')}</Text>
            <Pressable style={styles.saveBtn} onPress={saveCurrentVersion} hitSlop={6}>
              <Ionicons name="bookmark-outline" size={14} color={palette.accent} />
              <Text style={styles.saveBtnText}>{t('editor.versions.save')}</Text>
            </Pressable>
          </View>
          {versions.length === 0 ? (
            <Text style={styles.empty}>{t('editor.versions.empty')}</Text>
          ) : (
            [...versions].reverse().map((v) => (
              <View style={styles.row} key={v.id}>
                <Ionicons
                  name={v.kind === 'auto' ? 'sync-outline' : 'bookmark'}
                  size={15}
                  color={v.kind === 'auto' ? palette.textDim : palette.accent}
                />
                <Text style={styles.label} numberOfLines={1}>
                  {v.kind === 'auto' ? t('editor.versions.autoLabel') : v.name}
                </Text>
                <Text style={styles.time}>{shortTime(v.at)}</Text>
                <Pressable onPress={() => compareVersion(v)} hitSlop={8}>
                  <Ionicons name="git-compare-outline" size={15} color={palette.textDim} />
                </Pressable>
                <Pressable onPress={() => duplicateVersion(v)} hitSlop={8}>
                  <Ionicons name="copy-outline" size={15} color={palette.textDim} />
                </Pressable>
                <Pressable onPress={() => restoreVersion(v)} hitSlop={8}>
                  <Text style={styles.action}>{t('editor.versions.restore')}</Text>
                </Pressable>
                <Pressable onPress={() => deleteVersion(v)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={14} color={palette.danger} />
                </Pressable>
              </View>
            ))
          )}

          <Text style={styles.title}>{t('editor.history.title')}</Text>
          {data.length === 0 ? (
            <Text style={styles.empty}>{t('editor.history.empty')}</Text>
          ) : (
            <FlatList
              data={data}
              keyExtractor={(e) => e.id}
              style={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => (
                <View style={styles.row}>
                  <Ionicons name={ACTOR_ICON[item.actor]} size={15} color={ACTOR_COLOR[item.actor]} />
                  <Text style={styles.label} numberOfLines={1}>
                    {describeCommand(item.command)}
                  </Text>
                  {index === 0 ? (
                    <Text style={styles.current}>{t('editor.history.current')}</Text>
                  ) : null}
                  <Text style={styles.time}>{shortTime(item.at)}</Text>
                </View>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
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
  title: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '800',
  },
  empty: {
    color: palette.textDim,
    fontSize: 13,
    paddingVertical: 16,
    textAlign: 'center',
  },
  list: {
    maxHeight: 400,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  label: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
  },
  current: {
    color: palette.accent,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  time: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  versionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  saveBtnText: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  action: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});
