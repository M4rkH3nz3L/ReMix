import { separateStems } from '@/lib/stems';
import { downloadToCache } from '@/lib/media';
import { uploadFetch } from '@/lib/upload';

jest.mock('@/lib/backend', () => ({ ensureCloud: () => 'http://w' }));
jest.mock('@/lib/workerAuth', () => ({ workerAuthHeaders: async () => ({}) }));
jest.mock('@/lib/upload', () => ({ mediaFormData: jest.fn(async () => ({})), uploadFetch: jest.fn() }));
jest.mock('@/lib/media', () => ({ downloadToCache: jest.fn() }));
jest.mock('i18next', () => ({ t: (key: string) => key }));

const reply = (ok: boolean, body: unknown) => (uploadFetch as jest.Mock).mockResolvedValue({ ok, json: async () => body });

beforeEach(() => jest.clearAllMocks());

describe('separateStems (A33/A34)', () => {
  it('a stemek helyi fájlként jönnek vissza, nem szerveres URL-ként', async () => {
    reply(true, { stems: [{ name: 'vocals', url: 'http://w/s/v.wav' }, { name: 'bass', url: 'http://w/s/b.wav' }] });
    (downloadToCache as jest.Mock).mockImplementation(async (_u: string, name: string) => `file:///p/${name}`);
    await expect(separateStems('file:///a.m4a')).resolves.toEqual([
      { name: 'vocals', url: 'file:///p/vocals.wav' },
      { name: 'bass', url: 'file:///p/bass.wav' },
    ]);
  });

  it('az üres eredmény hiba, nem csendes semmi', async () => {
    reply(true, { stems: [] });
    await expect(separateStems('file:///a.m4a')).rejects.toThrow('studio.audio.stemsEmpty');
  });

  it('a sikertelen letöltés hiba, félkész klipek nem jönnek', async () => {
    reply(true, { stems: [{ name: 'vocals', url: 'http://w/s/v.wav' }] });
    (downloadToCache as jest.Mock).mockResolvedValue(null);
    await expect(separateStems('file:///a.m4a')).rejects.toThrow('studio.audio.stemsDownloadFailed');
  });

  it('a foglalt szerver érthető üzenetet ad', async () => {
    reply(false, { error: 'stems_busy' });
    await expect(separateStems('file:///a.m4a')).rejects.toThrow('studio.audio.stemsBusy');
  });
});
