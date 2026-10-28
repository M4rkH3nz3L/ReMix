import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { type FileKind, type StorageEntry, fileKindOf, quotaLevel } from '@/lib/remixFiles';
import { formatBytes } from '@/lib/storageQuota';
import type { Transfer } from '@/lib/transferQueue';

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * 🗂️ A Tárhelyem képernyő prezentációs darabjai: hely-kártya, fájl-sor/-csempe,
 * átviteli sor és a fájl-műveleti alsó lap. Állapotot nem tartanak — a
 * `useStorageBrowser` hook adja az adatot és az akciókat.
 */

const KIND_ICON: Record<FileKind, IoniconName> = {
  video: 'film-outline',
  image: 'image-outline',
  audio: 'musical-notes-outline',
  project: 'layers-outline',
  document: 'document-text-outline',
  other: 'document-outline',
};

const KIND_COLOR: Record<FileKind, string> = {
  video: '#3d6bff',
  image: '#c447d6',
  audio: '#2ecc8f',
  project: palette.accent,
  document: '#f5a623',
  other: palette.textDim,
};

export function LocationCard({
  icon,
  title,
  subtitle,
  status,
  statusTone = 'ok',
  used,
  quota,
  disabled,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  status: string;
  statusTone?: 'ok' | 'dim' | 'warn';
  used?: number;
  quota?: number;
  disabled?: boolean;
  onPress: () => void;
}) {
  const bar = used != null && quota ? quotaLevel(used, quota) : null;
  const toneColor = statusTone === 'ok' ? palette.ok : statusTone === 'warn' ? palette.warning : palette.textDim;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, disabled && styles.cardDisabled, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <View style={styles.cardIcon}>
        <Ionicons name={icon} size={24} color={disabled ? palette.textDim : palette.accent} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={[styles.cardStatus, { color: toneColor }]}>{status}</Text>
        </View>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
        {bar ? (
          <>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.max(2, bar.fraction * 100)}%`,
                    backgroundColor:
                      bar.level === 'full' ? palette.danger : bar.level === 'warn' ? palette.warning : palette.accent,
                  },
                ]}
              />
            </View>
            <Text style={styles.cardMeta}>
              {formatBytes(used ?? 0)} / {formatBytes(quota ?? 0)}
            </Text>
          </>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.textDim} />
    </Pressable>
  );
}

export function EntryIcon({ entry, size = 22 }: { entry: StorageEntry; size?: number }) {
  if (entry.isFolder) {
    return <Ionicons name="folder" size={size} color={palette.accent} />;
  }
  const kind = fileKindOf(entry.name);
  // eszközön a kép azonnal előnézhető (helyi uri); felhőben ikon (nincs publikus URL)
  if (kind === 'image' && entry.location === 'device' && entry.uri) {
    return <Image source={{ uri: entry.uri }} style={{ width: size + 14, height: size + 14, borderRadius: 6 }} contentFit="cover" />;
  }
  return <Ionicons name={KIND_ICON[kind]} size={size} color={KIND_COLOR[kind]} />;
}

function metaLine(entry: StorageEntry): string {
  if (entry.isFolder) {
    return '';
  }
  const parts = [formatBytes(entry.size ?? 0)];
  if (entry.modified) {
    parts.push(new Date(entry.modified).toLocaleDateString());
  }
  return parts.join(' · ');
}

export function EntryRow({
  entry,
  selected,
  grid,
  subtitle,
  locked,
  onPress,
  onLongPress,
}: {
  entry: StorageEntry;
  selected: boolean;
  grid: boolean;
  /** pl. a projekt-mappánál a projekt neve */
  subtitle?: string;
  /** 🔒 védett (csak a projekt törlésével törölhető) */
  locked?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  if (grid) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.tile, selected && styles.selected, pressed && styles.pressed]}
      >
        <View style={styles.tileIcon}>
          <EntryIcon entry={entry} size={34} />
        </View>
        <Text style={styles.tileName} numberOfLines={2}>
          {entry.name}
        </Text>
        {subtitle ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {selected ? (
          <Ionicons name="checkmark-circle" size={18} color={palette.accent} style={styles.tileCheck} />
        ) : locked ? (
          <Ionicons name="lock-closed" size={14} color={palette.textDim} style={styles.tileCheck} />
        ) : null}
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        <EntryIcon entry={entry} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {entry.name}
        </Text>
        {subtitle || !entry.isFolder ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {subtitle ?? metaLine(entry)}
          </Text>
        ) : null}
      </View>
      {locked ? <Ionicons name="lock-closed" size={14} color={palette.textDim} /> : null}
      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color={palette.accent} />
      ) : entry.isFolder ? (
        <Ionicons name="chevron-forward" size={18} color={palette.textDim} />
      ) : null}
    </Pressable>
  );
}

export function TransferList({
  transfers,
  onRetry,
  onClear,
}: {
  transfers: Transfer[];
  onRetry: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (!transfers.length) {
    return null;
  }
  const done = transfers.filter((x) => x.status === 'done').length;
  return (
    <View style={styles.transfers}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionLabel}>
          {t('storage.transfers.title')} · {done}/{transfers.length}
        </Text>
        {done ? (
          <Pressable onPress={onClear} hitSlop={8}>
            <Text style={styles.link}>{t('storage.transfers.clear')}</Text>
          </Pressable>
        ) : null}
      </View>
      {transfers.slice(-6).map((x) => (
        <View key={x.id} style={styles.transfer}>
          <Ionicons
            name={x.direction === 'up' ? 'cloud-upload-outline' : 'cloud-download-outline'}
            size={18}
            color={x.status === 'failed' ? palette.danger : palette.accent}
          />
          <View style={styles.rowBody}>
            <Text style={styles.rowName} numberOfLines={1}>
              {x.name}
            </Text>
            <Text style={[styles.rowMeta, x.status === 'failed' && { color: palette.danger }]} numberOfLines={2}>
              {x.status === 'failed'
                ? x.error
                : x.status === 'done' && x.deduplicated
                  ? t('storage.transfers.alreadyThere')
                  : t(`storage.transfers.${x.status}`, { pct: Math.round(x.progress * 100) })}
            </Text>
            {x.status === 'active' ? (
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max(2, x.progress * 100)}%` }]} />
              </View>
            ) : null}
          </View>
          {x.status === 'failed' ? (
            <Pressable onPress={() => onRetry(x.id)} hitSlop={8}>
              <Text style={styles.link}>{t('common.retry')}</Text>
            </Pressable>
          ) : x.status === 'done' ? (
            <Ionicons name="checkmark-circle" size={18} color={palette.ok} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

export interface SheetAction {
  key: string;
  icon: IoniconName;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

/** Fájl-műveleti alsó lap (az Android-Alert max. 3 gombja helyett). */
export function ActionSheet({
  entry,
  hint,
  actions,
  onClose,
}: {
  entry: StorageEntry | null;
  hint: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={entry !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {entry ? (
            <View style={styles.sheetHead}>
              <EntryIcon entry={entry} size={28} />
              <View style={styles.rowBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {entry.name}
                </Text>
                <Text style={styles.rowMeta}>{[metaLine(entry), hint].filter(Boolean).join(' · ')}</Text>
              </View>
            </View>
          ) : null}
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
            >
              <Ionicons name={a.icon} size={20} color={a.destructive ? palette.danger : palette.text} />
              <Text style={[styles.sheetLabel, a.destructive && { color: palette.danger }]}>{a.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={styles.sheetCancel}>
            <Text style={styles.cardSubtitle}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accentSoft,
  },
  cardBody: { flex: 1, gap: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: palette.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardStatus: { fontSize: 12, fontWeight: '700' },
  cardSubtitle: { color: palette.textDim, fontSize: 13 },
  cardMeta: { color: palette.textDim, fontSize: 12, marginTop: 2 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.surfaceHigh,
    overflow: 'hidden',
    marginTop: 8,
  },
  barFill: { height: 6, borderRadius: 3, backgroundColor: palette.accent },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  selected: { backgroundColor: palette.accentSoft },
  rowIcon: { width: 38, alignItems: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: palette.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: palette.textDim, fontSize: 12 },
  tile: {
    flex: 1,
    margin: 4,
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: palette.surface,
    minHeight: 110,
  },
  tileIcon: { height: 56, alignItems: 'center', justifyContent: 'center' },
  tileName: { color: palette.text, fontSize: 12, textAlign: 'center', marginTop: 6 },
  tileCheck: { position: 'absolute', top: 6, right: 6 },
  transfers: {
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  transfer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionLabel: { color: palette.text, fontSize: 13, fontWeight: '700' },
  link: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000a' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 4,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 8,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 4 },
  sheetLabel: { color: palette.text, fontSize: 15, fontWeight: '600' },
  sheetCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
});
