import { useTranslation } from 'react-i18next';

import { PanelSection, Stepper } from '@/components/ui/controls';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/** megjelenés: méret, pozíció, forgatás, nyírás, perspektíva, pivot, átlátszóság — numerikus léptetőkkel */
export function AppearanceSection({ clip, updateClip }: { clip: VideoClip | ImageClip; updateClip: EditorState['updateClip'] }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.appearanceTitle')}>
      {/* 🔭 Méret + pozíció numerikus mezők (a gesztus-szerkesztés precíz párja) */}
      <Stepper
        label={t('panels.precision.scale', { defaultValue: 'Méret' })}
        value={`${(clip.transform?.scale ?? 1).toFixed(2)}×`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              scale: clamp(Math.round(((clip.transform?.scale ?? 1) - 0.1) * 100) / 100, 0.2, 4),
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              scale: clamp(Math.round(((clip.transform?.scale ?? 1) + 0.1) * 100) / 100, 0.2, 4),
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.posX', { defaultValue: 'Pozíció X' })}
        value={`${Math.round((clip.transform?.x ?? 0) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              x: clamp(Math.round(((clip.transform?.x ?? 0) - 0.05) * 100) / 100, -0.75, 0.75),
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              x: clamp(Math.round(((clip.transform?.x ?? 0) + 0.05) * 100) / 100, -0.75, 0.75),
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.posY', { defaultValue: 'Pozíció Y' })}
        value={`${Math.round((clip.transform?.y ?? 0) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              y: clamp(Math.round(((clip.transform?.y ?? 0) - 0.05) * 100) / 100, -0.75, 0.75),
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              y: clamp(Math.round(((clip.transform?.y ?? 0) + 0.05) * 100) / 100, -0.75, 0.75),
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.rotation')}
        value={`${clip.transform?.rotation ?? 0}°`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              rotation: ((clip.transform?.rotation ?? 0) - 5 + 360) % 360,
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              rotation: ((clip.transform?.rotation ?? 0) + 5) % 360,
            },
          })
        }
      />
      {/* ⬛ Nyírás (skew) X/Y — audit §6.6 */}
      <Stepper
        label={t('panels.precision.skewX', { defaultValue: 'Nyírás X' })}
        value={`${clip.transform?.skewX ?? 0}°`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              skewX: clamp((clip.transform?.skewX ?? 0) - 5, -45, 45) || undefined,
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              skewX: clamp((clip.transform?.skewX ?? 0) + 5, -45, 45) || undefined,
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.skewY', { defaultValue: 'Nyírás Y' })}
        value={`${clip.transform?.skewY ?? 0}°`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              skewY: clamp((clip.transform?.skewY ?? 0) - 5, -45, 45) || undefined,
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              skewY: clamp((clip.transform?.skewY ?? 0) + 5, -45, 45) || undefined,
            },
          })
        }
      />
      {/* 📐 Perspektíva / corner-pin X/Y — a klip egyik éle hátradől (−1…1), VIDEOT §4 */}
      <Stepper
        label={t('panels.precision.perspectiveX', { defaultValue: 'Perspektíva ↔' })}
        value={`${Math.round((clip.transform?.perspectiveX ?? 0) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              perspectiveX: clamp((clip.transform?.perspectiveX ?? 0) - 0.1, -1, 1) || undefined,
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              perspectiveX: clamp((clip.transform?.perspectiveX ?? 0) + 0.1, -1, 1) || undefined,
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.perspectiveY', { defaultValue: 'Perspektíva ↕' })}
        value={`${Math.round((clip.transform?.perspectiveY ?? 0) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              perspectiveY: clamp((clip.transform?.perspectiveY ?? 0) - 0.1, -1, 1) || undefined,
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              perspectiveY: clamp((clip.transform?.perspectiveY ?? 0) + 0.1, -1, 1) || undefined,
            },
          })
        }
      />
      {/* ⚓ Pivot (anchor) X/Y — a forgatás/méretezés középpontja, audit §6.6 */}
      <Stepper
        label={t('panels.precision.anchorX', { defaultValue: 'Pivot X' })}
        value={`${Math.round((clip.transform?.anchorX ?? 0.5) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              anchorX: clamp((clip.transform?.anchorX ?? 0.5) - 0.1, 0, 1),
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              anchorX: clamp((clip.transform?.anchorX ?? 0.5) + 0.1, 0, 1),
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.anchorY', { defaultValue: 'Pivot Y' })}
        value={`${Math.round((clip.transform?.anchorY ?? 0.5) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              anchorY: clamp((clip.transform?.anchorY ?? 0.5) - 0.1, 0, 1),
            },
          })
        }
        onInc={() =>
          updateClip(clip.id, {
            transform: {
              ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
              anchorY: clamp((clip.transform?.anchorY ?? 0.5) + 0.1, 0, 1),
            },
          })
        }
      />
      <Stepper
        label={t('panels.precision.opacity')}
        value={`${Math.round((clip.opacity ?? 1) * 100)}%`}
        onDec={() =>
          updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) - 0.1, 0.1, 1) })
        }
        onInc={() =>
          updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) + 0.1, 0.1, 1) })
        }
      />
    </PanelSection>
  );
}
