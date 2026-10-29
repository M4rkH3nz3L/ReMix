/**
 * 👥 Undo/redo szinkron élő collabhoz (PRO-VIDEO-EDITOR B7) — pure.
 *
 * A visszavonás/újra nem parancs, hanem állapot-ugrás — a társ-szerkesztők eddig nem
 * kapták meg, a kliensek szétváltak. Itt a két állapot KÜLÖNBSÉGE célzott, idempotens
 * parancsokká alakul (sáv-csere, asset-törlés, jelölők, …); ha marad olyan eltérés,
 * amire nincs célzott parancs, egyetlen `RESTORE_SNAPSHOT` viszi át a teljes állapotot.
 */
import type { EditorCommand } from '@/lib/commands';
import type { Project } from '@/types/project';

/** a célzott parancsokkal lefedett (és a helyi) mezők — a maradékot a pillanatkép viszi */
const COVERED = new Set<string>([
  'tracks',
  'assets',
  'markers',
  'chapters',
  'regions',
  'links',
  'aspectRatio',
  'fps',
  'name',
  // helyi / mentési metaadat — nem szinkronizálandó eltérés
  'updatedAt',
  'folder',
  'syncToRemix',
  'rendered',
]);

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function undoSyncCommands(from: Project, to: Project, label?: string): EditorCommand[] {
  if (from === to) {
    return [];
  }
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const k of keys) {
    if (!COVERED.has(k) && !same((from as unknown as Record<string, unknown>)[k], (to as unknown as Record<string, unknown>)[k])) {
      return [{ type: 'RESTORE_SNAPSHOT', project: to, ...(label ? { label } : {}) }];
    }
  }
  const out: EditorCommand[] = [];
  // sáv-szintű (nem klip-) eltérés — sáv eltűnt/megjelent vagy sáv-tulajdonság (pl. gain)
  // változott → arra nincs célzott parancs, a teljes pillanatkép viszi át
  const trackShapeChanged =
    from.tracks.length !== to.tracks.length ||
    to.tracks.some((t) => {
      const prev = from.tracks.find((p) => p.type === t.type);
      return !prev || !same({ ...prev, clips: null }, { ...t, clips: null });
    });
  if (trackShapeChanged) {
    return [{ type: 'RESTORE_SNAPSHOT', project: to, ...(label ? { label } : {}) }];
  }
  const changedTracks = to.tracks.filter((t) => {
    const prev = from.tracks.find((p) => p.type === t.type);
    return !prev || (prev.clips !== t.clips && !same(prev.clips, t.clips));
  });
  const fromAssetIds = new Set(from.assets.map((a) => a.id));
  const addedAssets = to.assets.filter((a) => !fromAssetIds.has(a.id));
  if (changedTracks.length > 0 || addedAssets.length > 0) {
    out.push({
      type: 'REPLACE_TRACKS',
      tracks: changedTracks.map((t) => ({ trackType: t.type, clips: t.clips })),
      ...(addedAssets.length ? { assets: addedAssets } : {}),
      ...(label ? { label } : {}),
    });
  }
  // a REPLACE_TRACKS üres sáv-listával nem fut le → asset-hozzáadás egyedül: ADD_ASSET
  if (changedTracks.length === 0 && addedAssets.length > 0) {
    out.pop();
    for (const asset of addedAssets) out.push({ type: 'ADD_ASSET', asset });
  }
  const toAssetIds = new Set(to.assets.map((a) => a.id));
  for (const a of from.assets) {
    if (!toAssetIds.has(a.id)) out.push({ type: 'REMOVE_ASSET', assetId: a.id });
  }
  for (const a of to.assets) {
    const prev = from.assets.find((p) => p.id === a.id);
    if (prev && !same(prev, a)) out.push({ type: 'UPDATE_ASSET', assetId: a.id, patch: a });
  }
  if (!same(from.markers, to.markers)) out.push({ type: 'SET_MARKERS', markers: to.markers ?? [] });
  if (!same(from.chapters, to.chapters)) out.push({ type: 'SET_CHAPTERS', chapters: to.chapters ?? [] });
  if (!same(from.regions, to.regions)) out.push({ type: 'SET_REGIONS', regions: to.regions ?? [] });
  if (!same(from.links, to.links)) out.push({ type: 'SET_LINKS', links: to.links ?? [] });
  if (from.aspectRatio !== to.aspectRatio) out.push({ type: 'SET_ASPECT', aspectRatio: to.aspectRatio });
  if ((from.fps ?? 30) !== (to.fps ?? 30)) out.push({ type: 'SET_FPS', fps: to.fps ?? 30 });
  if (from.name !== to.name) out.push({ type: 'RENAME_PROJECT', name: to.name });
  return out;
}
