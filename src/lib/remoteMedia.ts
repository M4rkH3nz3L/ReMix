/**
 * 🌐 Távoli (http) média → a projekt mappájába (PRO-VIDEO B28) — pure mag.
 *
 * A remix-projekt a forrás-poszt RENDERELT videóját URL-ként hivatkozza. Az eszközön-
 * render a http-forrást kihagyja, a felhő-render pedig „hiányzó klipre” 400-at adott —
 * a remix-folyamat export-zsákutca volt. Export előtt ezért a távoli forrásokat
 * letöltjük, és a projektet RELINK_URI parancsokkal (undo-képesen) a helyi fájlra kötjük.
 */
import type { EditorCommand } from '@/lib/commands';
import type { Project } from '@/types/project';

const isRemote = (uri: string | undefined): uri is string => !!uri && /^https?:\/\//i.test(uri);

/** a projekt klipjei és assetjei által hivatkozott távoli (http/https) médiák — egyedien */
export function remoteMediaUris(project: Project): string[] {
  const out = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if ('uri' in clip && isRemote(clip.uri)) out.add(clip.uri);
    }
  }
  for (const a of project.assets) {
    // csak a klipek által ténylegesen használt asset számít (a többi nem kerül a renderbe)
    if (isRemote(a.uri) && project.tracks.some((t) => t.clips.some((c) => 'assetId' in c && c.assetId === a.id))) {
      out.add(a.uri);
    }
  }
  return [...out];
}

/** biztonságos, ütközésmentes helyi fájlnév a távoli URL-ből */
export function localNameFor(uri: string, index: number): string {
  const path = uri.split('?')[0].split('#')[0];
  const last = decodeURIComponent(path.split('/').pop() || '');
  const ext = /\.([a-z0-9]{2,5})$/i.exec(last)?.[1]?.toLowerCase() ?? 'mp4';
  const stem = last.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'remote';
  return `remote_${index}_${stem}.${ext}`;
}

/** a letöltött fájlokra kötő parancsok (régi uri → új uri) */
export function relinkCommands(map: Record<string, string>): EditorCommand[] {
  return Object.entries(map).map(([oldUri, newUri]) => ({ type: 'RELINK_URI', oldUri, newUri }));
}
