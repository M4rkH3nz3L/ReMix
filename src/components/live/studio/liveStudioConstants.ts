import type { Ionicons } from '@expo/vector-icons';

import type { LiveChannelId, LivePlatform, LiveSourceKind, LiveTransform } from '@/types/live';

/** A Live Studio ikon- és preset-táblái (REFACTOR: a src/app/live/studio/[id].tsx-ből). */

export const CHANNEL_ICON: Record<LiveChannelId, keyof typeof Ionicons.glyphMap> = {
  mic: 'mic',
  music: 'musical-notes',
  media: 'film',
  system: 'phone-portrait',
};
export const GAIN_STEP = 3; // dB

export const SOURCE_ICON: Record<LiveSourceKind, keyof typeof Ionicons.glyphMap> = {
  camera: 'videocam',
  screen: 'desktop',
  image: 'image',
  video: 'film',
  text: 'text',
  shape: 'shapes',
  logo: 'ribbon',
  browser: 'globe',
};

export const ADDABLE: LiveSourceKind[] = ['camera', 'screen', 'image', 'video', 'text', 'shape', 'logo', 'browser'];
export const EXTERNAL_PLATFORMS: { platform: LivePlatform; label: string }[] = [
  { platform: 'youtube', label: 'YouTube' },
  { platform: 'tiktok', label: 'TikTok' },
  { platform: 'twitch', label: 'Twitch' },
  { platform: 'facebook', label: 'Facebook' },
  { platform: 'custom', label: 'RTMP' },
];

/** Elrendezés-presetek a kijelölt forrásnak (drag helyett — OBS-szerű gyors layout). */
export const LAYOUT_PRESETS: { key: string; icon: keyof typeof Ionicons.glyphMap; t: Partial<LiveTransform> }[] = [
  { key: 'full', icon: 'scan', t: { x: 0, y: 0, w: 1, h: 1 } },
  { key: 'left', icon: 'contract', t: { x: 0, y: 0, w: 0.5, h: 1 } },
  { key: 'right', icon: 'contract', t: { x: 0.5, y: 0, w: 0.5, h: 1 } },
  { key: 'tl', icon: 'albums', t: { x: 0.04, y: 0.04, w: 0.3, h: 0.3 } },
  { key: 'tr', icon: 'albums', t: { x: 0.66, y: 0.04, w: 0.3, h: 0.3 } },
  { key: 'center', icon: 'tablet-portrait', t: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
];
