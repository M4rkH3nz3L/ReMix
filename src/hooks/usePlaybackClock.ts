import { useEffect } from 'react';

import { projectDuration } from '@/lib/projectUtils';
import { stepPreviewPlayhead } from '@/lib/variantPreview';
import { useEditorStore } from '@/store/editorStore';

/**
 * A lejátszást egy requestAnimationFrame-óra hajtja: a playhead a "mester",
 * a videó/hang rétegek ehhez szinkronizálnak. Így a vágás, a szöveg-animáció
 * és az interaktív elemek időzítése egyetlen órán múlik.
 *
 * ▶ Változat-előnézet módban (Auto Edit) az óra a keep-sávokon ugrálva halad
 * — a sávok sorrendjében, a projekt módosítása nélkül.
 */
export function usePlaybackClock(): void {
  const isPlaying = useEditorStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        const dt = (now - last) / 1000;
        const { playhead, project, loop, variantPreview, setPlayhead, setPlaying } =
          useEditorStore.getState();
        if (variantPreview && variantPreview.length > 0) {
          const step = stepPreviewPlayhead(variantPreview, playhead, dt, loop);
          setPlayhead(step.playhead);
          if (!step.playing) {
            setPlaying(false);
            return;
          }
        } else {
          const duration = project ? projectDuration(project) : 0;
          const next = playhead + dt;
          if (next >= duration) {
            if (loop && duration > 0) {
              setPlayhead(0);
            } else {
              setPlayhead(duration);
              setPlaying(false);
              return;
            }
          } else {
            setPlayhead(next);
          }
        }
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);
}
