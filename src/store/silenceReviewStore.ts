import { create } from 'zustand';

import type { SilenceCutMode, TimeRange } from '@/lib/audioSilence';
import type { Project, TrackType } from '@/types/project';

/**
 * 🔇 A csend-jóváhagyás állapota (Hang Stúdió): a megtalált csendek a klip sávján, egyenként
 * ki-/bekapcsolhatók, a kivágás módja (csak ez a sáv / minden sáv). Session-állapot, nem a
 * projekt része — a kivágás maga a command buson megy. Ha a projekt közben változik, a talált
 * csendek elavulnak: a `project` a keresés pillanatának állapota.
 */
export interface SilenceReview {
  clipId: string;
  trackType: TrackType;
  ranges: (TimeRange & { on: boolean })[];
  mode: SilenceCutMode;
  project: Project;
}

interface State {
  review: SilenceReview | null;
  start: (r: Omit<SilenceReview, 'mode' | 'ranges'> & { ranges: TimeRange[] }) => void;
  toggle: (index: number) => void;
  setMode: (mode: SilenceCutMode) => void;
  clear: () => void;
}

export const useSilenceReview = create<State>((set) => ({
  review: null,
  start: (r) => set({ review: { ...r, mode: 'track', ranges: r.ranges.map((x) => ({ ...x, on: true })) } }),
  toggle: (index) =>
    set((s) => (s.review ? { review: { ...s.review, ranges: s.review.ranges.map((x, i) => (i === index ? { ...x, on: !x.on } : x)) } } : s)),
  setMode: (mode) => set((s) => (s.review ? { review: { ...s.review, mode } } : s)),
  clear: () => set({ review: null }),
}));
