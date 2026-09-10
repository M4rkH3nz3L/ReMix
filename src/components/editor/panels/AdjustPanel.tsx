import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { GRADES } from '@/constants/grades';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { AdjustClip, ClipAdjust } from '@/types/project';

/** ugyanaz a paraméter-készlet, mint a per-klip képjavításnál (FilterPanel) */
const ADJUSTS: {
  key: keyof ClipAdjust;
  step: number;
  min: number;
  max: number;
}[] = [
  { key: 'brightness', step: 0.05, min: -0.3, max: 0.3 },
  { key: 'contrast', step: 0.05, min: -0.4, max: 0.4 },
  { key: 'saturation', step: 0.1, min: -1, max: 1 },
  { key: 'temperature', step: 0.05, min: -0.3, max: 0.3 },
  { key: 'vignette', step: 0.1, min: 0, max: 1 },
];

/**
 * Grade-réteg panel: az adjust-sáv egy klipjének színvilága. Fent a filmes
 * look-presetek (LUT-szerű grade), alatta a kézi finomhangolás — a preset a
 * kézi adjusttal KOMBINÁLHATÓ (a render előbb a presetet, majd a kézi láncot
 * alkalmazza). A hatás a klip idővonal-ablakában az ALATTA lévő TELJES
 * kompozitra megy (nem-destruktív, CapCut-minta); a pontos színkorrekció a
 * renderben ég be, az előnézet tinttel közelít.
 */
export function AdjustPanel({ clip }: { clip: AdjustClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const adjust = clip.adjust ?? {};
  const grade = clip.grade ?? 'none';
  const isNeutral = ADJUSTS.every(({ key }) => (adjust[key] ?? 0) === 0);

  return (
    <View>
      <PanelSection title={t('panels.adjust.filmLookTitle')}>
        <View style={styles.row}>
          {GRADES.map((g) => (
            <Chip
              key={g.id}
              label={t('panels.adjust.grade_' + g.id)}
              active={grade === g.id}
              onPress={() => updateClip(clip.id, { grade: g.id === 'none' ? undefined : g.id })}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.adjust.filmLookNote')}</Text>
        <Stepper
          label={t('panels.adjust.strengthLabel')}
          value={`${Math.round((clip.strength ?? 1) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { strength: clamp((clip.strength ?? 1) - 0.1, 0, 1) })
          }
          onInc={() =>
            updateClip(clip.id, { strength: clamp((clip.strength ?? 1) + 0.1, 0, 1) })
          }
        />
        <Stepper
          label={t('panels.adjust.fadeInLabel')}
          value={`${(clip.fadeInSec ?? 0).toFixed(1)}s`}
          onDec={() => updateClip(clip.id, { fadeInSec: clamp((clip.fadeInSec ?? 0) - 0.2, 0, 5) })}
          onInc={() => updateClip(clip.id, { fadeInSec: clamp((clip.fadeInSec ?? 0) + 0.2, 0, 5) })}
        />
        <Stepper
          label={t('panels.adjust.fadeOutLabel')}
          value={`${(clip.fadeOutSec ?? 0).toFixed(1)}s`}
          onDec={() =>
            updateClip(clip.id, { fadeOutSec: clamp((clip.fadeOutSec ?? 0) - 0.2, 0, 5) })
          }
          onInc={() =>
            updateClip(clip.id, { fadeOutSec: clamp((clip.fadeOutSec ?? 0) + 0.2, 0, 5) })
          }
        />
      </PanelSection>

      <PanelSection title={t('panels.adjust.manualTuningTitle')}>
        {ADJUSTS.map(({ key, step, min, max }) => {
          const value = adjust[key] ?? 0;
          const set = (v: number) =>
            updateClip(clip.id, {
              adjust: { ...adjust, [key]: Math.round(clamp(v, min, max) * 100) / 100 },
            });
          return (
            <Stepper
              key={key}
              label={t('panels.adjust.adjust_' + key)}
              value={`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
              onDec={() => set(value - step)}
              onInc={() => set(value + step)}
            />
          );
        })}
        {!isNeutral ||
        grade !== 'none' ||
        (clip.strength ?? 1) !== 1 ||
        clip.fadeInSec ||
        clip.fadeOutSec ? (
          <Chip
            label={t('common.reset')}
            active={false}
            onPress={() =>
              updateClip(clip.id, {
                adjust: {},
                grade: undefined,
                strength: undefined,
                fadeInSec: undefined,
                fadeOutSec: undefined,
              })
            }
          />
        ) : null}
        <Text style={styles.note}>{t('panels.adjust.manualTuningNote')}</Text>
      </PanelSection>
    </View>
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
