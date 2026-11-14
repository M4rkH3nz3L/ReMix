import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { logCaught } from '@/lib/logCaught';
import { parseMidi, writeMidi, type MidiSong } from '@/lib/midiFile';
import { projectExportDir } from '@/lib/model3dRenderClient';

/**
 * 🎼 MIDI-fájl a telefonon (V1): beolvasás a Fájlokból és kiírás a projekt Export-mappájába + megosztás.
 * A formátum-logika a pure `midiFile.ts`-ben.
 */

/** egy `.mid` fájl hangjai (uri-ról) — hiba: null */
export function readMidiFile(uri: string): MidiSong | null {
  try {
    const f = new File(uri);
    const h = f.open();
    try {
      return parseMidi(h.readBytes(f.size ?? 0));
    } finally {
      h.close();
    }
  } catch (caught) {
    logCaught('lib/midiClient.ts:readMidiFile', caught);
    return null;
  }
}

/** fájlválasztó → hangok; mégse → undefined, hiba → null */
export async function pickMidiFile(): Promise<MidiSong | null | undefined> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['audio/midi', 'audio/x-midi', 'application/x-midi', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || r.assets.length === 0) return undefined;
  return readMidiFile(r.assets[0].uri);
}

/** a dallam `.mid`-be a projekt Export-mappájába; `share`: rendszer-megosztólap — a fájl uri-ja */
export async function exportMidiFile(
  name: string,
  notes: readonly { midi: number; startBeat: number; lengthBeats: number; velocity?: number }[],
  opts: { bpm: number; beatsPerBar?: number; beatUnit?: number; share?: boolean }
): Promise<string> {
  const safe = name.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dallam';
  const f = new File(projectExportDir(), `${safe}.mid`);
  if (f.exists) f.delete();
  f.create();
  f.write(writeMidi(notes, opts));
  if (opts.share !== false && (await Sharing.isAvailableAsync())) {
    await Sharing.shareAsync(f.uri, { mimeType: 'audio/midi' }).catch((caught) => logCaught('lib/midiClient.ts:share', caught));
  }
  return f.uri;
}
