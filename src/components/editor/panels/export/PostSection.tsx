import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/export/exportStyles';
import { PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { PostTarget } from '@/lib/render';

/** posztolás platformra (TikTok / Reels / YouTube / egyéb) — render közben letiltva */
export function PostSection({
  renderStatus,
  postTo,
}: {
  renderStatus: string | null;
  postTo: (target: PostTarget) => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.export.postSection')}>
      <View style={styles.postRow}>
        {(
          [
            { target: 'tiktok', icon: 'logo-tiktok', color: palette.text, label: 'TikTok' },
            { target: 'reels', icon: 'logo-instagram', color: '#e1306c', label: 'Reels' },
            { target: 'youtube', icon: 'logo-youtube', color: '#ff0033', label: 'YouTube' },
            { target: 'other', icon: 'share-social-outline', color: palette.textDim, label: t('panels.export.otherPlatform') },
          ] as const
        ).map((p) => (
          <Pressable
            key={p.target}
            style={[styles.postBtn, renderStatus ? styles.postBtnOff : null]}
            disabled={renderStatus !== null}
            onPress={() => postTo(p.target)}
          >
            <Ionicons name={p.icon} size={20} color={p.color} />
            <Text style={styles.postText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.export.postNote')}
      </Text>
    </PanelSection>
  );
}
