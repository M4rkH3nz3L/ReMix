import { currentUserId } from '@/lib/collab';
import { sweepAppMediaDirs } from '@/lib/mediaGcClient';
import { deleteProject, listProjects, markProjectsDeleted } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

/**
 * 🧨 Tiszta lap: az ÖSSZES projekt törlése — eszközön ÉS a saját felhő-soraimban.
 *
 * Mire való: a régi (média-GC előtti) korszak projektjeiben maradhattak bugos
 * hivatkozások és árva fájlok — ez az egy gomb mindet elviszi, hogy az új
 * életciklus (app-tárolt fájl, a projekttel törlődik, .rp a hordozás) tiszta
 * alapról induljon. Lépések:
 *   1. minden lokális projekt törlése a rendes úton (deleteProject → média-GC),
 *   2. a media/mediacache mappák TELJES kisöprése (a GC-előtti árvák is),
 *   3. a saját felhő-sorok törlése: cloud_projects, cloud_project_versions,
 *      project_members + project_invites (tulajként) — a tagság-kaszkád a
 *      megosztásokat is lezárja.
 * A felhő-rész best-effort (offline is lefut a lokális fele). Az R2-ben maradó
 * média-objektumok árvák maradnak (fillérek) — a tárhely-kvóta könyvelése a
 * következő feltöltéskor rendeződik; külön takarítás szerver-oldali feladat.
 */
export interface WipeResult {
  projects: number;
  files: number;
  cloudOk: boolean;
}

export async function wipeAllProjects(): Promise<WipeResult> {
  // 1-2. lokális: projektek a rendes törlés-úton, majd teljes mappa-söprés
  const metas = await listProjects();
  for (const m of metas) {
    try {
      await deleteProject(m.id);
    } catch {
      // egy projekt hibája nem állítja meg a többit
    }
  }
  const files = sweepAppMediaDirs();

  // 3. felhő: a SAJÁT soraim (RLS: csak a sajátom törölhető)
  let cloudOk = false;
  const uid = currentUserId();
  if (supabase && uid) {
    try {
      // a Supabase hibánál NEM dob, hanem `{ error }`-t ad → minden lépést ellenőrzünk
      // (korábban egy elbukott felhő-törlés „sikeresnek" látszott, és a projektek a
      // következő induláskor visszatöltődtek). A helyi sírkövek ettől függetlenül
      // megvédik a listát, és a szinkron a maradékot újra törli.
      // a CSAK felhőben lévő projektek is sírkövet kapnak (ha a törlés elbukna, se jöjjenek vissza)
      const { data: cloudRows } = await supabase
        .from('cloud_projects')
        .select('project_id')
        .eq('user_id', uid);
      await markProjectsDeleted(((cloudRows ?? []) as { project_id: string }[]).map((r) => r.project_id));
      const results = await Promise.all([
        supabase.from('cloud_project_versions').delete().eq('user_id', uid),
        supabase.from('project_invites').delete().eq('owner_id', uid),
        supabase.from('project_members').delete().eq('owner_id', uid),
      ]);
      const projects = await supabase.from('cloud_projects').delete().eq('user_id', uid);
      cloudOk = [...results, projects].every((r) => !r.error);
    } catch {
      cloudOk = false;
    }
  }
  return { projects: metas.length, files, cloudOk };
}
