import type { Ionicons } from '@expo/vector-icons';

import { palette } from '@/constants/editor';
import type { RenderJob, RenderPhase } from '@/lib/schedules';

/** 🗓️ A render-sor képernyő fázis/állapot → ikon + szín leképezései (a src/app/schedules.tsx-ből). */

export const DONE_GREEN = '#3ddc84';

export type IconName = keyof typeof Ionicons.glyphMap;

// fázis → ikon + szín (a chiphez és a worker-feladatokhoz)
export const PHASE_META: Record<RenderPhase, { icon: IconName; color: string }> = {
  download: { icon: 'cloud-download-outline', color: '#5ac8fa' },
  render: { icon: 'film-outline', color: palette.accent },
  upload: { icon: 'cloud-upload-outline', color: '#ffb454' },
};

export const STATE_META: Record<RenderJob['state'], { icon: IconName; color: string }> = {
  active: { icon: 'sync', color: palette.accent },
  waiting: { icon: 'time-outline', color: palette.textDim },
  completed: { icon: 'checkmark-circle', color: DONE_GREEN },
  failed: { icon: 'alert-circle', color: palette.danger },
};
