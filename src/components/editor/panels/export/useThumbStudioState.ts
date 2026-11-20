import { useState } from 'react';

import type { ThumbFrame } from '@/lib/thumbStudio';

/** a Thumbnail Studio állapota (kockák + AI-címek) — a panel tartja, a szekció propból kapja */
export function useThumbStudioState() {
  const [thumbStatus, setThumbStatus] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ThumbFrame[] | null>(null);
  const [headlines, setHeadlines] = useState<string[] | null>(null);
  const [headlineStatus, setHeadlineStatus] = useState<string | null>(null);
  const [selectedHeadline, setSelectedHeadline] = useState<string | null>(null);
  return {
    thumbStatus,
    setThumbStatus,
    thumbs,
    setThumbs,
    headlines,
    setHeadlines,
    headlineStatus,
    setHeadlineStatus,
    selectedHeadline,
    setSelectedHeadline,
  };
}

export type ThumbStudioState = ReturnType<typeof useThumbStudioState>;
