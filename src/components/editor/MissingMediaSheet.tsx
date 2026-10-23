import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { classifyMissingMedia, mediaRemoteMap } from '@/lib/mediaSync';
import type { MissingMedia } from '@/lib/videdFile';
import type { Project } from '@/types/project';

/**
 * 🩹 Hiányzó média — per-fájl helyreállítás-lista (CORE §2.8). A granuláris mag
 * (`classifyMissingMedia`) kétfelé bontja a hiányzókat: **felhőből visszaállítható**
 * (van szerver-másolat) vs **árva** (nincs forrás → csak kézi relink). A lista
 * minden fájlhoz mutatja az állapotot, és per-fájl újracsatolást kínál — így egy
 * fájl bukása/hiánya nem akasztja meg a többit (a „Mind újracsatolása" a meglévő
 * auto+kézi flow-t futtatja). A sheet-keret a közös `StudioSheet`.
 */

const KIND_ICON: Record<MissingMedia['kind'], keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  image: 'image',
  audio: 'musical-notes',
};

export function MissingMediaSheet({
  project,
  missing,
  relinking,
  onRelinkAll,
  onRelinkOne,
  onRestoreFromRp,
  onClose,
}: {
  project: Project;
  missing: MissingMedia[];
  relinking: boolean;
  onRelinkAll: () => void;
  onRelinkOne: (item: MissingMedia) => void;
  /** 📲 felhő nélküli út: a másik eszközről hozott .rp csomagból pótolja a hiányzókat */
  onRestoreFromRp: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { restorable } = classifyMissingMedia(project, missing, mediaRemoteMap(project));
  const restorableSet = new Set(restorable.map((m) => m.uri));

  return (
    <StudioSheet
      title={t('editor.missingSheet.title')}
      icon="alert-circle"
      onClose={onClose}
      footer={
        <View style={styles.footerCol}>
          <Pressable
            style={[styles.allBtn, relinking && styles.btnDisabled]}
            disabled={relinking}
            onPress={onRelinkAll}
            accessibilityRole="button"
          >
            <Ionicons name="link" size={16} color="#fff" />
            <Text style={styles.allBtnText}>
              {relinking ? t('editorScreen.relinking') : t('editor.missingSheet.relinkAll')}
            </Text>
          </Pressable>
          {/* 📲 felhő nélkül, másik eszközről: .rp csomagból pótlás */}
          <Pressable
            style={[styles.rpBtn, relinking && styles.btnDisabled]}
            disabled={relinking}
            onPress={onRestoreFromRp}
            accessibilityRole="button"
          >
            <Ionicons name="archive-outline" size={15} color={palette.accent} />
            <Text style={styles.rpBtnText}>{t('editor.missingSheet.fromRp')}</Text>
          </Pressable>
          <Text style={styles.rpHint}>{t('editor.missingSheet.fromRpHint')}</Text>
        </View>
      }
    >
      <Text style={styles.summary}>
        {t('editor.missingSheet.summary', {
          total: missing.length,
          cloud: restorableSet.size,
          manual: missing.length - restorableSet.size,
        })}
      </Text>
      {missing.map((m) => {
        const inCloud = restorableSet.has(m.uri);
        return (
          <View key={m.uri} style={styles.row}>
            <Ionicons name={KIND_ICON[m.kind]} size={18} color={palette.textDim} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {m.label}
              </Text>
              <Text style={[styles.rowStatus, { color: inCloud ? palette.accent : palette.warning }]}>
                {inCloud ? t('editor.missingSheet.statusCloud') : t('editor.missingSheet.statusManual')}
              </Text>
            </View>
            <Pressable
              style={[styles.oneBtn, relinking && styles.btnDisabled]}
              disabled={relinking}
              onPress={() => onRelinkOne(m)}
              accessibilityRole="button"
            >
              <Text style={styles.oneBtnText}>{t('editor.missingSheet.relinkOne')}</Text>
            </Pressable>
          </View>
        );
      })}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    color: palette.textDim,
    fontSize: 12,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rowStatus: {
    fontSize: 11,
    fontWeight: '600',
  },
  oneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: palette.surfaceHigh,
  },
  oneBtnText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
  },
  allBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: palette.accent,
  },
  allBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  footerCol: { gap: 8 },
  rpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.accent,
  },
  rpBtnText: { color: palette.accent, fontSize: 13, fontWeight: '800' },
  rpHint: { color: palette.textDim, fontSize: 11, textAlign: 'center', lineHeight: 15 },
});
