/**
 * Asset: a projekt által hivatkozott médiafájl. A projekt nem birtokolja a
 * nyers fájlt — hivatkozik rá; később provider-alapú (Drive/S3/…) elérés és
 * hash-alapú relink épül rá (full-plan F2).
 */
/**
 * 🔗 Linked asset forrása (ReMix.md 5.3 · SC2 · AUDIO-PROD C2): ez a fájl egy MÁSIK projekt
 * kimenete (ma: a hang-projekt mixdownja), verzióval. A hivatkozó projekt megnyitáskor a forrás
 * mostani verziójával veti össze → „Frissítés elérhető”; a csere a `RELINK_ASSET` parancs.
 */
export interface AssetSource {
  projectId: string;
  /** a forrás neve a felületnek (a projekt címe a hivatkozáskor) */
  name?: string;
  /** a projekten belüli dokumentum (SC1); hiányzó = a projekt egésze */
  docId?: string;
  /** `mixdown`: a hang-projekt keverése · `still`: egy kép-dokumentum (`docId`) képe (CORE K2) */
  output: 'mixdown' | 'still';
  /** a forrás kimenet-verziója, amiből ez a fájl készült (`mixdownVersion` / `stillVersion`) */
  version: string;
}

/** 🔤 egy importált betűtípus: a `family` a szöveg-rétegek `fontFamily`-je, a fájl TTF/OTF */
export interface ProjectFont {
  family: string;
  /** a felületen látszó név (a fájlnévből) */
  name: string;
  uri: string;
}

export interface Asset {
  id: string;
  /** `model`: 3D-háló / textúra / pontfelhő (USDZ, OBJ, PLY, STL, GLB) — 3D-Studio.md §15.8 */
  kind: 'video' | 'image' | 'audio' | 'model';
  /** 🔗 hivatkozás egy másik projekt kimenetére (hiányzó = saját/importált fájl) */
  source?: AssetSource;
  /** aktuális elérés (helyi másolat vagy stream-URL) */
  uri: string;
  provider: 'local' | 'library' | 'remote';
  name?: string;
  /** mp — videó/hang esetén */
  duration?: number;
  width?: number;
  height?: number;
  /** relinkhez (F2) */
  hash?: string;
  /** 🎚️ hang-formátum a fájl fejlécéből (S16; importkor kiolvasva — hiányzó = ismeretlen) */
  sampleRate?: number;
  channels?: number;
  /** csak veszteségmentesnél (PCM / FLAC) */
  bitDepth?: number;
  size?: number;
  /** `lut`: kép-réteg .cube fájlja — menteni kell, de beszúrható képként nem listázzuk */
  role?: 'lut';
  /**
   * 🗄️ a médiafájl szerveren tárolt másolatának publikus URL-je. A média-backup
   * (lib/mediaSync) tölti fel egyszer, és a felhő-projekt-másolat (cloud_projects)
   * hordozza. Ha a helyi fájl elveszik (konténer-váltás/újratelepítés), a betöltés
   * innen tölti vissza és relinkel — így nem marad tartósan „hiányzó fájl".
   */
  remoteUrl?: string;
  // ── 📂 Organize (Pro Workflow): asset-rendszerezés metaadatai ──────────────
  /** kedvenc jelölés (gyors szűréshez) */
  favorite?: boolean;
  /** 0–5 csillag értékelés (0/hiányzó = nincs) */
  rating?: number;
  /** címkék / „bin"-ek (pl. „A-roll", „hook", „keep") */
  tags?: string[];
}
