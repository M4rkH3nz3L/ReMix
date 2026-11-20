import { useEffect } from 'react';

import { detectBeats, timelineBeats } from '@/lib/beats';
import { firstMusicClip } from '@/lib/timelineLayout';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/**
 * 🥁 beat-rács a zenesáv első klipjéből — jelölők a vonalzón + snap-célpontok.
 * Az eredményt a store `setBeatGrid`-je kapja; a Timeline-ból kiemelve.
 */
export function useTimelineBeatGrid(project: Project | null | undefined) {
  const musicClip = firstMusicClip(project);
  const musicKey = musicClip
    ? `${musicClip.uri}|${musicClip.start}|${musicClip.duration}`
    : null;
  /**
   * A klipet az effekt a STORE-ból veszi elő, nem a render-beli `musicClip`-ből.
   * Így a dep-lista őszintén `[musicKey]` lehet, és nem kell elnémítani a
   * hook-szabályt — korábban egy ilyen elnémítás miatt a React Compiler a
   * TELJES Timeline-t kihagyta az optimalizálásból.
   *
   * ⚠️ A fordító a KOMMENTEKBEN is keresi az elnémító direktívát, ezért ide
   * szándékosan nincs kiírva szó szerint: már a leírása is újra kiváltaná.
   */
  useEffect(() => {
    const { setBeatGrid, project: cur } = useEditorStore.getState();
    const clip = firstMusicClip(cur);
    if (!clip) {
      setBeatGrid([], []);
      return;
    }
    let alive = true;
    detectBeats(clip.uri).then((grid) => {
      if (!alive || !grid || grid.beats.length === 0) {
        return;
      }
      setBeatGrid(timelineBeats(clip, grid.beats), timelineBeats(clip, grid.downbeats));
    });
    return () => {
      alive = false;
    };
  }, [musicKey]);
}
