import { missingCreateFields } from '@/lib/createProjectForm';

const full = { name: 'Projekt', description: 'Leírás', hashtags: '#teszt', keywords: 'teszt' };

describe('missingCreateFields', () => {
  it('kitöltött űrlap: semmi sem hiányzik', () => {
    expect(missingCreateFields(full)).toEqual([]);
  });
  it('üres űrlap: mind a négy, az űrlap sorrendjében', () => {
    expect(missingCreateFields({ name: '', description: '', hashtags: '', keywords: '' })).toEqual([
      'name',
      'description',
      'hashtags',
      'keywords',
    ]);
  });
  it('csak szóközök = hiányzik; értelmetlen hashtag-szöveg = hiányzik', () => {
    expect(missingCreateFields({ ...full, name: '   ' })).toEqual(['name']);
    expect(missingCreateFields({ ...full, hashtags: ' , ' })).toEqual(['hashtags']);
  });
});
