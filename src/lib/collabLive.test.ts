import { colorForUser } from '@/lib/collabLive';

/**
 * A kollaborátor-színek stabil, id-alapú hozzárendelése (presence + kurzorok).
 * Fontos, hogy determinisztikus legyen: ugyanaz a user MINDIG ugyanazt a színt
 * kapja, minden résztvevő eszközén.
 */
describe('colorForUser', () => {
  it('determinisztikus — ugyanaz az id ugyanazt a színt adja', () => {
    expect(colorForUser('user-abc-123')).toBe(colorForUser('user-abc-123'));
  });

  it('a paletta érvényes hex-színét adja', () => {
    expect(colorForUser('anna')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('több különböző id legalább kétféle színt eredményez (nem konstans)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const colors = new Set(ids.map(colorForUser));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('üres id-re sem dob, valid színt ad', () => {
    expect(colorForUser('')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
