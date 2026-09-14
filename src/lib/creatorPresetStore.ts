import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CreatorPreset } from '@/lib/creatorPreset';

/** 🎨 Creator Preset-ek tárolása — app-szintű, projekteken átívelő (AsyncStorage). */

const KEY = 'vided.creatorpresets.v1';

export async function loadCreatorPresets(): Promise<CreatorPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as CreatorPreset[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveCreatorPreset(preset: CreatorPreset): Promise<CreatorPreset[]> {
  const list = await loadCreatorPresets();
  // azonos nevűt felülír, egyébként az elejére szúr
  const next = [preset, ...list.filter((p) => p.name !== preset.name)];
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function deleteCreatorPreset(id: string): Promise<CreatorPreset[]> {
  const list = await loadCreatorPresets();
  const next = list.filter((p) => p.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
