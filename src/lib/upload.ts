import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { workerAuthHeaders } from '@/lib/workerAuth';

/**
 * SDK 57-kompatibilis multipart fájl-feltöltés. A régi RN-trükk —
 * `form.append('media', { uri, name, type } as any)` — a 0.86-os fetch alatt
 * „Unsupported FormDataPart implementation” hibával elhal; a helyes minta:
 * `expo-file-system` File (Blob-interfészt ad) + `expo/fetch`.
 * Minden worker-feltöltés ezen a segéden megy át.
 */

/**
 * FormData a médiafájllal — natívan File-lal, weben letöltött blobbal. A `fields`
 * extra szöveges mezőket tesz a formba (pl. `projectId`, `kind`) → a worker ebből
 * építi a projekt-rendezett Storage-kulcsot (`<projectId>/<kind>/<fájl>`).
 */
export async function mediaFormData(
  uri: string,
  name?: string,
  fields?: Record<string, string>
): Promise<FormData> {
  const form = new FormData();
  const fileName = name ?? uri.split('/').pop()?.split('?')[0] ?? 'media';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('media', blob, fileName);
  } else {
    form.append('media', new File(uri) as unknown as Blob, fileName);
  }
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value) {
        form.append(key, value);
      }
    }
  }
  return form;
}

/** a feltöltésekhez való fetch (spec-hű; a body-ban a File-t is érti) */
export async function uploadFetch(
  url: string,
  init: {
    method?: string;
    body?: FormData | string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
): Promise<Response> {
  // 🔐 Minden worker-hívás a bejelentkezett user Supabase-JWT-jével megy: a worker
  // `requireAuth`-ot kér a compute/upload-végpontokra, és a hívó azonosítóját a
  // tokenből veszi (nem a bodyból). Mivel az uploadFetch KIZÁRÓLAG a worker felé
  // hív (lásd a fenti modul-kommentet — nincs külső/S3 URL), itt központilag,
  // egy helyen szúrjuk be az auth-fejlécet → nem kell minden kliensben külön.
  // A hívó saját fejlécei felülírhatják (pl. `Content-Type`), az `Authorization`
  // viszont alapból bekerül. Kijelentkezve `workerAuthHeaders()` üreset ad → a
  // viselkedés a korábbival azonos (a worker ad 401-et, dev-ben átenged).
  const auth = await workerAuthHeaders();
  const merged = { ...init, headers: { ...auth, ...(init.headers ?? {}) } };
  // A visszatérési cast MARAD: az `expo/fetch` saját `FetchResponse`-t ad, ami
  // szerkezetileg Response-kompatibilis, de nem az.
  return expoFetch(url, merged) as unknown as Promise<Response>;
}
