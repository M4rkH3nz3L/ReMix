import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/editor/panels/library/libraryStyles';
import { PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { YtKind } from '@/lib/youtube';

export interface UrlImportSectionProps {
  url: string;
  setUrl: (url: string) => void;
  imgSec: string;
  setImgSec: (sec: string) => void;
  importBusy: YtKind | null;
  importErr: string | null;
  importFromUrl: (kind: YtKind) => void;
}

/** 🔗 URL-import (YouTube stb.): link, fajta-gombok, képkocka-időpont, hiba */
export function UrlImportSection({
  url,
  setUrl,
  imgSec,
  setImgSec,
  importBusy,
  importErr,
  importFromUrl,
}: UrlImportSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.library.importSectionTitle')}>
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder={t('panels.library.urlPlaceholder')}
        placeholderTextColor={palette.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />
      <View style={styles.importRow}>
        {(
          [
            { kind: 'video', icon: 'videocam-outline' },
            { kind: 'audio', icon: 'musical-notes-outline' },
            { kind: 'image', icon: 'image-outline' },
          ] as const
        ).map((b) => (
          <Pressable
            key={b.kind}
            style={[styles.importBtn, !url.trim() ? styles.importBtnOff : null]}
            disabled={!url.trim() || importBusy !== null}
            onPress={() => importFromUrl(b.kind)}
          >
            {importBusy === b.kind ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Ionicons name={b.icon} size={16} color={palette.accent} />
            )}
            <Text style={styles.importBtnText}>{t('panels.library.importKind_' + b.kind)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.importRow}>
        <Text style={styles.note}>{t('panels.library.imageTimeLabel')}</Text>
        <TextInput
          value={imgSec}
          onChangeText={setImgSec}
          placeholder="1"
          placeholderTextColor={palette.textDim}
          keyboardType="numeric"
          style={styles.secInput}
        />
      </View>
      {importErr ? <Text style={styles.errText}>{importErr}</Text> : null}
      <Text style={styles.note}>{t('panels.library.importHint')}</Text>
    </PanelSection>
  );
}
