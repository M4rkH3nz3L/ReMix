// 📎 A projekt feltöltendő médiafájljai és a fájlnév — expo-mentes mag.
import type { Project } from '@/types/project';

export function fileName(uri: string): string {
  const last = uri.split('/').pop() ?? 'media';
  return last.split('?')[0];
}

export function mediaUris(project: Project): string[] {
  const uris = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') {
        uris.add(clip.uri);
      }
      if (clip.kind === 'shape' && clip.imageUri) {
        uris.add(clip.imageUri);
      }
      // 🎭 track/luma matte és 🎞️ 3D LUT: ezek is a worker FFmpeg `-i`-jére
      // mennek, tehát fel KELL tölteni őket. (Enélkül a felhő-render az eszköz
      // helyi útvonalát kapná — ami ott nem létezik —, a worker pedig
      // ellenőrzés nélkül nyitná meg: lásd a `/render` URI-átírását.)
      if ('matte' in clip && clip.matte?.uri) {
        uris.add(clip.matte.uri);
      }
      if ('adjust' in clip && clip.adjust?.lut?.uri) {
        uris.add(clip.adjust.lut.uri);
      }
    }
  }
  return [...uris];
}
