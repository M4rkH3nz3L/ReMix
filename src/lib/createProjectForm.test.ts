import { missingCreateFields, missingSeoFields } from '@/lib/createProjectForm';

const full = { name: 'Projekt', description: 'Leírás', hashtags: '#teszt', keywords: 'teszt' };

describe('missingCreateFields — S22: létrehozáskor csak a név kötelező', () => {
  it('kitöltött űrlap: semmi sem hiányzik', () => {
    expect(missingCreateFields(full)).toEqual([]);
  });
  it('a SEO nélküli, de elnevezett projekt létrehozható (gyors kép 3 koppintással)', () => {
    expect(missingCreateFields({ name: 'Gyors kép', description: '', hashtags: '', keywords: '' })).toEqual([]);
  });
  it('név nélkül nem; a csak szóköz = hiányzik', () => {
    expect(missingCreateFields({ ...full, name: '   ' })).toEqual(['name']);
  });
});

describe('missingSeoFields — a megosztáskor kötelező SEO', () => {
  it('üres: mind a három, az űrlap sorrendjében', () => {
    expect(missingSeoFields({ description: '', hashtags: '', keywords: '' })).toEqual(['description', 'hashtags', 'keywords']);
  });
  it('értelmetlen hashtag-szöveg = hiányzik; kitöltve semmi', () => {
    expect(missingSeoFields({ ...full, hashtags: ' , ' })).toEqual(['hashtags']);
    expect(missingSeoFields(full)).toEqual([]);
  });
});
