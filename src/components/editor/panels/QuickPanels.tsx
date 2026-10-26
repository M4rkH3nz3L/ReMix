import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { TRANSITIONS } from '@/components/editor/panels/TransitionPanel';
import { Chip, Stepper } from '@/components/ui/controls';
import { filters, palette, speedPresets } from '@/constants/editor';
import { maxVideoDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, ImageClip, VideoClip } from '@/types/project';

/**
 * ⚡ Gyors (Strip) panel-változatok — MOBILE-UI §3.1.
 *
 * Egy chip-sor + legfeljebb egy finomhangoló — a hatás az előnézeten azonnal
 * látszik, a vászon egy pontot sem veszít (a Strip az eszköztár HELYÉN van).
 * A teljes panel a „Részletek" gombbal nyílik (sheet-szint). Minden módosítás
 * ugyanazon az `updateClip`-úton megy, mint a teljes panelben (command bus, undo).
 */

/** vízszintes chip-sor — a kis kijelzőn görgethető, nem tör új sorba */
function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function SpeedQuick({ clip }: { clip: VideoClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  // ugyanaz a hossz-szabály, mint a SpeedPanel `setSpeed`-jében
  const setSpeed = (speed: number) => {
    const next = clamp(speed, 0.1, 10);
    const duration = Math.min((clip.duration * clip.speed) / next, maxVideoDuration({ ...clip, speed: next }));
    updateClip(clip.id, { speed: next, duration });
  };
  return (
    <View>
      <ChipRow>
        {speedPresets.map((preset) => (
          <Chip key={preset} label={`${preset}×`} active={clip.speed === preset} onPress={() => setSpeed(preset)} />
        ))}
      </ChipRow>
      <Stepper
        label={t('panels.speed.fineTune')}
        value={`${clip.speed.toFixed(2)}×`}
        onDec={() => setSpeed(Math.round((clip.speed - 0.1) * 100) / 100)}
        onInc={() => setSpeed(Math.round((clip.speed + 0.1) * 100) / 100)}
      />
    </View>
  );
}

export function FilterQuick({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const intensity = clip.filterIntensity ?? 1;
  return (
    <View>
      <ChipRow>
        {filters.map((f) => (
          <Chip
            key={f.id}
            label={t(f.label)}
            active={clip.filterId === f.id}
            color={f.overlay && f.overlay !== 'transparent' ? f.overlay : undefined}
            onPress={() => updateClip(clip.id, { filterId: f.id })}
          />
        ))}
      </ChipRow>
      {clip.filterId !== 'none' ? (
        <Stepper
          label={t('panels.filter.strength')}
          value={`${Math.round(intensity * 100)}%`}
          onDec={() => updateClip(clip.id, { filterIntensity: clamp(intensity - 0.1, 0.1, 1) })}
          onInc={() => updateClip(clip.id, { filterIntensity: clamp(intensity + 0.1, 0.1, 1) })}
        />
      ) : (
        // a sáv magassága állandó — szűrő-választáskor a preview NE ugorjon (élő teszt V3)
        <View style={styles.reserved}>
          <Text style={styles.reservedText}>{t('panels.filter.pickForStrength')}</Text>
        </View>
      )}
    </View>
  );
}

export function TransitionQuick({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const to = clip.transitionOut;
  const dur = to?.duration ?? 0.5;
  return (
    <View>
      <ChipRow>
        <Chip
          label={t('common.none')}
          active={!to}
          onPress={() => updateClip(clip.id, { transitionOut: undefined })}
        />
        {TRANSITIONS.map((tr) => (
          <Chip
            key={tr.id}
            label={t('panels.transition.type_' + tr.id)}
            active={to?.type === tr.id}
            onPress={() => updateClip(clip.id, { transitionOut: { ...to, type: tr.id, duration: dur } })}
          />
        ))}
      </ChipRow>
      {to ? (
        <Stepper
          label={t('panels.transition.length')}
          value={t('panels.transition.seconds', { value: dur.toFixed(2) })}
          onDec={() => updateClip(clip.id, { transitionOut: { ...to, duration: clamp(dur - 0.1, 0.1, 2) } })}
          onInc={() => updateClip(clip.id, { transitionOut: { ...to, duration: clamp(dur + 0.1, 0.1, 2) } })}
        />
      ) : null}
    </View>
  );
}

export function VolumeQuick({ clip }: { clip: AudioClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const presets = [0, 0.25, 0.5, 0.75, 1];
  return (
    <View>
      <ChipRow>
        {presets.map((v) => (
          <Chip
            key={v}
            label={v === 0 ? t('panels.audio.muteShort') : `${Math.round(v * 100)}%`}
            active={Math.abs(clip.volume - v) < 0.001}
            onPress={() => updateClip(clip.id, { volume: v })}
          />
        ))}
      </ChipRow>
      <Stepper
        label={t('panels.audio.volume')}
        value={`${Math.round(clip.volume * 100)}%`}
        onDec={() => updateClip(clip.id, { volume: clamp(clip.volume - 0.1, 0, 1) })}
        onInc={() => updateClip(clip.id, { volume: clamp(clip.volume + 0.1, 0, 1) })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  // = a Stepper-sor magassága (32 pt gomb + 2×4 pt)
  reserved: { height: 40, justifyContent: 'center' },
  reservedText: { color: palette.textDim, fontSize: 12 },
});
