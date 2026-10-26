import { isMachineFileName, mediaDisplayName } from '@/lib/mediaDisplayName';

describe('mediaDisplayName', () => {
  it('gép-generált nevek → null', () => {
    expect(mediaDisplayName('file:///media/mvptb3mn_8D46C0B4-C735-48A1-9F3B-12AB34CD56EF.mov')).toBeNull();
    expect(mediaDisplayName('file:///x/3f2a9c1e4b7d8a6f5e4d3c2b1a0f9e8d.mp4')).toBeNull();
    expect(isMachineFileName('8D46C0B4-C735-48A1-9F3B-12AB34CD56EF.MOV')).toBe(true);
  });
  it('emberi fájlnév kiterjesztés nélkül, URL-dekódolva', () => {
    expect(mediaDisplayName('file:///a/Nyaral%C3%A1s%202026.mov')).toBe('Nyaralás 2026');
    expect(mediaDisplayName('https://cdn.x/IMG_4512.MOV?token=abc')).toBe('IMG_4512');
  });
  it('üres / hibás kódolás nem dob', () => {
    expect(mediaDisplayName('')).toBeNull();
    expect(mediaDisplayName('file:///a/rossz%E0%A4.mp4')).toBe('rossz%E0%A4');
  });
});
