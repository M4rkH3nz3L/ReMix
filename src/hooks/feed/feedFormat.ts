import type { InteractiveClip } from '@/types/project';
import type { FeedPost } from '@/types/social';

/** Egy poszt interaktív (hotspot) klipjei a poszton hordozott interaktív rétegből. */
export function hotspotsOf(post: FeedPost): InteractiveClip[] {
  const track = post.interactive?.tracks?.find((tr) => tr.type === 'interactive');
  return (track?.clips ?? []).filter((c): c is InteractiveClip => c.kind === 'interactive');
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
