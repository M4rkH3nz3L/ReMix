// A kereshető dokumentum-modell (minden scope közös alakja)

export type SearchScope =
  | 'project'
  | 'asset'
  | 'person'
  | 'message'
  | 'music'
  | 'photo'
  | 'video'
  | 'document'
  | 'template'
  | 'shop'
  | 'ai';

export interface SearchDoc {
  id: string;
  scope: SearchScope;
  title: string;
  subtitle?: string;
  /** extra kereshető szöveg (tagek, leírás). */
  keywords?: string[];
  thumbUri?: string;
  createdAt?: string;
  updatedAt?: string;
  /** tetszőleges strukturált mező (pl. `{ status, progress, published }`). */
  meta?: Record<string, unknown>;
}

export interface SearchResult extends SearchDoc {
  score: number;
}
