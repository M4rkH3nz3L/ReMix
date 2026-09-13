import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import type { ColorStats } from '@/lib/colorAuto';
import { ensureCloud } from '@/lib/backend';
import { renderServerUrl } from '@/lib/render';

/**
 * 🎨 Color AI hálózati kliens: a worker /color/stats végpontja egy képkocka
 * szín-statisztikáit adja (a pure leképezők a colorAuto.ts-ben).
 */
export async function fetchColorStats(
  uri: string,
  atSec = 0
): Promise<ColorStats | null> {
  const base = ensureCloud('colorAi');
  try {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('media', blob, uri.split('/').pop() ?? 'media');
    } else {
      form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    }
    form.append('atSec', String(Math.max(0, atSec)));
    const res = await uploadFetch(`${base}/color/stats`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as ColorStats;
    return typeof body.lumaMean === 'number' ? body : null;
  } catch {
    return null;
  }
}

/**
 * 🎨 Színpipetta: a worker /color/pixel végpontja a médiakocka pixel-színét adja
 * a (x,y) vászon-normalizált ponton — a manuális green screen kulcshoz. INGYEN
 * (mint a beat/hullámforma): `renderServerUrl` báziscím, nincs Pro-kapu.
 */
export async function fetchPixelColor(
  uri: string,
  atSec: number,
  x: number,
  y: number
): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const base = renderServerUrl();
  try {
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    form.append('atSec', String(Math.max(0, atSec)));
    form.append('x', String(x));
    form.append('y', String(y));
    const res = await uploadFetch(`${base}/color/pixel`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { color?: string };
    return typeof body.color === 'string' ? body.color : null;
  } catch {
    return null;
  }
}
