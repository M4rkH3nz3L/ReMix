import { cloudBaseUrl } from '@/lib/backend';
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';

/**
 * 🎚️ Hang-analízis (AUDIO-MASTER Analyze) — a workeren az ffmpeg `loudnorm` mérő-
 * menete méri a hang Integrated LUFS / True Peak / LRA értékeit. A hangot
 * multipartként küldjük (natívan a helyi fájlt, weben blobként — `mediaFormData`).
 */
export interface LoudnessStats {
  lufs: number;
  truePeak: number;
  lra: number;
  /** zaj-alap dB (astats), ha elérhető */
  noise?: number;
  /** dinamika-tartomány dB (astats), ha elérhető */
  dynamicRange?: number;
  /** spektrum-kép URL (a worker `showspectrumpic`-je), ha elérhető */
  spectrum?: string;
}

export async function analyzeAudio(uri: string): Promise<LoudnessStats> {
  const form = await mediaFormData(uri, 'audio', { kind: 'analyze' });
  const res = await uploadFetch(`${cloudBaseUrl()}/audio/analyze`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<LoudnessStats> & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || 'analyze_failed');
  }
  return {
    lufs: Number(body.lufs ?? 0),
    truePeak: Number(body.truePeak ?? 0),
    lra: Number(body.lra ?? 0),
    noise: body.noise,
    dynamicRange: body.dynamicRange,
    spectrum: body.spectrum,
  };
}
