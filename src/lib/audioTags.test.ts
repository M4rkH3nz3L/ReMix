/**
 * 🏷️ PRO-AUDIO 17/1: a cím és az előadó a fájl címkéjéből (ID3v2, MP4, FLAC, WAV), valódi
 * ffmpeg-gel címkézett fájlokon, ékezetes szöveggel.
 */
type Bytes = { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
const { execFileSync, spawnSync } = jest.requireActual('child_process') as {
  execFileSync: (cmd: string, args: string[], opts?: object) => Bytes;
  spawnSync: (cmd: string, args: string[]) => { status: number | null };
};
const fs = jest.requireActual('fs') as { mkdtempSync: (p: string) => string; rmSync: (p: string, o: object) => void; readFileSync: (p: string) => Bytes };
const os = jest.requireActual('os') as { tmpdir: () => string };
const path = jest.requireActual('path') as { join: (...p: string[]) => string };

import { readAudioTags, tagLabel } from '@/lib/audioTags';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (process.env.CI && !hasFfmpeg) {
  throw new Error('A CI-ben kötelező az ffmpeg (a hang-minőségkapukhoz).');
}
const bytes = (b: Bytes) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const headTail = (all: Uint8Array) => ({ head: all.subarray(0, 256 * 1024), tail: all.subarray(Math.max(0, all.length - 256 * 1024)) });

(hasFfmpeg ? describe : describe.skip)('readAudioTags — valódi fájlok', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const make = (ext: string, extra: string[] = []) => {
    const f = path.join(dir, `t.${ext}`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...extra, '-metadata', 'title=Őszi éjszaka', '-metadata', 'artist=Kovács Béla', f]);
    return bytes(fs.readFileSync(f));
  };

  it.each(['mp3', 'm4a', 'flac', 'wav'])('%s: cím és előadó', (ext) => {
    const { head, tail } = headTail(make(ext));
    expect(readAudioTags(head, tail)).toEqual({ title: 'Őszi éjszaka', artist: 'Kovács Béla' });
  });

  it('MP3 ID3v2.3, UTF-16 kódolással is', () => {
    const { head, tail } = headTail(make('mp3', ['-id3v2_version', '3']));
    expect(readAudioTags(head, tail)).toEqual({ title: 'Őszi éjszaka', artist: 'Kovács Béla' });
  });

  it('címke nélküli fájl: üres', () => {
    const f = path.join(dir, 'n.wav');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-map_metadata', '-1', '-fflags', '+bitexact', f]);
    const { head, tail } = headTail(bytes(fs.readFileSync(f)));
    expect(readAudioTags(head, tail)).toEqual({});
  });
});

describe('tagLabel', () => {
  it('„előadó – cím”, csak cím, vagy a fájlnév', () => {
    expect(tagLabel({ title: 'Dal', artist: 'Béla' }, 'x.mp3')).toBe('Béla – Dal');
    expect(tagLabel({ title: 'Dal' }, 'x.mp3')).toBe('Dal');
    expect(tagLabel({}, 'x.mp3')).toBe('x.mp3');
    expect(tagLabel({ title: '   ' }, 'x.mp3')).toBe('x.mp3');
  });

  it('a szemét bájtokra nem dob', () => {
    expect(readAudioTags(new Uint8Array([1, 2, 3]), new Uint8Array())).toEqual({});
    expect(readAudioTags(new TextEncoder().encode('ID3\u0004\u0000\u0000\u007f\u007f\u007f\u007f'), new Uint8Array())).toEqual({});
  });
});
