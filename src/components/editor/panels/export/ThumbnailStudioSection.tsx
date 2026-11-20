import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';

import { AiProviderPicker } from '@/components/editor/AiProviderPicker';
import { styles } from '@/components/editor/panels/export/exportStyles';
import type { ThumbStudioState } from '@/components/editor/panels/export/useThumbStudioState';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { logCaught } from '@/lib/logCaught';
import { thumbnailDocOf } from '@/lib/thumbnailDoc';
import { thumbnailFramesOnDevice, type ThumbFrame } from '@/lib/thumbStudio';
import type { Project } from '@/types/project';

/** Thumbnail Studio: legjobb kockák az eszközön, AI-címek, a választott kocka → szerkeszthető thumbnail-lap */
export function ThumbnailStudioSection({
  project,
  thumbState,
  pickThumb,
  loadHeadlines,
}: {
  project: Project;
  thumbState: ThumbStudioState;
  pickThumb: (frame: ThumbFrame) => void;
  loadHeadlines: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { thumbStatus, setThumbStatus, thumbs, setThumbs, headlines, headlineStatus, selectedHeadline, setSelectedHeadline } =
    thumbState;
  return (
    <PanelSection title="Thumbnail Studio">
      <AiProviderPicker task="thumbHeadlines" />
      {thumbnailDocOf(project) ? (
        <PrimaryButton
          icon="create-outline"
          label={t('panels.export.editThumbnail')}
          onPress={() => router.push(`/studio/image/${project.id}?doc=${project.thumbnailDocId}`)}
        />
      ) : null}
      <PrimaryButton
        icon="images-outline"
        label={thumbStatus ?? t('panels.export.thumbSuggestions')}
        onPress={() => {
          if (thumbStatus) {
            return;
          }
          setThumbs(null);
          setThumbStatus(t('panels.export.findingBestFrames'));
          thumbnailFramesOnDevice(project)
            .then((result) => {
              if (!result) {
                Alert.alert('Thumbnail Studio', t('panels.export.noVideoClip'));
                return;
              }
              setThumbs(result);
            })
            .catch((caught) => { logCaught('components/editor/panels/ExportPanel.tsx:thumbs', caught); })
            .finally(() => setThumbStatus(null));
        }}
      />
      {thumbs ? (
        <>
          <View style={styles.thumbRow}>
            {thumbs.map((thumb) => (
              <Pressable
                key={thumb.t}
                onPress={() => pickThumb(thumb)}
                accessibilityRole="button"
                accessibilityLabel={t('panels.export.seconds', { seconds: thumb.t.toFixed(0) })}
              >
                <Image source={{ uri: thumb.uri }} style={styles.thumb} contentFit="cover" />
                <Text style={styles.thumbMeta}>{t('panels.export.seconds', { seconds: thumb.t.toFixed(0) })}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.headlineRow}>
            <Chip
              label={headlineStatus ?? t('panels.export.aiHeadlineChip')}
              active={false}
              onPress={() => {
                void loadHeadlines();
              }}
            />
            {headlines?.map((h) => (
              <Chip
                key={h}
                label={h}
                active={selectedHeadline === h}
                onPress={() =>
                  setSelectedHeadline(selectedHeadline === h ? null : h)
                }
              />
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.note}>
        {t('panels.export.thumbNote')}
      </Text>
    </PanelSection>
  );
}
