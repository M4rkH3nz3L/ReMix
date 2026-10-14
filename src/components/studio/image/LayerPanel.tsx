import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LayerInspector } from '@/components/studio/image/LayerInspector';
import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import {
  duplicateLayer,
  layerIcon,
  layerLabel,
  removeLayer,
  reorderLayer,
  toggleLayerHidden,
  ungroup,
  updateGroup,
} from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import type { ImageDoc, ImageGroup, ImageLayer } from '@/types/project';

/**
 * 🎨 Réteg-panel (alsó lap) — a réteg-fa listája (sorrend/láthatóság/duplázás/
 * törlés) + a kijelölt réteg tulajdonság-szerkesztője (a megosztott
 * [LayerInspector](./LayerInspector.tsx): szín, betűméret, kitöltés, blend,
 * átlátszóság, kontúr/árnyék/glow). Minden módosítás a command-buson (undo).
 */
export function LayerPanel({
  doc,
  selectedId,
  onSelect,
  onAdd,
  commit,
  onClose,
  onOpenAdjust,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: ImageLayer['kind']) => void;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
  onOpenAdjust: () => void;
}) {
  const { t } = useTranslation();
  const layer = doc.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <StudioSheet
      title={t('studio.image.layersTitle')}
      icon="layers"
      onClose={onClose}
      footer={
        <View style={styles.addRow}>
          <AddChip icon="text" label={t('studio.imageTools.text')} onPress={() => onAdd('text')} />
          <AddChip icon="shapes" label={t('studio.imageTools.shape')} onPress={() => onAdd('shape')} />
          <AddChip icon="image" label={t('studio.imageTools.photo')} onPress={() => onAdd('photo')} />
          <AddChip icon="color-fill" label={t('studio.imageTools.fill')} onPress={() => onAdd('fill')} />
        </View>
      }
    >
      {/* réteg-lista (fölül a legfelső réteg) — 🗂️ csoportokba bucketelve */}
      <View style={{ gap: 6 }}>
        {(() => {
          const groupsById = new Map((doc.groups ?? []).map((g) => [g.id, g]));
          const seen = new Set<string>();
          const rows: ReactNode[] = [];
          for (const l of [...doc.layers].reverse()) {
            const g = l.groupId ? groupsById.get(l.groupId) : undefined;
            if (g && !seen.has(g.id)) {
              seen.add(g.id);
              rows.push(
                <GroupHeader
                  key={`g-${g.id}`}
                  doc={doc}
                  group={g}
                  commit={commit}
                  onSelect={onSelect}
                  t={t}
                />
              );
            }
            if (g?.collapsed) {
              continue; // összecsukva: a tag-sorok nem jelennek meg
            }
            rows.push(
              <LayerRow
                key={l.id}
                doc={doc}
                layer={l}
                indented={!!g}
                selected={l.id === selectedId}
                onSelect={onSelect}
                commit={commit}
                t={t}
              />
            );
          }
          return rows;
        })()}
      </View>

      {/* kijelölt réteg tulajdonságai — a megosztott inspector */}
      {layer ? (
        <View style={styles.inspector}>
          <Text style={styles.inspectorTitle}>{layerLabel(layer)}</Text>
          <LayerInspector doc={doc} layer={layer} commit={commit} onOpenAdjust={onOpenAdjust} />
        </View>
      ) : (
        <Text style={styles.hint}>{t('studio.image.selectHint')}</Text>
      )}
    </StudioSheet>
  );
}

function AddChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.addChip} onPress={onPress}>
      <Ionicons name={icon} size={16} color={palette.accent} />
      <Text style={styles.addChipText}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({
  icon,
  color = palette.textDim,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable hitSlop={8} onPress={onPress}>
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

/** egy réteg sora a listában (csoport-tag esetén behúzva). */
function LayerRow({
  doc,
  layer: l,
  indented,
  selected: sel,
  onSelect,
  commit,
  t,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  indented: boolean;
  selected: boolean;
  onSelect: (id: string | null) => void;
  commit: (next: ImageDoc, label?: string) => void;
  t: TFn;
}) {
  return (
    <Pressable
      onPress={() => onSelect(sel ? null : l.id)}
      style={[styles.layerRow, indented ? styles.layerIndent : null, sel ? styles.layerActive : null]}
    >
      <Text style={styles.layerIcon}>{layerIcon(l)}</Text>
      <Text style={[styles.layerName, l.hidden ? styles.hidden : null]} numberOfLines={1}>
        {layerLabel(l)}
      </Text>
      <IconBtn
        icon={l.hidden ? 'eye-off-outline' : 'eye-outline'}
        color={l.hidden ? palette.textDim : palette.text}
        onPress={() => commit(toggleLayerHidden(doc, l.id), t('studio.image.undoVisibility'))}
      />
      <IconBtn icon="chevron-up" onPress={() => commit(reorderLayer(doc, l.id, 1))} />
      <IconBtn icon="chevron-down" onPress={() => commit(reorderLayer(doc, l.id, -1))} />
      <IconBtn
        icon="copy-outline"
        onPress={() => commit(duplicateLayer(doc, l.id, () => makeId('lyr')), t('studio.image.undoDuplicate'))}
      />
      <IconBtn
        icon="trash-outline"
        color={palette.accent2}
        onPress={() => {
          commit(removeLayer(doc, l.id), t('studio.image.undoDelete'));
          if (sel) {
            onSelect(null);
          }
        }}
      />
    </Pressable>
  );
}

/** 🗂️ csoport-fejléc: összecsukás, név, közös opacity, elrejt, feloldás. */
function GroupHeader({
  doc,
  group: g,
  commit,
  onSelect,
  t,
}: {
  doc: ImageDoc;
  group: ImageGroup;
  commit: (next: ImageDoc, label?: string) => void;
  onSelect: (id: string | null) => void;
  t: TFn;
}) {
  return (
    <View style={styles.groupWrap}>
      <View style={styles.groupHead}>
        <IconBtn
          icon={g.collapsed ? 'chevron-forward' : 'chevron-down'}
          color={palette.text}
          onPress={() => commit(updateGroup(doc, g.id, { collapsed: !g.collapsed }), 'group-collapse')}
        />
        <Ionicons name="folder-outline" size={14} color={palette.accent} />
        <Text style={[styles.groupName, g.hidden ? styles.hidden : null]} numberOfLines={1}>
          {g.name}
        </Text>
        <IconBtn
          icon={g.hidden ? 'eye-off-outline' : 'eye-outline'}
          color={g.hidden ? palette.textDim : palette.text}
          onPress={() => commit(updateGroup(doc, g.id, { hidden: !g.hidden }), 'group-hide')}
        />
        <IconBtn
          icon="remove-circle-outline"
          color={palette.accent2}
          onPress={() => {
            onSelect(null);
            commit(ungroup(doc, g.id), 'ungroup');
          }}
        />
      </View>
      {!g.collapsed ? (
        <Slider
          label={t('studio.image.opacity')}
          value={g.opacity ?? 1}
          min={0.05}
          max={1}
          onChange={(v) => commit(updateGroup(doc, g.id, { opacity: v }), 'group-opacity')}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  layerActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}1a` },
  layerIndent: { marginLeft: 16, borderColor: `${palette.accent}55` },
  groupWrap: {
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${palette.accent}55`,
    backgroundColor: `${palette.accent}0d`,
    padding: 6,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  groupName: { flex: 1, color: palette.text, fontSize: 12, fontWeight: '800' },
  layerIcon: { fontSize: 14 },
  layerName: { flex: 1, color: palette.text, fontSize: 12, fontWeight: '600' },
  hidden: { color: palette.textDim, textDecorationLine: 'line-through' },
  inspector: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 12,
    marginTop: 4,
  },
  inspectorTitle: { color: palette.text, fontSize: 13, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  addRow: { flexDirection: 'row', gap: 8 },
  addChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
  },
  addChipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
});
