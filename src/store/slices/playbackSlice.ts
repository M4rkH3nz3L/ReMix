/**
 * 🧱 playback-slice — transport (playhead/play/loop/rate), tartomány (In/Out),
 * master-hangerő, variant-preview, téma-kijelölő és a video-voice flag.
 *
 * Mind SESSION-szintű (nem projekt-adat). A rAF-mesteróra
 * (`usePlaybackClock`) ezt az állapotot olvassa/írja.
 */
import { projectFps, snapToFrame } from '@/lib/frames';
import { projectDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';

import { SESSION_RESET, type EditorState } from '../editorState';
import type { EditorSlice } from './types';

type PlaybackSlice = Pick<
  EditorState,
  | 'playhead'
  | 'isPlaying'
  | 'loop'
  | 'playbackRate'
  | 'rangeIn'
  | 'rangeOut'
  | 'masterVolume'
  | 'videoVoiceActive'
  | 'variantPreview'
  | 'pickTarget'
  | 'setPlayhead'
  | 'setPlaying'
  | 'setLoop'
  | 'setPlaybackRate'
  | 'shuttle'
  | 'setRangeIn'
  | 'setRangeOut'
  | 'clearRange'
  | 'setMasterVolume'
  | 'setVideoVoiceActive'
  | 'setVariantPreview'
  | 'setPickTarget'
>;

export const createPlaybackSlice: EditorSlice<PlaybackSlice> = (set, get) => ({
  playhead: 0,
  isPlaying: false,
  loop: false,
  playbackRate: SESSION_RESET.playbackRate,
  rangeIn: SESSION_RESET.rangeIn,
  rangeOut: SESSION_RESET.rangeOut,
  masterVolume: SESSION_RESET.masterVolume,
  videoVoiceActive: SESSION_RESET.videoVoiceActive,
  variantPreview: SESSION_RESET.variantPreview,
  pickTarget: SESSION_RESET.pickTarget,

  setRangeIn: () => {
    const { playhead, rangeOut } = get();
    const t = Math.round(playhead * 100) / 100;
    set({ rangeIn: t, rangeOut: rangeOut != null && rangeOut > t ? rangeOut : null });
  },
  setRangeOut: () => {
    const { playhead, rangeIn } = get();
    const t = Math.round(playhead * 100) / 100;
    set({ rangeOut: t, rangeIn: rangeIn != null && rangeIn < t ? rangeIn : null });
  },
  clearRange: () => set({ rangeIn: null, rangeOut: null }),

  setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),

  setVideoVoiceActive: (on) => set({ videoVoiceActive: on }),

  setPlayhead: (t, snap) => {
    const { project } = get();
    const max = project ? Math.max(projectDuration(project), 0) : 0;
    const clamped = clamp(t, 0, Math.max(max, 0));
    // 🎞️ scrub/koppintáskor a frame-rácsra ül (fél-kocka csúszás már látszik); a
    // lejátszó-óra snap NÉLKÜL hívja (folytonos lejátszás, nem ugrál kockánként)
    set({ playhead: snap ? snapToFrame(clamped, projectFps(project)) : clamped });
  },

  setPlaying: (playing) => set({ isPlaying: playing }),

  setLoop: (loop) => set({ loop }),

  setPlaybackRate: (rate) => set({ playbackRate: rate }),

  shuttle: (dir) => {
    // sebesség-létra: 1× → 2× → 4× (irány szerint előjelezve). Ellentétes irányba
    // koppintva először 1×-re vált, csak azonos irányban gyorsít tovább.
    const LADDER = [1, 2, 4];
    const cur = get().playbackRate;
    const sameDir = dir > 0 ? cur >= 1 : cur <= -1;
    const mag = sameDir ? LADDER[Math.min(LADDER.indexOf(Math.abs(cur)) + 1, LADDER.length - 1)] ?? 1 : 1;
    set({ playbackRate: dir * mag, isPlaying: true });
  },

  setVariantPreview: (ranges) => set({ variantPreview: ranges }),
  setPickTarget: (fn) => set({ pickTarget: fn }),
});
