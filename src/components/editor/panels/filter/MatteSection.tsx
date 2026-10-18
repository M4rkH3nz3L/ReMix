import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { pickImage } from '@/lib/media';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🎭 Track / luma / alpha matte: egy külső kép fényereje/alfája adja az
 * átlátszóságot. Önálló szekció — a klip matte-mezőjét írja.
 */
export function MatteSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  return (
    <PanelSection title={t('panels.filter.sectionMatte')}>
      <View style={styles.row}>
        <Chip
          label={clip.matte ? t('panels.filter.matteReplace') : t('panels.filter.mattePick')}
          active={Boolean(clip.matte)}
          onPress={() => {
            pickImage()
              .then((p) => {
                if (p) {
                  updateClip(clip.id, {
                    matte: { uri: p.uri, type: clip.matte?.type ?? 'luma', invert: clip.matte?.invert },
                  });
                }
              })
              .catch(() => {});
          }}
        />
        {clip.matte ? (
          <Chip label={t('common.none')} active={false} onPress={() => updateClip(clip.id, { matte: undefined })} />
        ) : null}
      </View>
      {clip.matte ? (
        <View style={styles.row}>
          <Chip
            label={t('panels.filter.matteLuma')}
            active={clip.matte.type === 'luma'}
            onPress={() => updateClip(clip.id, { matte: { ...clip.matte!, type: 'luma' } })}
          />
          <Chip
            label={t('panels.filter.matteAlpha')}
            active={clip.matte.type === 'alpha'}
            onPress={() => updateClip(clip.id, { matte: { ...clip.matte!, type: 'alpha' } })}
          />
          <Chip
            label={t('panels.filter.matteInvert')}
            active={clip.matte.invert === true}
            onPress={() => updateClip(clip.id, { matte: { ...clip.matte!, invert: !clip.matte!.invert } })}
          />
        </View>
      ) : null}
      <Text style={styles.note}>{t('panels.filter.noteMatte')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
