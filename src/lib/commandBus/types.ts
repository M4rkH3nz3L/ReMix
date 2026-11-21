import type { LiveDoc } from '@/types/live';
import type { Model3DDoc } from '@/types/model3d';
import type { AlbumDoc, AspectRatio, Asset, AssetSource, AudioBus, TrackSidechain, AudioMaster, Chapter, Clip, ImageDoc, InstrumentDoc, Marker, ParticlesConfig, Project, TempoChange, TimelineRegion, Track, TrackType, ProjectFont, ProjectSeo } from '@/types/project';
import type { WorkflowRun } from '@/lib/workflowTemplate';

/** 🧾 A command-bus típusai: a parancs-unió, a szereplő és a projekt-történet bejegyzése. */

export type EditorCommand =
  | { type: 'ADD_CLIP'; trackType: TrackType; clip: Clip; asset?: Asset }
  | { type: 'ADD_CLIPS'; trackType: TrackType; clips: Clip[] }
  | { type: 'UPDATE_CLIP'; clipId: string; patch: Partial<Clip> }
  | { type: 'REMOVE_CLIP'; clipId: string }
  /** klip másik (kompatibilis) sávra mozgatása + új kezdet (frame-illesztett a hívónál) */
  | { type: 'MOVE_CLIP'; clipId: string; toTrackType: TrackType; start: number }
  | { type: 'SPLIT_CLIP'; clipId: string; time: number }
  | { type: 'SET_ASPECT'; aspectRatio: AspectRatio }
  | { type: 'SET_FPS'; fps: number }
  | { type: 'RENAME_PROJECT'; name: string }
  /** ☁️ a projekt-mappa ReMix Storage-szinkronjának be/ki kapcsolása (projekt-beállítás) */
  | { type: 'SET_PROJECT_SYNC'; enabled: boolean }
  /** 🖼️ a projekt borítóképe / album-borítója (null → eltávolítás; a kép-asset regisztrálódik) */
  | { type: 'SET_PROJECT_COVER'; asset: Asset | null }
  /** 📣 S22: a közzétételi (SEO) adatok — a megosztás előtti kapu írja */
  | { type: 'SET_PROJECT_SEO'; seo: ProjectSeo }
  /** 🖼️ CORE K5: a szerkeszthető thumbnail lapja (`imageDocs` egyik eleme); null = nincs */
  | { type: 'SET_THUMBNAIL_DOC'; docId: string | null }
  /** 🔤 IMAGE-PROD S10: a projekt saját betűtípus-listája (import / eltávolítás) */
  | { type: 'SET_PROJECT_FONTS'; fonts: ProjectFont[] }
  | { type: 'ADD_ASSET'; asset: Asset }
  | { type: 'UPDATE_ASSET'; assetId: string; patch: Partial<Asset> }
  | { type: 'REMOVE_ASSET'; assetId: string }
  /** teljes sáv-újraépítés egy undo-lépésben (pl. AI cut-lista alkalmazása) */
  | { type: 'REPLACE_TRACK_CLIPS'; trackType: TrackType; clips: Clip[] }
  /**
   * TÖBB sáv újraépítése egy undo-lépésben — olyan műveletekhez, amik az egész
   * idővonalat mozgatják (pl. intro beszúrása: minden sáv csúszik).
   */
  | {
      type: 'REPLACE_TRACKS';
      tracks: { trackType: TrackType; clips: Clip[] }[];
      assets?: Asset[];
      label?: string;
    }
  | { type: 'RELINK_URI'; oldUri: string; newUri: string }
  /**
   * 👥 Teljes állapot-szinkron (élő collab): a visszavonás/újra a társ-szerkesztőknél is
   * ugyanoda álljon, ha az eltérés nem fejezhető ki célzott parancsokkal
   * (`undoSyncCommands`). Az eszköz-szintű mezők (mappa, szinkron) helyiek maradnak.
   */
  | { type: 'RESTORE_SNAPSHOT'; project: Project; label?: string }
  | {
      type: 'RELINK_ASSET';
      assetId: string;
      newUri: string;
      /** 🔗 linked asset frissítése: az új forrás-verzió és a fájl hossza (a klipek hossz-szabálya a `relinkPlan`-ban) */
      source?: AssetSource;
      duration?: number;
    }
  /** ✨ projekt-szintű részecske-réteg be/ki (null = kikapcsol) */
  | { type: 'SET_PARTICLES'; particles: ParticlesConfig | null }
  /** 🔖 a marker-lista cseréje (hozzáadás/törlés/átnevezés egy lépésben) */
  | { type: 'SET_MARKERS'; markers: Marker[] }
  | { type: 'SET_CHAPTERS'; chapters: Chapter[] }
  | { type: 'SET_AUDIO_MASTER'; audioMaster: AudioMaster | null }
  | { type: 'SET_TRACK_GAIN'; trackType: TrackType; gain: number }
  | { type: 'ADD_TRACK'; track: Track }
  /** 🎚️ V9: sávonkénti sidechain (null = ki) */
  | { type: 'SET_TRACK_SIDECHAIN'; trackType: TrackType; sidechain: TrackSidechain | null }
  | { type: 'REMOVE_TRACK'; trackType: TrackType }
  | { type: 'RENAME_TRACK'; trackType: TrackType; name: string }
  | { type: 'SET_AUDIO_BUSES'; buses: AudioBus[] }
  | { type: 'SET_TRACK_SEND'; trackType: TrackType; busId: string; amount: number }
  | { type: 'SET_REGIONS'; regions: TimelineRegion[] }
  | { type: 'SET_LOCKED_TRACKS'; lockedTracks: TrackType[] }
  | { type: 'SET_LINKS'; links: string[][] }
  /**
   * 🎨 Kép-dokumentum beírása (létrehozás ÉS módosítás). A réteg-műveletek
   * pure függvények (imageDoc.ts), az eredményt EZ a parancs teszi be — így a
   * réteg-szerkesztés is undo-zható, ugyanúgy, mint bármi más.
   */
  | { type: 'UPSERT_IMAGE_DOC'; doc: ImageDoc; label?: string }
  | { type: 'REMOVE_IMAGE_DOC'; docId: string }
  /** 🎹🥁 hangszer-minta beírása (létrehozás ÉS módosítás) — a sütött klip szerkeszthető forrása */
  | { type: 'UPSERT_INSTRUMENT_DOC'; doc: InstrumentDoc }
  /** 🖼️📄 Kép-lapok ÁTRENDEZÉSE (galéria-sorrend): az `order` az új id-sorrend; a
   *  listában nem szereplő lapok a végükön maradnak (stabil). Undo-zható. */
  | { type: 'REORDER_IMAGE_DOCS'; order: string[] }
  /**
   * 🎥 Live-produkció dokumentum beírása (létrehozás ÉS módosítás). A jelenet-/
   * forrás-/cél-műveletek pure függvények (`liveDoc.ts`), az eredményt EZ a
   * parancs teszi a `project.live`-ba — így a live-szerkesztés is undo-zható
   * (mint `UPSERT_IMAGE_DOC`), és élőben a data-channelre broadcastolható.
   */
  | { type: 'SET_LIVE_DOC'; doc: LiveDoc; label?: string }
  /** 🎵 Projekt-tempó (BPM) a Hang Stúdió ütem-rácsához/snap-jéhez. 20–300 közé szorítva. */
  | { type: 'SET_BPM'; bpm: number }
  | { type: 'SET_TIME_SIGNATURE'; timeSignature: { beatsPerBar: number; beatUnit: 4 | 8 } }
  /** 🎼 Tempóváltások (S13): a teljes lista cseréje (rendezve, csak atBeat > 0); üres → nincs tempóváltás */
  | { type: 'SET_TEMPO_MAP'; tempoMap: TempoChange[] }
  /** ▶️ Munkafolyamat-futás (C4): a teljes állapot cseréje; null → a futás vége */
  | { type: 'SET_WORKFLOW_RUN'; run: WorkflowRun | null }
  /**
   * 🎧💿 Album-dokumentum beírása (Hang Stúdió: több szám + borító). A manifeszt-CRUD pure
   * (`albumDoc.ts`), az eredményt EZ a parancs teszi a `project.album`-ba — ÉS az idővonalat
   * reconciliálja: a JELENLEGI `project.tracks`-ot az ELŐZŐ aktív számba menti, majd az ÚJ
   * aktív szám sávjait tölti be. Így a szám-váltás/add/remove is egyetlen undo-lépés, és az
   * audio-editor változatlanul a `project.tracks`-ot (= az aktív számot) szerkeszti.
   */
  | { type: 'APPLY_ALBUM'; album: AlbumDoc; label?: string }
  /**
   * 🧊 3D-dokumentum beírása (létrehozás ÉS módosítás) — a `SET_LIVE_DOC` mintájára:
   * a csomópont-/anyag-/mérés-műveletek pure függvények (`model3dDoc.ts`), az
   * eredményt EZ a parancs teszi a `project.model3d`-be → undo-zható, broadcastolható.
   * A hálók NEM itt élnek (csak `assetId`-hivatkozás) — a parancs kicsi marad.
   */
  | { type: 'SET_MODEL3D_DOC'; doc: Model3DDoc; label?: string };

export type EventActor = 'user' | 'ai' | 'system' | 'remote';

/** A projekt-történet egy bejegyzése — az AI-memória (F3) nyersanyaga. */
export interface ProjectEvent {
  id: string;
  /** ISO időbélyeg */
  at: string;
  actor: EventActor;
  command: EditorCommand;
  /**
   * A command nehéz mezői (klip-tömbök, kép-rétegek) csonkolva vannak — lásd
   * `lib/eventLog.ts`. Ilyen commandot TILOS `applyCommand`-dal alkalmazni; a
   * napló csak `describeCommand()`-hoz való.
   */
  slim?: true;
}

/** Egy adott típusú parancs (a reducerek paramétere). */
export type CommandOf<T extends EditorCommand['type']> = Extract<EditorCommand, { type: T }>;
