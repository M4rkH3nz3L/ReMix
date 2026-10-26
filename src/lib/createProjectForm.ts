import { parseHashtags, parseKeywords } from '@/lib/projectUtils';

/**
 * 📝 Az Új projekt űrlap kötelező mezői — MELYIK hiányzik (sorrendben).
 *
 * MIÉRT: a „Létrehozás" gomb eddig szó nélkül tiltott volt, míg minden mező ki nem
 * volt töltve — a felhasználó nem tudta, mit keressen (élő iPhone-teszt, T1/11).
 * A képernyő ebből írja ki, mi hiányzik, és az elsőre ugrik.
 */
export type CreateFieldId = 'name' | 'description' | 'hashtags' | 'keywords';

export interface CreateFormValues {
  name: string;
  description: string;
  hashtags: string;
  keywords: string;
}

export function missingCreateFields(v: CreateFormValues): CreateFieldId[] {
  const out: CreateFieldId[] = [];
  if (!v.name.trim()) {
    out.push('name');
  }
  if (!v.description.trim()) {
    out.push('description');
  }
  if (parseHashtags(v.hashtags).length === 0) {
    out.push('hashtags');
  }
  if (parseKeywords(v.keywords).length === 0) {
    out.push('keywords');
  }
  return out;
}
