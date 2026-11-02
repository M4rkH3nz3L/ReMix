import { analyzeMix } from '@/lib/analyzeMix';
import { exportAudioFile } from '@/lib/render';
import { downloadToCache } from '@/lib/media';
import { analyzeAudio } from '@/lib/audioAnalyze';
import type { Project } from '@/types/project';

const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({ File: jest.fn(() => ({ exists: true, delete: mockDelete })) }));
jest.mock('@/lib/render', () => ({ exportAudioFile: jest.fn() }));
jest.mock('@/lib/media', () => ({ downloadToCache: jest.fn() }));
jest.mock('@/lib/audioAnalyze', () => ({ analyzeAudio: jest.fn() }));

const mix = { id: 'p' } as unknown as Project;

beforeEach(() => {
  jest.clearAllMocks();
  (exportAudioFile as jest.Mock).mockResolvedValue('https://w/render/1/file?t=x');
  (downloadToCache as jest.Mock).mockResolvedValue('file:///media/mix.wav');
  (analyzeAudio as jest.Mock).mockResolvedValue({ lufs: -14, truePeak: -1, lra: 5 });
});

describe('analyzeMix (A19)', () => {
  it('az aktuális mixet rendereli veszteségmentesen, és azt méri', async () => {
    await expect(analyzeMix(mix)).resolves.toMatchObject({ lufs: -14 });
    expect(exportAudioFile).toHaveBeenCalledWith(mix, 'wav', undefined);
    expect(analyzeAudio).toHaveBeenCalledWith('file:///media/mix.wav');
  });

  it('az ideiglenes fájl mérés után és hibánál sem marad a projekt-mappában', async () => {
    await analyzeMix(mix);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    (analyzeAudio as jest.Mock).mockRejectedValue(new Error('analyze_failed'));
    await expect(analyzeMix(mix)).rejects.toThrow('analyze_failed');
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it('sikertelen letöltésnél hibát ad, nem régi mérést', async () => {
    (downloadToCache as jest.Mock).mockResolvedValue(null);
    await expect(analyzeMix(mix)).rejects.toThrow('mix_download_failed');
    expect(analyzeAudio).not.toHaveBeenCalled();
  });
});
