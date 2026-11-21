import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/captions/captionsStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import { TARGET_LANGS } from '@/lib/captionPanelOps';
import type { ProfanityMode } from '@/lib/profanity';

export interface CaptionRewriteSectionsProps {
  translateStatus: string | null;
  runTranslate: (lang: string) => Promise<void>;
  runBilingual: (lang: string) => Promise<void>;
  runProfanity: (mode: ProfanityMode) => void;
}

/** 🌍 fordítás, kétnyelvű felirat, 🧼 káromkodás-maszkolás */
export function CaptionRewriteSections({ translateStatus, runTranslate, runBilingual, runProfanity }: CaptionRewriteSectionsProps) {
  const { t } = useTranslation();
  return (
    <>
    <PanelSection title={t('panels.captions.translateSectionTitle')}>
      <View style={styles.row}>
        {TARGET_LANGS.map((l) => (
          <Chip
            key={l.code}
            label={l.label}
            active={false}
            onPress={() => {
              void runTranslate(l.label);
            }}
          />
        ))}
      </View>
      {translateStatus ? <Text style={styles.note}>{translateStatus}</Text> : null}
      <Text style={styles.note}>{t('panels.captions.translateNote')}</Text>
    </PanelSection>

    <PanelSection title={t('panels.captions.bilingualSectionTitle')}>
      <View style={styles.row}>
        {TARGET_LANGS.map((l) => (
          <Chip
            key={l.code}
            label={l.label}
            active={false}
            onPress={() => {
              void runBilingual(l.label);
            }}
          />
        ))}
      </View>
      <Text style={styles.note}>{t('panels.captions.bilingualNote')}</Text>
    </PanelSection>

    <PanelSection title={t('panels.captions.profanitySectionTitle')}>
      <View style={styles.row}>
        {(
          [
            { id: 'mask', label: t('panels.captions.profanityMask') },
            { id: 'stars', label: t('panels.captions.profanityStars') },
            { id: 'remove', label: t('panels.captions.profanityRemove') },
          ] as const
        ).map((m) => (
          <Chip key={m.id} label={m.label} active={false} onPress={() => runProfanity(m.id)} />
        ))}
      </View>
      <Text style={styles.note}>{t('panels.captions.profanityNote')}</Text>
    </PanelSection>
    </>
  );
}
