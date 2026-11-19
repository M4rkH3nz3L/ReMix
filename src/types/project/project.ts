import type { LiveDoc } from '../live';
import type { Model3DDoc } from '../model3d';
import type { Asset, ProjectFont } from './assets';
import type { AudioFx, InstrumentDoc, TempoChange } from './audioClips';
import type { AspectRatio, ProjectKind, TrackType } from './common';
import type { ImageDoc } from './image';
import type { Chapter, Marker, ParticlesConfig, TimelineRegion, Track } from './timeline';

/**
 * 🎧💿 Album-SZÁM (Hang Stúdió): egy önálló, teljes idővonallal bíró szám az albumban.
 * A NEM-aktív számok idővonala ITT pihen (`tracks`/`assets`); az ÉPPEN szerkesztett szám
 * idővonala a `project.tracks`-ban él (az `APPLY_ALBUM` command snapshot-olja/tölti be).
 */
export interface AlbumSong {
  id: string;
  name: string;
  /** a szám sávjai (a nem-aktív számé; az aktívé a project.tracks-ban) */
  tracks: Track[];
  /** a szám által hivatkozott médiafájlok (a nem-aktív számé) */
  assets: Asset[];
  /** utolsó renderelt hossz mp (a megosztáshoz/albumlistához) */
  durationSec?: number;
  /** a szám renderelt hangja (helyi uri) — a megosztáskor ez megy az albumba */
  renderedUri?: string;
  /** a `renderedUri` melyik tartalomból készült (`songRenderKey`) — elavulás-észlelés */
  renderedKey?: string;
  /** a feltöltött publikus URL (feed/album-poszt) */
  renderedUrl?: string;
}

/**
 * 🎧💿 ALBUM-dokumentum (Hang Stúdió): a hang-projekt EGY album → több szám + egy BORÍTÓ.
 * Additív/opcionális: album nélkül a hang-projekt a megszokott egy-idővonalas szám. Az
 * `activeSongId` a `project.tracks`-ban élő szám; a borító egy `ImageDoc` a
 * `project.imageDocs`-ban (a kép-szerkesztővel szerkeszthető → közös motor).
 */
export interface AlbumDoc {
  songs: AlbumSong[];
  /** az éppen szerkesztett szám id-ja (a project.tracks ezt tükrözi) */
  activeSongId: string;
  /** borító: egy ImageDoc id-ja a project.imageDocs-ban */
  coverDocId?: string;
}

/**
 * 🔎 SEO / közzétételi meta — a felfedezéshez: a TikTok/Reels felirat + hashtag
 * és a YouTube cím/leírás/kulcsszavak. A projekt LÉTREHOZÁSAKOR kötelezően
 * kitöltött (lásd az „Új projekt” űrlapot a főképernyőn); a social `FeedPost`
 * (title/description/hashtags) egy-az-egyben erre képződik le. A hashtagek és a
 * kulcsszavak `#` nélkül, trimmelve, duplikátum-mentesen tárolódnak.
 */
export interface ProjectSeo {
  /** közzétételi cím (kulcsszavas; a `name`-től eltérhet) */
  title: string;
  /** leírás/felirat kulcsszavakkal */
  description: string;
  /** hashtagek `#` nélkül */
  hashtags: string[];
  /** kulcsszavak (YouTube-tagek) */
  keywords: string[];
}

/**
 * 🎞️ A projekt RENDERELT VÁLTOZATA — a kész MP4, a projekthez tárolva. A `uri`
 * a helyi, perzisztált fájl (azonnali lejátszás/újramegosztás); a `url` a
 * feltöltött publikus cím (a feed / cross-device lejátszáshoz). Újrarenderelésig
 * érvényes.
 */
export interface RenderedVersion {
  uri: string;
  url?: string;
  posterUri?: string;
  posterUrl?: string;
  /** a poszter melyik thumbnail-lap verziójából készült (`stillVersion`) — CORE K5 */
  posterKey?: string;
  renderedAt: string;
  durationSec: number;
  width?: number;
  height?: number;
}

/** 🎚️ Projekt-szintű MASTER (AUDIO-MASTER): a teljes keverék hangosítása/plafonja. */
export type AudioMasterTarget =
  | 'video'
  | 'podcast'
  | 'music'
  | 'social'
  // 🎯 platform-célú presetek (a publikálási hangosság-szabványokhoz)
  | 'youtube'
  | 'spotify'
  | 'appleMusic'
  | 'tiktok'
  | 'club'
  | 'custom';
export type AudioMasterDynamics = 'natural' | 'balanced' | 'punchy';
export interface AudioMaster {
  /** cél-preset (a többi mezőt ez tölti, kivéve 'custom') */
  target: AudioMasterTarget;
  /** integrált hangosság cél (LUFS) — a renderben KÉTMENETES `loudnorm` */
  lufs: number;
  /** valódi csúcs plafon (dBTP) — a renderben `loudnorm=TP` + `alimiter` */
  truePeak: number;
  /** dinamika-jelleg (a loudnorm LRA-ját hangolja) */
  dynamics: AudioMasterDynamics;
  /** 🎛️ master-EQ (dB, ±12): tonális balansz a végső keveréken. Mind 0 = ki */
  eq?: { low: number; mid: number; high: number };
  /** multiband kompresszor (mcompand) — a keverék dinamikájának faragása */
  multiband?: boolean;
  /** 🗜️ master-kompresszor (küszöb dBFS, arány) — a multiband után, a hangosság-illesztés előtt */
  compressor?: { threshold: number; ratio: number };
  /** 🔥 szaturáció (0–1): lágy telítés, `tanh(k·x)/tanh(k)`, k = 1 + 7·mérték — felharmonikusok, „melegség” */
  saturation?: number;
  /** 🎚️ sidechain-duck TRIGGER sáv: az `autoDuck` klipek EZ a sáv hangja alatt halkulnak
   *  (hiányzó = a voiceover/beszéd — a mai viselkedés). Pl. 'sfx' → a zene a hangeffektek alatt duckol. */
  duckTrigger?: TrackType;
}

/**
 * 🎚️ Effekt-busz (pl. közös zengés): a sávok küldés-mértékkel (`audioSends`) kevernek rá, a busz
 * a saját effekt-láncán át (a klip-effektekkel azonos DSP) a master elé kerül.
 */
/**
 * 🎚️ V9 sávonkénti sidechain: ez a sáv a `from` sáv (eredeti, halkítás előtti) jele alatt halkul — `ratio`-val
 * (2–20; a küszöb, a felfutás és az elengedés a régi halkításé: 0,02 / 25 ms / 350 ms). Több csoport is lehet.
 */
export interface TrackSidechain {
  from: TrackType;
  ratio: number;
}

export interface AudioBus {
  id: string;
  name: string;
  /** a busz effektjei (tipikusan zengés / visszhang) */
  fx: AudioFx;
  /** a busz visszatérő szintje 0–1 */
  gain: number;
}

export interface Project {
  id: string;
  name: string;
  /** 🎛️ a projekt fajtája (melyik stúdió); hiányzó = 'video' (régi projektek) */
  kind?: ProjectKind;
  aspectRatio: AspectRatio;
  /** 🎞️ szerkesztési frame-ráta (timebase): a vágások/kulcskockák erre a rácsra
   *  ülnek, a timecode (HH:MM:SS:FF) ebből számol. Hiányzó = DEFAULT_FPS (30). */
  fps?: number;
  /** 🎵 zenei tempó (BPM) a Hang Stúdió ütem-rácsához/metronómjához/snap-jéhez.
   *  Hiányzó = 120. Csak a zenei időzítés-UI használja; a render-re nincs hatása. */
  bpm?: number;
  /** 🎼 ütemjelzés (hiányzó = 4/4); a BPM negyedhangra értendő, /8-nál a rács nyolcadonként */
  timeSignature?: { beatsPerBar: number; beatUnit: 4 | 8 };
  /**
   * 🎼 Tempóváltások (MU4 · AUDIO-PROD S13): a `bpm` az induló tempó (0. beattől), ezek a későbbi
   * szegmensek beat-pozíció szerint (csak `atBeat > 0`, növekvő). A rács, a snap, az ütemre vágás,
   * a metronóm és az ütem:beat kijelzés a tempo-mapet követi (`projectTiming`). Hiányzó = állandó tempó.
   */
  tempoMap?: TempoChange[];
  /**
   * ▶️ Futó munkafolyamat (AUDIO-PROD C4 · SC7): a lépések állapota (pl. Podcast-epizód: felvétel → … → publikálás).
   * A projekt része (mentés, felhő, visszavonás); a Hang Stúdió sávja mutatja. Hiányzó = nincs futás.
   */
  workflowRun?: import('@/lib/workflowTemplate').WorkflowRun;
  /** 🔎 SEO / közzétételi meta (a létrehozáskor kötelező — lásd ProjectSeo) */
  seo?: ProjectSeo;
  /** 🎞️ a legutóbb renderelt kész MP4 (a projekthez tárolva; lásd RenderedVersion) */
  rendered?: RenderedVersion;
  /** 🖼️ CORE K5: a szerkeszthető thumbnail (`imageDocs` egyik lapja) — a projekt-előnézet és a feed-poszter forrása */
  thumbnailDocId?: string;
  /** 🔤 IMAGE-PROD S10 · DS2: a projektbe importált saját betűtípusok (a fájl a projekt mappájában) */
  fonts?: ProjectFont[];
  tracks: Track[];
  /** a projekt által hivatkozott médiafájlok */
  assets: Asset[];
  /** ✨ render-oldali részecske-réteg (hiányzó = nincs) */
  particles?: ParticlesConfig;
  /** 🔖 szerkezeti jelölők az idővonalon */
  markers?: Marker[];
  /** 🔒 zárolt sávok (közös szerkesztésben a társnál is): rájuk nem lehet írni — a parancs-buszon szinkronizálódik */
  lockedTracks?: TrackType[];
  /** 🏷️ névvel jelölt idő-tartományok (szervezés/navigáció; nem renderelődik) */
  regions?: TimelineRegion[];
  /** 🎬 story-struktúra fejezetek (Hook/Context/Value/CTA) — a videó „térképe" */
  chapters?: Chapter[];
  /** 🔀 remix-forrás: miből készült ez a projekt (duplikálás/remix). A lineage-
   *  lánc a szülő-hivatkozások mentén bejárható; a `postId` a forrás FEED-poszté,
   *  hogy publikáláskor a remix a poszthoz csatolódjon (remix_of_post_id). */
  remixOf?: { projectId: string; name: string; postId?: string };
  /** 🛒 a boltban megvett sablonból készült: az eredeti tétel — újra-közzétételkor a remix-
   *  jutalék (PRO-CASH 6.1) ennek az alkotójának jár (a szerver ellenőrzi a vásárlást). */
  shopOrigin?: { itemId: string };
  /** 🔗 link-csoportok: az egy csoportban lévő klipek együtt mozognak (persisztált) */
  links?: string[][];
  /**
   * 🎨 Kép-dokumentumok (Creative Canvas): a projekthez tartozó réteg-fák.
   * A vászonra kirasterizált PNG-jük képklipként kerül az idővonalra, de a
   * réteg-fa itt marad — ezért bármikor újraszerkeszthető.
   */
  imageDocs?: ImageDoc[];
  /**
   * 🎹🥁 Hangszer-minták (Hang Stúdió): a dobgép és a piano roll szerkeszthető forrása. A sütött
   * hang-klip `instrumentDocId`-vel hivatkozik ide, így a minta a sütés után is szerkeszthető.
   */
  instrumentDocs?: InstrumentDoc[];
  /**
   * 🎧💿 Album (Hang Stúdió): több szám + borító. Jelenléte → a projekt album-mód (a
   * `project.tracks` az `album.activeSongId` számot tükrözi). Hiányzó = egy-idővonalas szám.
   */
  album?: AlbumDoc;
  /** 🎚️ projekt-szintű audio-master (hiányzó = nincs; opcionális/additív) */
  audioMaster?: AudioMaster;
  /** 🎚️ sávonkénti mixer-gain (fader, 0–1) — a music/voiceover/sfx sávokra; a
   *  hiányzó sáv = 1.0. Az előnézetben ÉS a renderben érvényesül (persistált). */
  trackMix?: Partial<Record<TrackType, { gain: number; sidechain?: TrackSidechain }>>;
  /** 🎚️ effekt-buszok (a Hang Stúdió keverőjében) */
  audioBuses?: AudioBus[];
  /** 🎚️ küldések: sáv → busz-azonosító → mérték 0–1 (a fader UTÁN) */
  audioSends?: Partial<Record<TrackType, Record<string, number>>>;
  /** 🎥 Live-produkció dokumentum (`kind: 'live'` esetén; additív/opcionális —
   *  a régi projektek `live` nélkül érvényesek). Lásd `@/types/live` + LIVE.md. */
  live?: LiveDoc;
  /** 🧊 3D-modell dokumentum (`kind: 'model3d'` esetén; additív/opcionális). Lásd `@/types/model3d`. */
  model3d?: Model3DDoc;
  /**
   * 📁 A projekt saját mappája az Eszközömben (`Files/Projektek/<folder>`) — a
   * projekt nevéből képzett ékezetmentes név, a létrehozáskor rögzül (átnevezéskor
   * NEM változik). A projekt-média ide kerül; csak a projekttel együtt törlődik.
   */
  folder?: string;
  /** ☁️ a projekt-mappa egyirányú szinkronja a ReMix Storage-ba (projekt-beállítás) */
  syncToRemix?: boolean;
  /**
   * 🖼️ a felhasználó által választott BORÍTÓKÉP (hangnál: album-borító) — egy `kind:'image'`
   * asset id-ja a `assets`-ben. A projekt előnézeti képe ez (ha van), minden fajtánál.
   */
  coverAssetId?: string;
  createdAt: string;
  updatedAt: string;
  /** 1: assets nélkül · 2: asset-registry · 3: sáv-bővítés · 4: kulcskockák ·
   *  5: kanonikus sávok pótlása · 6: projekt-fajta (kind) — a betöltés migrál */
  schemaVersion: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  /** 🎛️ a projekt fajtája (a főképernyő ez alapján routol a helyes stúdióba) */
  kind?: ProjectKind;
  aspectRatio: AspectRatio;
  duration: number;
  clipCount: number;
  /** 📁 a projekt Eszközöm-mappája (a Tárhelyem védelméhez) */
  folder?: string;
  syncToRemix?: boolean;
  updatedAt: string;
}
