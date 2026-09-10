import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * SDK 57-kompatibilis multipart fájl-feltöltés. A régi RN-trükk —
 * `form.append('media', { uri, name, type } as any)` — a 0.86-os fetch alatt
 * „Unsupported FormDataPart implementation” hibával elhal; a helyes minta:
 * `expo-file-system` File (Blob-interfészt ad) + `expo/fetch`.
 * Minden worker-feltöltés ezen a segéden megy át.
 */

/** FormData a médiafájllal — natívan File-lal, weben letöltött blobbal */
export async function mediaFormData(uri: string, name?: string): Promise<FormData> {
  const form = new FormData();
  const fileName = name ?? uri.split('/').pop()?.split('?')[0] ?? 'media';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('media', blob, fileName);
  } else {
    form.append('media', new File(uri) as unknown as Blob, fileName);
  }
  return form;
}

/** a feltöltésekhez való fetch (spec-hű; a body-ban a File-t is érti) */
export function uploadFetch(
  url: string,
  init: {
    method?: string;
    body?: FormData | string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
): Promise<Response> {
  return expoFetch(url, init as never) as unknown as Promise<Response>;
}
