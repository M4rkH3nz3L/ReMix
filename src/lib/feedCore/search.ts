import type { Creator, FeedPost } from '@/types/social';

/** Keresés eredménye: illeszkedő posztok + a belőlük kinyert egyedi alkotók. */
export interface SearchResults {
  posts: FeedPost[];
  creators: Creator[];
}

/** PostgREST `.or()`-érték: idézőjelben a vessző és a zárójel nem szűrő-szintaxis. */
export function orFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}
