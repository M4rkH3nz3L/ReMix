import { Ionicons } from '@expo/vector-icons';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ADDABLE, LAYOUT_PRESETS, SOURCE_ICON } from '@/components/live/studio/liveStudioConstants';
import { shared } from '@/components/live/studio/liveStudioStyles';
import { palette } from '@/constants/editor';
import { removeSource, reorderSource, sortedSources, toggleSourceVisible, updateSource } from '@/lib/liveDoc';
import type { LiveDoc, LiveScene, LiveSource, LiveSourceKind } from '@/types/live';

export interface SourcesPanelProps {
  live: LiveDoc;
  scene: LiveScene | undefined;
  selected: LiveSource | null;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  adding: boolean;
  setAdding: Dispatch<SetStateAction<boolean>>;
  commit: (next: LiveDoc, label?: string) => void;
  onAddSource: (kind: LiveSourceKind) => void;
}

/** 🧱 forrás-lista: hozzáadás, láthatóság, sorrend, törlés + a kijelölt forrás gyors elrendezése */
export function SourcesPanel({
  live,
  scene,
  selected,
  selectedId,
  setSelectedId,
  adding,
  setAdding,
  commit,
  onAddSource,
}: SourcesPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* forrás-lista */}
      <View style={shared.rowBetween}>
        <Text style={shared.sectionLabel}>{t('live.studio.sources', { defaultValue: 'Sources' })}</Text>
        <Pressable onPress={() => setAdding((v) => !v)} style={shared.addSourceBtn} hitSlop={8}>
          <Ionicons name={adding ? 'close' : 'add'} size={16} color={palette.accent} />
          <Text style={shared.addSourceText}>{t('live.studio.addSource', { defaultValue: 'Source' })}</Text>
        </Pressable>
      </View>

      {adding && (
        <View style={styles.addGrid}>
          {ADDABLE.map((k) => (
            <Pressable key={k} onPress={() => onAddSource(k)} style={styles.addTile}>
              <Ionicons name={SOURCE_ICON[k]} size={20} color={palette.text} />
              <Text style={styles.addTileText}>{t(`live.studio.source.${k}`, { defaultValue: k })}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {scene &&
        sortedSources(scene)
          .slice()
          .reverse()
          .map((src) => {
            const sel = src.id === selectedId;
            return (
              <Pressable
                key={src.id}
                onPress={() => setSelectedId(sel ? null : src.id)}
                style={[styles.srcRow, sel && styles.srcRowSel]}
              >
                <Pressable onPress={() => commit(toggleSourceVisible(live, scene.id, src.id))} hitSlop={8}>
                  <Ionicons
                    name={src.visible ? 'eye' : 'eye-off'}
                    size={18}
                    color={src.visible ? palette.text : palette.textDim}
                  />
                </Pressable>
                <Ionicons name={SOURCE_ICON[src.kind]} size={16} color={palette.textDim} />
                <Text style={styles.srcRowLabel} numberOfLines={1}>
                  {src.label || src.kind}
                </Text>
                <Pressable onPress={() => commit(reorderSource(live, scene.id, src.id, 'up'))} hitSlop={6}>
                  <Ionicons name="chevron-up" size={18} color={palette.textDim} />
                </Pressable>
                <Pressable onPress={() => commit(reorderSource(live, scene.id, src.id, 'down'))} hitSlop={6}>
                  <Ionicons name="chevron-down" size={18} color={palette.textDim} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    commit(removeSource(live, scene.id, src.id));
                    if (selectedId === src.id) setSelectedId(null);
                  }}
                  hitSlop={6}
                >
                  <Ionicons name="trash-outline" size={17} color={palette.danger} />
                </Pressable>
              </Pressable>
            );
          })}

      {/* kijelölt forrás — gyors elrendezés */}
      {selected && scene && (
        <View style={styles.inspector}>
          <Text style={styles.inspectorTitle}>{selected.label || selected.kind}</Text>
          <View style={styles.presetRow}>
            {LAYOUT_PRESETS.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => commit(updateSource(live, scene.id, selected.id, { transform: p.t }))}
                style={styles.presetBtn}
              >
                <Ionicons name={p.icon} size={18} color={palette.text} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addTile: {
    width: '23%',
    aspectRatio: 1,
    backgroundColor: palette.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addTileText: { color: palette.text, fontSize: 11, fontWeight: '600' },

  srcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  srcRowSel: { borderColor: palette.accent },
  srcRowLabel: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },

  inspector: { backgroundColor: palette.surface, borderRadius: 12, padding: 12, gap: 10 },
  inspectorTitle: { color: palette.text, fontSize: 14, fontWeight: '800' },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetBtn: {
    width: 44,
    height: 40,
    backgroundColor: palette.bg,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
