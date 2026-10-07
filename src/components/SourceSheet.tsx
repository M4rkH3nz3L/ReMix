import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { projectKind } from '@/lib/projectUtils';
import { assetInUse, pickSourceAsset, supportedSourceKinds, type SourceKind } from '@/lib/projectSource';
import { formatBytes } from '@/lib/storageQuota';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Asset } from '@/types/project';

const KIND_ICON: Record<SourceKind, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  image: 'image',
  audio: 'musical-notes',
};

/**
 * 🗂️ A projekt FORRÁS-mappája (source bin) — minden stúdióban UGYANÚGY. A
 * `project.assets` böngészése + támogatott fájlok importja (a fajta szerinti
 * pickerrel) + a NEM használt forrás eltávolítása. Minden a command-buson megy
 * (ADD_ASSET / REMOVE_ASSET → undo). Az `onInsert` opcionális: ha a szerkesztő
 * tudja fogadni, a forrás egy koppintással a szerkesztő-felületre kerül.
 */
export function SourceSheet({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert?: (asset: Asset) => void;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  if (!project) {
    return null;
  }
  const assets = project.assets;
  const kinds = supportedSourceKinds(projectKind(project));

  const importOne = (sk: SourceKind) => {
    pickSourceAsset(sk)
      .then((asset) => {
        if (asset) {
          useEditorStore.getState().dispatch({ type: 'ADD_ASSET', asset }, 'user');
        }
      })
      .catch(() => {});
  };

  const meta = (a: Asset): string => {
    const parts = [t(`studio.kind.${a.kind}`)];
    if (a.duration) {
      parts.push(formatTime(a.duration));
    }
    if (a.size) {
      parts.push(formatBytes(a.size));
    }
    return parts.join(' · ');
  };

  return (
    <StudioSheet title={t('source.title')} icon="folder-open" onClose={onClose}>
      <Text style={styles.hint}>{t('source.hint')}</Text>
      <View style={styles.importRow}>
        {kinds.map((sk) => (
          <Pressable key={sk} style={styles.importBtn} onPress={() => importOne(sk)}>
            <Ionicons name="add" size={14} color={palette.accent} />
            <Text style={styles.importBtnText}>{t(`studio.kind.${sk}`)}</Text>
          </Pressable>
        ))}
      </View>

      {assets.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={30} color={palette.border} />
          <Text style={styles.emptyText}>{t('source.empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {assets.map((a) => {
            const used = assetInUse(project, a);
            return (
              <View key={a.id} style={styles.item}>
                <Ionicons name={KIND_ICON[a.kind]} size={16} color={palette.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {a.name ?? a.kind}
                  </Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {meta(a)}
                    {used ? ` · ${t('source.inUse')}` : ''}
                  </Text>
                </View>
                {onInsert ? (
                  <Pressable
                    onPress={() => onInsert(a)}
                    hitSlop={8}
                    style={styles.itemAction}
                    accessibilityRole="button"
                    accessibilityLabel={t('source.insert')}
                  >
                    <Ionicons name="add-circle-outline" size={22} color={palette.accent} />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() =>
                    useEditorStore.getState().dispatch({ type: 'REMOVE_ASSET', assetId: a.id }, 'user')
                  }
                  disabled={used}
                  hitSlop={8}
                  style={styles.itemAction}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                >
                  <Ionicons name="trash-outline" size={18} color={used ? palette.border : palette.textDim} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 16 },
  importRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.surfaceHigh,
  },
  importBtnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 26 },
  emptyText: { color: palette.textDim, fontSize: 12 },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  itemName: { color: palette.text, fontSize: 14, fontWeight: '600' },
  itemMeta: { color: palette.textDim, fontSize: 11, marginTop: 1 },
  itemAction: { padding: 2 },
});
