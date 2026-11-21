import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/sticker/stickerStyles';
import { PanelSection } from '@/components/ui/controls';

const STICKERS = [
  '🔥', '😂', '😍', '🤯', '👀', '💯', '✨', '🎉',
  '👇', '➡️', '✅', '❌', '💡', '🎵', '🍿', '🔖',
  '💬', '⚡', '🏆', '💰', '🫶', '😭', '🙌', '🚀',
];

export interface FaceStickerSectionProps {
  faceBusy: string | null;
  addFaceSticker: (emoji: string) => Promise<void>;
}

/** 🙂 arc-matricák: az emoji a detektált arcra kerül */
export function FaceStickerSection({ faceBusy, addFaceSticker }: FaceStickerSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.sticker.faceStickerSectionTitle')}>
      <View style={styles.shapeRow3d}>
        {['😎', '🤯', '👑', '🔥', '💀', '🥸'].map((emoji) => (
          <Pressable
            key={emoji}
            style={styles.cell}
            onPress={() => {
              void addFaceSticker(emoji);
            }}
          >
            <Text style={styles.emoji}>{faceBusy === emoji ? '⏳' : emoji}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.sticker.faceStickerNote')}
      </Text>
    </PanelSection>
  );
}

export interface TapStickerSectionProps {
  addSticker: (emoji: string) => void;
}

/** egy koppintásos emoji-matricák a playheadre */
export function TapStickerSection({ addSticker }: TapStickerSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.sticker.tapStickerTitle')}>
      <View style={styles.grid}>
        {STICKERS.map((emoji) => (
          <Pressable key={emoji} style={styles.cell} onPress={() => addSticker(emoji)}>
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.sticker.tapStickerNote')}
      </Text>
    </PanelSection>
  );
}
