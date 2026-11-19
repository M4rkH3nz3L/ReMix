import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { canRemovePage } from '@/lib/imageProjectPages';
import type { ImageDoc } from '@/types/project';

/**
 * 🖼️📄 Galéria lap-strip (project mód): több kép → diavetítés/lapozható megosztás. VISELKEDÉS-
 * MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: a lapok bélyegképe + új lap, és az aktív lap
 * mozgatása / duplikálása / törlése — minden művelet a body-ban (command-bus), itt csak a gombok.
 */
export function PageStrip({
  pages,
  activeId,
  activeIdx,
  onSelect,
  onAdd,
  onMove,
  onDuplicate,
  onDelete,
}: {
  pages: ImageDoc[];
  activeId: string | undefined;
  activeIdx: number;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.pageStrip}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pageStripContent}
      >
        {pages.map((p, i) => {
          const active = p.id === activeId;
          return (
            <Pressable
              key={p.id}
              onPress={() => onSelect(p.id)}
              style={[styles.pageChip, active && styles.pageChipActive]}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} (${i + 1})`}
            >
              {p.thumbUri ?? p.renderedUri ? (
                <Image source={{ uri: p.thumbUri ?? p.renderedUri }} style={styles.pageThumb} resizeMode="cover" />
              ) : (
                <View style={styles.pageThumbEmpty}>
                  <Ionicons name="image-outline" size={16} color={palette.textDim} />
                </View>
              )}
              <Text maxFontSizeMultiplier={1.3} style={styles.pageChipNum}>{i + 1}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onAdd} style={styles.pageAdd} accessibilityRole="button" accessibilityLabel={t('common.add')}>
          <Ionicons name="add" size={22} color={palette.accent} />
        </Pressable>
      </ScrollView>
      <View style={styles.pageActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('studio.image.a11y.pagePrev')} onPress={() => onMove(-1)} disabled={activeIdx <= 0} hitSlop={6} style={styles.pageActionBtn}>
          <Ionicons name="chevron-back" size={16} color={activeIdx <= 0 ? palette.border : palette.textDim} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('studio.image.a11y.pageNext')}
          onPress={() => onMove(1)}
          disabled={activeIdx < 0 || activeIdx >= pages.length - 1}
          hitSlop={6}
          style={styles.pageActionBtn}
        >
          <Ionicons
            name="chevron-forward"
            size={16}
            color={activeIdx < 0 || activeIdx >= pages.length - 1 ? palette.border : palette.textDim}
          />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('studio.image.a11y.pageDuplicate')} onPress={onDuplicate} hitSlop={6} style={styles.pageActionBtn}>
          <Ionicons name="copy-outline" size={15} color={palette.textDim} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('studio.image.a11y.pageDelete')}
          onPress={onDelete}
          disabled={!canRemovePage({ imageDocs: pages })}
          hitSlop={6}
          style={styles.pageActionBtn}
        >
          <Ionicons
            name="trash-outline"
            size={15}
            color={canRemovePage({ imageDocs: pages }) ? palette.textDim : palette.border}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  pageStripContent: { alignItems: 'center', gap: 8, paddingRight: 8 },
  pageChip: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: palette.border,
    overflow: 'hidden',
    backgroundColor: '#0d0f16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageChipActive: { borderColor: palette.accent },
  pageThumb: { width: '100%', height: '100%' },
  pageThumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageChipNum: {
    position: 'absolute',
    bottom: 1,
    right: 3,
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    textShadowColor: '#000',
    textShadowRadius: 2,
  },
  pageAdd: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pageActionBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
