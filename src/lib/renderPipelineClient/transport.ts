// 🌐 Hálózati segédek a render-klienshez: multipart média-rész, időkorlátos fetch.
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Egy médiafájl hozzáadása a multipart formhoz. Natívan az expo-file-system
 * `File` adja a Blob-interfészt; WEBEN a `new File(uri)` nem létezik (natív-only),
 * ezért az URI-t (blob:/data:/http) blobként töltjük le és úgy fűzzük hozzá.
 */
export async function appendMediaPart(
  form: FormData,
  field: string,
  uri: string,
  name: string
): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, name);
  } else {
    form.append(field, new File(uri) as unknown as Blob, name);
  }
}


export async function fetchWithTimeout(url: string, ms: number, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
