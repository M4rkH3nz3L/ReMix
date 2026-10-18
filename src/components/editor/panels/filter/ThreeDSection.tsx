import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image as RNImage, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { requestCutout } from '@/lib/bgremove';
import { CAMERA_PRESETS, buildCameraMove } from '@/lib/camera3d';
import { requestDepthFocus, requestDepthParallax } from '@/lib/depthClient';
import { makeId } from '@/lib/id';
import { clamp } from '@/lib/time';
import { upscalePhoto } from '@/lib/upscaleClient';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🧊 3D-dőlés + kamera-mozgás, valamint (csak fotón) mélység-parallax,
 * portré-fókusz, AI-kivágás és felnagyítás. Önálló szekció — saját
 * busy-állapotok és handlerek; a klip-mezőket a command-buson írja.
 */
export function ThreeDSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const [depthBusy, setDepthBusy] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [upscaleBusy, setUpscaleBusy] = useState(false);

  const toggleDepthParallax = async () => {
    if (clip.kind !== 'image' || depthBusy) {
      return;
    }
    if (clip.depthParallax) {
      updateClip(clip.id, { depthParallax: undefined });
      return;
    }
    setDepthBusy(true);
    const result = await requestDepthParallax(clip.uri);
    setDepthBusy(false);
    if (!result) {
      Alert.alert(
        t('panels.filter.depthTitle'),
        t('panels.filter.depthUnavailable')
      );
      return;
    }
    updateClip(clip.id, {
      depthParallax: { id: result.id, strength: 1 },
      // mozgás nélkül nem látszana a mélység — ha nincs, lágy push-in megy rá
      keyframes: clip.keyframes ?? buildCameraMove('pushIn', clip.duration).keyframes,
    });
  };

  const setDepthFocus = async (mode: 'portrait' | 'toFar' | 'toNear') => {
    if (clip.kind !== 'image' || focusBusy) {
      return;
    }
    if (clip.depthFocus?.mode === mode) {
      updateClip(clip.id, { depthFocus: undefined });
      return;
    }
    setFocusBusy(true);
    const result = await requestDepthFocus(clip.uri);
    setFocusBusy(false);
    if (!result) {
      Alert.alert(
        t('panels.filter.depthFocusTitle'),
        t('panels.filter.depthUnavailable')
      );
      return;
    }
    updateClip(clip.id, {
      depthFocus: { id: result.id, mode, previewUri: result.previewUri },
    });
  };

  // 🪄 AI kivágás: a fotó témája átlátszó hátterű overlay-rétegként kerül a
  // vászonra — alá bármilyen új háttér tehető (szín/gradiens/kép/videó)
  const extractSubject = async () => {
    if (clip.kind !== 'image' || cutoutBusy) {
      return;
    }
    setCutoutBusy(true);
    const result = await requestCutout(clip.uri);
    setCutoutBusy(false);
    if (!result) {
      Alert.alert(
        t('panels.filter.aiCutoutTitle'),
        t('panels.filter.aiCutoutUnavailable')
      );
      return;
    }
    const aspect = await new Promise<number>((resolve) => {
      RNImage.getSize(
        result.uri,
        (w, h) => resolve(w > 0 && h > 0 ? w / h : 1),
        () => resolve(1)
      );
    });
    const state = useEditorStore.getState();
    const w = 0.55;
    const id = makeId('clip');
    state.addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: clip.start,
        duration: clip.duration,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.5 },
        w,
        h: Math.min(0.85, (w / aspect) * 0.5625),
        fill: 'transparent',
        imageUri: result.uri,
      },
      {
        id: makeId('ast'),
        kind: 'image',
        uri: result.uri,
        provider: 'local',
        name: t('panels.filter.aiCutoutTitle'),
      }
    );
    state.selectClip(id);
    state.setPanel('shape');
    Alert.alert(
      t('panels.filter.aiCutoutDoneTitle'),
      t('panels.filter.aiCutoutDoneBody')
    );
  };

  // 🔍 felnagyítás: a klip forrása a szuper-felbontású változatra cserélődik
  const upscaleClip = async (scale: 2 | 4) => {
    if (clip.kind !== 'image' || upscaleBusy) {
      if (clip.kind !== 'image') {
        Alert.alert(t('panels.filter.upscaleTitle'), t('panels.filter.upscaleImagesOnly'));
      }
      return;
    }
    setUpscaleBusy(true);
    const result = await upscalePhoto(clip.uri, scale);
    setUpscaleBusy(false);
    if (!result) {
      Alert.alert(
        t('panels.filter.upscaleTitle'),
        t('panels.filter.upscaleUnavailable')
      );
      return;
    }
    updateClip(clip.id, { uri: result.uri });
    Alert.alert(
      t('panels.filter.upscaleDoneTitle'),
      t('panels.filter.upscaleDoneBody', { width: result.width, height: result.height })
    );
  };

  return (
    <PanelSection title={t('panels.filter.section3d')}>
      <Stepper
        label={t('panels.filter.tiltVertical')}
        value={`${clip.tilt3d?.rotX ?? 0}°`}
        onDec={() =>
          updateClip(clip.id, {
            tilt3d: {
              rotX: clamp((clip.tilt3d?.rotX ?? 0) - 5, -45, 45),
              rotY: clip.tilt3d?.rotY ?? 0,
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            tilt3d: {
              rotX: clamp((clip.tilt3d?.rotX ?? 0) + 5, -45, 45),
              rotY: clip.tilt3d?.rotY ?? 0,
            },
          })
        }
      />
      <Stepper
        label={t('panels.filter.tiltHorizontal')}
        value={`${clip.tilt3d?.rotY ?? 0}°`}
        onDec={() =>
          updateClip(clip.id, {
            tilt3d: {
              rotX: clip.tilt3d?.rotX ?? 0,
              rotY: clamp((clip.tilt3d?.rotY ?? 0) - 5, -45, 45),
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            tilt3d: {
              rotX: clip.tilt3d?.rotX ?? 0,
              rotY: clamp((clip.tilt3d?.rotY ?? 0) + 5, -45, 45),
            },
          })
        }
      />
      <View style={styles.row}>
        {CAMERA_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            label={t(preset.label)}
            active={false}
            onPress={() => {
              const move = buildCameraMove(preset.id, clip.duration);
              updateClip(clip.id, {
                keyframes: move.keyframes,
                tilt3d: move.tilt3d,
              });
            }}
          />
        ))}
        {clip.tilt3d ? (
          <Chip
            label={t('panels.filter.chipTiltOff')}
            active={false}
            onPress={() => updateClip(clip.id, { tilt3d: undefined })}
          />
        ) : null}
      </View>
      {clip.kind === 'image' ? (
        <View style={styles.row}>
          <Chip
            label={
              depthBusy
                ? t('panels.filter.chipDepthComputing')
                : clip.depthParallax
                  ? t('panels.filter.chipDepthOn')
                  : t('panels.filter.chipDepth')
            }
            active={Boolean(clip.depthParallax)}
            onPress={() => {
              void toggleDepthParallax();
            }}
          />
          <Chip
            label={focusBusy ? '⏳…' : t('panels.filter.chipPortraitBlur')}
            active={clip.depthFocus?.mode === 'portrait'}
            onPress={() => {
              void setDepthFocus('portrait');
            }}
          />
          <Chip
            label={t('panels.filter.chipFocusBack')}
            active={clip.depthFocus?.mode === 'toFar'}
            onPress={() => {
              void setDepthFocus('toFar');
            }}
          />
          <Chip
            label={t('panels.filter.chipFocusFront')}
            active={clip.depthFocus?.mode === 'toNear'}
            onPress={() => {
              void setDepthFocus('toNear');
            }}
          />
          <Chip
            label={cutoutBusy ? t('panels.filter.chipCuttingOut') : t('panels.filter.chipExtractSubject')}
            active={false}
            onPress={() => {
              void extractSubject();
            }}
          />
          <Chip
            label={upscaleBusy ? t('panels.filter.chipUpscaling') : t('panels.filter.chipUpscale2x')}
            active={false}
            onPress={() => {
              void upscaleClip(2);
            }}
          />
          <Chip
            label={upscaleBusy ? t('panels.filter.chipUpscaling') : '🔍 4×'}
            active={false}
            onPress={() => {
              void upscaleClip(4);
            }}
          />
        </View>
      ) : null}
      <Text style={styles.note}>
        {t('panels.filter.note3d')}
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
