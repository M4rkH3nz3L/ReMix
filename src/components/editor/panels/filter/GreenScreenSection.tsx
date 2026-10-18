import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { fetchPixelColor } from '@/lib/colorClient';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🟢 Green screen (chroma key): preset/pipetta kulcs-szín + tolerancia, spill,
 * él-lágyítás és matte-perem. Önálló szekció — a pipettát a `setPickTarget`-en
 * keresztül használja, a klip chromaKey-mezőjét a command-buson írja.
 */
export function GreenScreenSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);

  /** 🎨 green screen színpipetta: a vásznon rákoppintasz a háttérre → az a kulcs-szín */
  const pickChromaColor = () => {
    Alert.alert(t('panels.filter.chromaPickTitle'), t('panels.filter.chromaPickHint'));
    setPickTarget((point) => {
      const st = useEditorStore.getState();
      const atSec =
        clip.kind === 'video' ? clip.trimIn + Math.max(0, st.playhead - clip.start) * clip.speed : 0;
      fetchPixelColor(clip.uri, atSec, point.x, point.y)
        .then((hex) => {
          if (hex) {
            updateClip(clip.id, {
              chromaKey: { similarity: 0.18, ...clip.chromaKey, color: hex },
            });
          } else {
            Alert.alert(t('panels.filter.sectionGreenScreen'), t('panels.filter.chromaPickFailed'));
          }
        })
        .catch(() => {});
    });
  };

  return (
    <PanelSection title={t('panels.filter.sectionGreenScreen')}>
      <View style={styles.row}>
        <Chip
          label={t('common.none')}
          active={!clip.chromaKey}
          onPress={() => updateClip(clip.id, { chromaKey: undefined })}
        />
        <Chip
          label={t('panels.filter.chipGreen')}
          active={clip.chromaKey?.color === '#00ff00'}
          onPress={() =>
            updateClip(clip.id, {
              chromaKey: { color: '#00ff00', similarity: clip.chromaKey?.similarity ?? 0.18 },
            })
          }
        />
        <Chip
          label={t('panels.filter.chipBlue')}
          active={clip.chromaKey?.color === '#0000ff'}
          onPress={() =>
            updateClip(clip.id, {
              chromaKey: { color: '#0000ff', similarity: clip.chromaKey?.similarity ?? 0.18 },
            })
          }
        />
        {/* 🎨 színpipetta: a vászonról mintavett kulcs-szín (custom, nem preset) */}
        <Chip
          label={t('panels.filter.chromaPick')}
          active={
            !!clip.chromaKey && clip.chromaKey.color !== '#00ff00' && clip.chromaKey.color !== '#0000ff'
          }
          onPress={pickChromaColor}
        />
      </View>
      {clip.chromaKey ? (
        <Stepper
          label={t('panels.filter.tolerance')}
          value={`${Math.round(clip.chromaKey.similarity * 100)}%`}
          onDec={() =>
            updateClip(clip.id, {
              chromaKey: {
                ...clip.chromaKey!,
                similarity: clamp(clip.chromaKey!.similarity - 0.03, 0.05, 0.45),
              },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              chromaKey: {
                ...clip.chromaKey!,
                similarity: clamp(clip.chromaKey!.similarity + 0.03, 0.05, 0.45),
              },
            })
          }
        />
      ) : null}
      {/* 🟢 spill-suppression: a zöld/kék perem eltávolítása a témáról */}
      {clip.chromaKey ? (
        <Stepper
          label={t('panels.filter.spill')}
          value={`${Math.round((clip.chromaKey.spill ?? 0) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, {
              chromaKey: { ...clip.chromaKey!, spill: clamp((clip.chromaKey!.spill ?? 0) - 0.2, 0, 1) },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              chromaKey: { ...clip.chromaKey!, spill: clamp((clip.chromaKey!.spill ?? 0) + 0.2, 0, 1) },
            })
          }
        />
      ) : null}
      {/* 🪶 Feather: az él lágysága (blend); ✂️ Edge: a matte-perem be/kifelé tolása */}
      {clip.chromaKey ? (
        <Stepper
          label={t('panels.filter.feather')}
          value={`${Math.round((clip.chromaKey.blend ?? 0.05) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, {
              chromaKey: { ...clip.chromaKey!, blend: clamp((clip.chromaKey!.blend ?? 0.05) - 0.02, 0, 0.3) },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              chromaKey: { ...clip.chromaKey!, blend: clamp((clip.chromaKey!.blend ?? 0.05) + 0.02, 0, 0.3) },
            })
          }
        />
      ) : null}
      {clip.chromaKey ? (
        <Stepper
          label={t('panels.filter.chromaEdge')}
          value={`${(clip.chromaKey.edge ?? 0) > 0 ? '+' : ''}${Math.round((clip.chromaKey.edge ?? 0) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, {
              chromaKey: { ...clip.chromaKey!, edge: clamp((clip.chromaKey!.edge ?? 0) - 0.25, -1, 1) },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              chromaKey: { ...clip.chromaKey!, edge: clamp((clip.chromaKey!.edge ?? 0) + 0.25, -1, 1) },
            })
          }
        />
      ) : null}
      <Text style={styles.note}>
        {t('panels.filter.noteGreenScreen')}
      </Text>
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
