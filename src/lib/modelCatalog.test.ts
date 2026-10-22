import {
  BUILD_ENGINES,
  catalogAvailability,
  catalogEntry,
  catalogForModality,
  catalogForTask,
  catalogUsable,
  deviceCapsFromCatalog,
  MODEL_CATALOG,
  modelAllowedForTask,
} from '@/lib/modelCatalog';

/**
 * 🏭 Gyári katalógus + cél-kötés (local-ai 5.1/5.2) — a kötést a FELOLDÓ
 * ellenőrzi, nem a UI; a státusz-mátrix determinista.
 */

describe('modelCatalog — integritás', () => {
  it('az id-k egyediek', () => {
    const ids = MODEL_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('minden letölthető manifest sha256-ja 64 hex karakter és a mérete pozitív', () => {
    for (const e of MODEL_CATALOG) {
      if (e.manifest) {
        expect(e.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(e.manifest.sizeBytes).toBeGreaterThan(0);
        expect(e.manifest.url).toMatch(/^https:\/\//);
        expect(e.manifest.id).toBe(e.id);
      }
    }
  });

  it('manifest csak device-elemen lehet', () => {
    for (const e of MODEL_CATALOG) {
      if (e.where !== 'device') {
        expect(e.manifest).toBeUndefined();
      }
    }
  });

  it('a worker-elem (ReMix Assistant) mind a 6 feladatot viszi', () => {
    expect(catalogEntry('remix-assistant')?.tasks).toHaveLength(6);
  });
});

describe('modelCatalog — cél-kötés', () => {
  it('a Whisper CSAK transcribe: feladatra nem fogható', () => {
    const whisper = catalogEntry('whisper-tiny-q8')!;
    expect(whisper.modalities).toEqual(['transcribe']);
    expect(modelAllowedForTask(whisper, 'assistant')).toBe(false);
    expect(modelAllowedForTask(whisper, 'captionStudio')).toBe(false);
  });

  it('az SLM csak a deklarált feladataira fogható', () => {
    const slm = catalogEntry('slm-small')!;
    expect(modelAllowedForTask(slm, 'assistant')).toBe(true);
    expect(modelAllowedForTask(slm, 'autoEdit')).toBe(false);
    expect(modelAllowedForTask(slm, 'storyStructure')).toBe(false);
  });

  it('catalogForTask: assistant-ra a worker + SLM jön vissza, transcribe-modell nem', () => {
    const ids = catalogForTask('assistant').map((e) => e.id);
    expect(ids).toContain('remix-assistant');
    expect(ids).toContain('slm-small');
    expect(ids).not.toContain('whisper-tiny-q8');
  });

  it('catalogForModality: transcribe-ra a whisper-variánsok + VAD + OS-beszéd', () => {
    const ids = catalogForModality('transcribe').map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining(['whisper-tiny-q8', 'whisper-base-q5', 'silero-vad', 'os-speech']),
    );
  });
});

describe('modelCatalog — státusz-mátrix', () => {
  const whisper = () => catalogEntry('whisper-tiny-q8')!;

  it('worker-elem mindig aktív (motor-flagtől függetlenül)', () => {
    expect(catalogAvailability(catalogEntry('remix-assistant')!, { engines: {} })).toBe('active');
  });

  it('ebben a buildben a device-motorok hiányoznak → engine_missing (őszinte státusz)', () => {
    expect(BUILD_ENGINES['whisper-rn']).toBe(false);
    expect(catalogAvailability(whisper())).toBe('engine_missing');
  });

  it('motorral: letöltés előtt downloadable, után downloaded, smoke-pass után validated', () => {
    const engines = { 'whisper-rn': true } as const;
    expect(catalogAvailability(whisper(), { engines })).toBe('downloadable');
    expect(catalogAvailability(whisper(), { engines, downloaded: ['whisper-tiny-q8'] })).toBe(
      'downloaded',
    );
    expect(
      catalogAvailability(whisper(), {
        engines,
        downloaded: ['whisper-tiny-q8'],
        smoke: { 'whisper-tiny-q8': 'pass' },
      }),
    ).toBe('validated');
  });

  it('smoke-FAIL → failed, akkor is, ha a fájl le van töltve (BP-13)', () => {
    const rt = {
      engines: { 'whisper-rn': true },
      downloaded: ['whisper-tiny-q8'],
      smoke: { 'whisper-tiny-q8': 'fail' as const },
    };
    expect(catalogAvailability(whisper(), rt)).toBe('failed');
    expect(catalogUsable(whisper(), rt)).toBe(false);
  });

  it('A-tier gate: kevés RAM → gated; elég RAM + nincs még manifest → planned', () => {
    const slm = catalogEntry('slm-small')!;
    const engines = { executorch: true };
    expect(catalogAvailability(slm, { engines, deviceRamGb: 6 })).toBe('gated');
    expect(catalogAvailability(slm, { engines, deviceRamGb: 12 })).toBe('planned');
  });

  it('tervezett elem (embed-encoder) manifest nélkül motorral is csak planned', () => {
    const embed = catalogEntry('embed-encoder')!;
    expect(catalogAvailability(embed, { engines: { executorch: true } })).toBe('planned');
  });

  it('motorral érkező beépített elem (Silero VAD) a motorral együtt aktív', () => {
    const vad = catalogEntry('silero-vad')!;
    expect(catalogAvailability(vad)).toBe('engine_missing');
    expect(catalogAvailability(vad, { engines: { 'whisper-rn': true } })).toBe('active');
  });
});

describe('modelCatalog — deviceCaps a routinghoz (06.1)', () => {
  it('alap-buildben is van lokál smallText (ReMix Lokál heurisztika) — más nincs', () => {
    // 🧩 „mindenből legyen ingyenes local": a js-heurisztika minden buildben él
    expect(deviceCapsFromCatalog().modalities).toEqual(['smallText']);
  });

  it('validált whisper + aktív VAD → transcribe képesség; a csak-letöltött NEM számít', () => {
    const caps = deviceCapsFromCatalog({
      engines: { 'whisper-rn': true },
      downloaded: ['whisper-tiny-q8', 'whisper-base-q5'],
      smoke: { 'whisper-tiny-q8': 'pass' },
    });
    expect(caps.modalities).toContain('transcribe');
    expect(caps.modalities).not.toContain('embed');
  });

  it('a worker-elem modalitásai SOSEM számítanak eszköz-képességnek', () => {
    const caps = deviceCapsFromCatalog({ engines: { worker: true } });
    expect(caps.modalities).not.toContain('text');
  });
});
