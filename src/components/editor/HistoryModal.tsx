import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { describeCommand } from '@/lib/commands';
import type { EventActor } from '@/lib/commands';
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
  const data = [...events].reverse(); // legújabb elöl

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.grabber} />
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
});
