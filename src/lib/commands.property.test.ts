import * as fc from 'fast-check';

import { applyCommand, type EditorCommand } from '@/lib/commands';
import { canHostClip, compatibleTracksFor } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AspectRatio, AudioClip, Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🎲 A command-bus reducer (applyCommand) TULAJDONSÁGAI véletlen command-sorozatokon (fast-check).
 * A példa-alapú commands.test.ts egy-egy parancsot néz; ez a kombinációkat:
 *  • a bemenet sosem mutálódik (mélyen fagyasztott projekten fut — egy írás TypeError-t dob),
 *  • `null` = nincs változás, nem-null = új objektum;
 *  • a sorozat után a projekt séma-érvényes (egyedi id-k, kompatibilis sáv, pozitív hossz);
 *  • frame-rácson érkező bemenetből frame-rácson maradó vágás / mozgatás lesz;
 *  • a store-ban undo∘do = azonosság (minden lépés visszavonva → az eredeti projekt), redo → a vég.
 * A seed rögzített → determinisztikus; bukáskor a fast-check a minimális ellenpéldát mutatja.
 */

const SEED = 20261119;
const RUNS = 150;

const TRACK_TYPES: TrackType[] = ['video', 'pip', 'adjust', 'text', 'captions', 'overlay', 'interactive', 'music', 'voiceover', 'sfx'];
const FPS_CHOICES = [24, 25, 30, 60];
const ASPECTS: AspectRatio[] = ['9:16', '16:9', '1:1'];

function makeProject(fps: number): Project {
  return {
    id: 'p1',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps,
    tracks: TRACK_TYPES.map((type): Track => ({ id: `trk-${type}`, type, name: type, clips: [] })),
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

function videoClip(id: string, start: number, duration: number): VideoClip {
  return { id, kind: 'video', start, duration, uri: `file:///${id}.mp4`, trimIn: 0, sourceDuration: duration, speed: 1, volume: 1, filterId: 'none' };
}

function audioClip(id: string, start: number, duration: number): AudioClip {
  return { id, kind: 'audio', start, duration, uri: `file:///${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
}

// ── szándékok: állapot-független leírások, amiket az aktuális projektre fordítunk ─────────────
type Intent =
  | { op: 'add'; kind: 'video' | 'audio'; track: number; startF: number; durF: number }
  | { op: 'remove'; pick: number }
  | { op: 'move'; pick: number; track: number; startF: number }
  | { op: 'split'; pick: number; at: number }
  | { op: 'volume'; pick: number; volume: number }
  | { op: 'rename'; name: string }
  | { op: 'aspect'; aspect: number }
  | { op: 'markers'; framesAt: number[] }
  | { op: 'gain'; track: number; gain: number }
  | { op: 'bpm'; bpm: number };

const intentArb: fc.Arbitrary<Intent> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ op: fc.constant('add' as const), kind: fc.constantFrom('video' as const, 'audio' as const), track: fc.nat(), startF: fc.nat({ max: 600 }), durF: fc.integer({ min: 1, max: 300 }) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('remove' as const), pick: fc.nat() }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant('move' as const), pick: fc.nat(), track: fc.nat(), startF: fc.nat({ max: 600 }) }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant('split' as const), pick: fc.nat(), at: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('volume' as const), pick: fc.nat(), volume: fc.double({ min: 0, max: 2, noNaN: true }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('rename' as const), name: fc.string({ maxLength: 12 }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('aspect' as const), aspect: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('markers' as const), framesAt: fc.array(fc.nat({ max: 900 }), { maxLength: 4 }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('gain' as const), track: fc.nat(), gain: fc.double({ min: 0, max: 2, noNaN: true }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('bpm' as const), bpm: fc.integer({ min: 1, max: 400 }) }) },
);

const allClips = (p: Project): Clip[] => p.tracks.flatMap((t) => t.clips);

/** A szándék → command az aktuális projekten; a frame-rácsra eső időkkel. null = nincs mit tenni. */
function toCommand(p: Project, intent: Intent, fps: number, nextId: () => string): EditorCommand | null {
  const clips = allClips(p);
  const pick = (n: number) => (clips.length ? clips[n % clips.length] : null);
  switch (intent.op) {
    case 'add': {
      const hosts = compatibleTracksFor(intent.kind);
      const trackType = hosts[intent.track % hosts.length];
      const id = nextId();
      const clip = intent.kind === 'video'
        ? videoClip(id, intent.startF / fps, intent.durF / fps)
        : audioClip(id, intent.startF / fps, intent.durF / fps);
      return { type: 'ADD_CLIP', trackType, clip };
    }
    case 'remove': {
      const c = pick(intent.pick);
      return c ? { type: 'REMOVE_CLIP', clipId: c.id } : null;
    }
    case 'move': {
      const c = pick(intent.pick);
      if (!c) return null;
      const hosts = compatibleTracksFor(c.kind);
      return { type: 'MOVE_CLIP', clipId: c.id, toTrackType: hosts[intent.track % hosts.length], start: intent.startF / fps };
    }
    case 'split': {
      const c = pick(intent.pick);
      if (!c) return null;
      const frames = Math.round(c.duration * fps);
      if (frames < 2) return null;
      return { type: 'SPLIT_CLIP', clipId: c.id, time: (Math.round(c.start * fps) + 1 + (intent.at % (frames - 1))) / fps };
    }
    case 'volume': {
      const c = pick(intent.pick);
      return c ? { type: 'UPDATE_CLIP', clipId: c.id, patch: { volume: intent.volume } as Partial<Clip> } : null;
    }
    case 'rename':
      return { type: 'RENAME_PROJECT', name: intent.name };
    case 'aspect':
      return { type: 'SET_ASPECT', aspectRatio: ASPECTS[intent.aspect % ASPECTS.length] };
    case 'markers':
      return { type: 'SET_MARKERS', markers: intent.framesAt.map((f, i) => ({ id: `m${i}`, time: f / fps, label: `M${i}` })) };
    case 'gain':
      return { type: 'SET_TRACK_GAIN', trackType: TRACK_TYPES[intent.track % TRACK_TYPES.length], gain: intent.gain };
    case 'bpm':
      return { type: 'SET_BPM', bpm: intent.bpm };
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const onGrid = (sec: number, fps: number) => Math.abs(sec * fps - Math.round(sec * fps)) < 1e-6;

/** A séma-érvényesség megsértései (üres = érvényes). */
function violations(p: Project, fps: number): string[] {
  const out: string[] = [];
  const types = p.tracks.map((t) => t.type);
  if (new Set(types).size !== types.length) out.push('ismétlődő sáv-típus');
  const ids = allClips(p).map((c) => c.id);
  if (new Set(ids).size !== ids.length) out.push('ismétlődő klip-id');
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (!canHostClip(t.type, c.kind)) out.push(`${c.kind} klip a ${t.type} sávon`);
      if (!(Number.isFinite(c.start) && c.start >= 0)) out.push(`${c.id}: érvénytelen kezdet ${c.start}`);
      if (!(Number.isFinite(c.duration) && c.duration > 0)) out.push(`${c.id}: érvénytelen hossz ${c.duration}`);
      if (!onGrid(c.start, fps) || !onGrid(c.duration, fps)) out.push(`${c.id}: frame-rácson kívül (${c.start} / ${c.duration} @ ${fps})`);
    }
  }
  if (!(Number.isInteger(p.fps) && (p.fps ?? 0) > 0)) out.push('érvénytelen fps');
  return out;
}

/** A sorozat lefuttatása a pure reduceren; visszaadja a köztes állapotokat. */
function runSequence(fps: number, intents: Intent[]) {
  let n = 0;
  const nextId = () => `c${(n += 1)}`;
  let project = deepFreeze(makeProject(fps));
  const states = [project];
  const commands: EditorCommand[] = [];
  for (const intent of intents) {
    const cmd = toCommand(project, intent, fps, nextId);
    if (!cmd) continue;
    const before = JSON.stringify(project);
    const next = applyCommand(project, cmd);
    // a bemenet érintetlen (a fagyasztás az írást dobná, a JSON-összevetés a csendes cserét is fogja)
    expect(JSON.stringify(project)).toBe(before);
    if (next === null) continue;
    expect(next).not.toBe(project);
    project = deepFreeze(next);
    states.push(project);
    commands.push(cmd);
  }
  return { project, states, commands };
}

describe('applyCommand — tulajdonságok véletlen sorozatokon', () => {
  it('nem mutál, séma-érvényes és frame-rácson marad', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FPS_CHOICES), fc.array(intentArb, { maxLength: 40 }), (fps, intents) => {
        const { states } = runSequence(fps, intents);
        for (const s of states) expect(violations(s, fps)).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('az idempotens beállító parancs (név, képarány) másodszorra null — nincs üres undo-lépés', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FPS_CHOICES), fc.array(intentArb, { maxLength: 25 }), (fps, intents) => {
        const { project, commands } = runSequence(fps, intents);
        for (const cmd of commands.filter((c) => c.type === 'RENAME_PROJECT' || c.type === 'SET_ASPECT')) {
          const once = applyCommand(project, cmd) ?? project;
          expect(applyCommand(once, cmd)).toBeNull();
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('a hossz összege a vágásnál megmarad (split = a két darab pontosan kitölti az eredetit)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FPS_CHOICES), fc.integer({ min: 2, max: 400 }), fc.nat(), fc.nat({ max: 300 }), (fps, durF, at, startF) => {
        const p = deepFreeze({ ...makeProject(fps), tracks: makeProject(fps).tracks.map((t) => (t.type === 'video' ? { ...t, clips: [videoClip('v', startF / fps, durF / fps)] } : t)) });
        const time = (startF + 1 + (at % (durF - 1))) / fps;
        const next = applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'v', time });
        if (!next) return; // a MIN_CLIP_DURATION alatti darab → szándékos no-op
        const [a, b] = next.tracks.find((t) => t.type === 'video')!.clips;
        expect(a.start).toBeCloseTo(startF / fps, 9);
        expect(a.start + a.duration).toBeCloseTo(b.start, 9);
        expect(b.start + b.duration).toBeCloseTo((startF + durF) / fps, 9);
        expect(violations(next, fps)).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe('store — undo∘do = azonosság', () => {
  const store = () => useEditorStore.getState();
  let warnSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    store().closeProject();
    warnSpy.mockRestore();
  });

  it('minden lépés visszavonása az eredeti projektet adja, az újra-végrehajtás a végállapotot', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FPS_CHOICES), fc.array(intentArb, { maxLength: 30 }), (fps, intents) => {
        store().loadProject(makeProject(fps));
        const original = JSON.stringify(store().project!.tracks);
        let n = 0;
        const nextId = () => `c${(n += 1)}`;
        for (const intent of intents) {
          const cmd = toCommand(store().project!, intent, fps, nextId);
          if (cmd) store().dispatch(cmd);
        }
        expect(violations(store().project!, fps)).toEqual([]);
        const afterDo = JSON.stringify(store().project);
        while (store().past.length > 0) store().undo();
        expect(JSON.stringify(store().project!.tracks)).toBe(original);
        while (store().future.length > 0) store().redo();
        expect(JSON.stringify(store().project)).toBe(afterDo);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });
});

describe('karakterizáció — a mai viselkedés rögzítése', () => {
  const p = makeProject(30);

  // KÉRDÉS: az ADD_CLIP nem ellenőrzi a sáv–klip kompatibilitást (a MOVE_CLIP igen) — egy hang-klip
  // a szöveg-sávra kerülhet. A hívók (UI, AI-validáció) ma kiszűrik; maradjon a reducer engedékeny,
  // vagy adjon null-t, mint a MOVE_CLIP?
  it('ADD_CLIP: az inkompatibilis sávra is beteszi a klipet', () => {
    const next = applyCommand(p, { type: 'ADD_CLIP', trackType: 'text', clip: audioClip('a', 0, 1) });
    expect(next?.tracks.find((t) => t.type === 'text')?.clips.map((c) => c.id)).toEqual(['a']);
  });

  // KÉRDÉS: az ADD_CLIP a már létező klip-id-t is beteszi (két klip ugyanazzal az id-val) — a findClip
  // ezután mindig az elsőt találja. Szándékos (a hívó garantálja az egyediséget), vagy null legyen?
  it('ADD_CLIP: a duplikált id-t sem utasítja el', () => {
    const once = applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('v', 0, 1) })!;
    const twice = applyCommand(once, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('v', 2, 1) });
    expect(twice?.tracks.find((t) => t.type === 'video')?.clips.map((c) => c.id)).toEqual(['v', 'v']);
  });

  // KÉRDÉS: a SET_FPS csak a számot írja át, a klipeket NEM illeszti az új frame-rácsra — 30 → 25 fps
  // után egy 1/30 mp-es kezdet rácson kívül marad. A szerkesztő a következő vágásnál illeszt; kell-e
  // itt (egy undo-lépésben) újra-rácsozni?
  it('SET_FPS: a klipek a régi rácson maradnak', () => {
    const withClip = applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('v', 1 / 30, 1) })!;
    const next = applyCommand(withClip, { type: 'SET_FPS', fps: 25 })!;
    expect(next.fps).toBe(25);
    expect(next.tracks.find((t) => t.type === 'video')!.clips[0].start).toBe(1 / 30);
    expect(onGrid(1 / 30, 25)).toBe(false);
  });
});
