/** 🧪 Füstteszt — életciklus: worker-elérés, autosave, kilövés-próba, projekt-vizsgálat, fagyásfigyelő. (Áthelyezve: phases15; viselkedés-változás nélkül.) */
import { File } from 'expo-file-system';
import type { ReactNode } from 'react';
import { deleteCloudProject } from '@/lib/cloudSync';
import { useProjectAutosave, flushProjectSave } from '@/hooks/useProjectAutosave';
import { addLayer } from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { exportSize } from '@/lib/imageExport';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { deleteProject, clearRecovery, saveProject, loadProject, writeRecovery, readRecovery, recoveryIsFresher, listProjects, loadVersions } from '@/lib/storage';
import { findMissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeLayer, ImageLayer, PhotoLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { testDoc, tempProject } from '../../fixtures/projects';
import { decode, pixel, removeFile } from '../../helpers/image';
import '@/lib/dspNativeClient';

export async function smokeWorker(log: Log) {
  const doc = testDoc();
  const height = exportSize(doc, 2).height;
  const uri = await renderImageDoc(doc, height);
  if (!uri) {
    log(false, 'I9 worker-render a telefonról', 'null');
    return;
  }
  const img = await decode(uri);
  log(img.width() === 2160 && img.height() === 2160, 'I9 2× export a telefonról', `${img.width()}×${img.height()}`);
  log(pixel(img, 5, 5)[3] === 0, 'átlátszó háttér a telefonról kért exportban', `sarok α=${pixel(img, 5, 5)[3]}`);
  removeFile(uri);
}
function AutosaveProbe({ id }: { id: string }) {
  useProjectAutosave(id, true);
  return null;
}
function addTextEdit() {
  const s = useEditorStore.getState();
  const doc = s.project!.imageDocs![0];
  const marker = { kind: 'shape', id: `marker_${Date.now()}`, shape: 'ellipse', position: { x: 0.2, y: 0.2 }, w: 0.1, h: 0.1, fill: '#00ff00' } as ShapeLayer;
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(doc, marker as ImageLayer), label: 'smoke' });
  return marker.id;
}
async function cleanupProject(id: string) {
  useEditorStore.getState().closeProject();
  await deleteProject(id).catch(() => {});
  await deleteCloudProject(id).catch(() => false);
  await clearRecovery(id).catch(() => {});
}
export async function smokeAutosave(log: Log, setHarness: (n: ReactNode) => void) {
  const p = tempProject();
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={p.id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  const onDisk = await loadProject(p.id);
  const saved = !!onDisk?.imageDocs?.[0].layers.some((l) => l.id === marker);
  log(saved, 'I1 autosave lemezre ír kilépés nélkül', saved ? 'a réteg a lemezen' : 'nincs a lemezen');
  log(!useEditorStore.getState().dirty, 'I1 mentés után nem piszkos');

  const second = addTextEdit();
  const flushed = await flushProjectSave();
  const afterFlush = await loadProject(p.id);
  log(flushed && !!afterFlush?.imageDocs?.[0].layers.some((l) => l.id === second), 'I1 azonnali mentés (háttérbe lépés útja)');

  const state = useEditorStore.getState();
  writeRecovery(state.project!, state.events);
  await sleep(300);
  const rec = await readRecovery(p.id);
  log(!!rec && recoveryIsFresher(rec.at, new Date(Date.now() - 60000).toISOString()), 'I1 recovery-pillanatkép visszaolvasható');

  // I3: hiányzó rétegfájl felismerése valódi fájlrendszeren
  const photo = { kind: 'photo', id: 'gone', uri: `${projectMediaDir().uri}/nincs_ilyen.png`, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' } as PhotoLayer;
  const s = useEditorStore.getState();
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(s.project!.imageDocs![0], photo as ImageLayer), label: 'smoke' });
  const after = useEditorStore.getState().project!;
  log(after.assets.some((a) => a.uri === photo.uri), 'I2 a rétegfájl assetként regisztrálva');
  log(findMissingMedia(after).some((m) => m.uri === photo.uri), 'I3 a hiányzó rétegfájl felismerve');

  setHarness(null);
  await sleep(100);
  await cleanupProject(p.id);
  log((await loadProject(p.id)) == null, 'takarítás: az ideiglenes projekt törölve');
}
/** 1. fázis: szerkesztés + autosave, utána a Mac leállítja az appot */
export async function killPhase1(log: Log, setHarness: (n: ReactNode) => void, id: string) {
  const p = tempProject(id);
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  log(null, 'KILL-READY', marker);
}
/** 2. fázis: az app leállítása után a szerkesztés megvan-e a lemezen */
export async function killPhase2(log: Log, id: string) {
  const onDisk = await loadProject(id);
  const count = onDisk?.imageDocs?.[0].layers.filter((l) => l.id.startsWith('marker_')).length ?? 0;
  log(count === 1, 'I1 app-kill után a szerkesztés megmaradt', `${count} jelölő réteg`);
  await cleanupProject(id);
}
/** Csak olvas: a kép-projektek rétegei + a verzió-előzmény, hibakereséshez. */
export async function inspectProjects(log: Log) {
  const all = (await listProjects()).filter((p) => p.kind === 'image');
  for (const meta of all) {
    const p = await loadProject(meta.id);
    log(null, `PROJ ${meta.name} ${meta.id}`, `upd=${p?.updatedAt} docs=${p?.imageDocs?.length} assets=${p?.assets.length}`);
    for (const d of p?.imageDocs ?? []) {
      for (const l of d.layers) {
        const uri = (l as PhotoLayer).uri;
        const exists = uri ? (() => { try { return new File(uri).exists; } catch { return false; } })() : null;
        const pos = (l as PhotoLayer).position;
        log(null, `  ${l.kind} ${l.id}`, `w=${(l as PhotoLayer).w} h=${(l as PhotoLayer).h} pos=${pos?.x},${pos?.y} hidden=${!!l.hidden} file=${uri?.split('/').pop()} exists=${exists}`);
      }
    }
    const versions = await loadVersions(meta.id).catch(() => []);
    const summary = versions.slice(0, 6).map((v) => `${v.at.slice(11, 19)}:${v.project.imageDocs?.[0]?.layers.map((l) => (l as PhotoLayer).uri?.split('/').pop() ?? l.kind).join('+')}`);
    log(null, `  verziók: ${versions.length}`, summary.join(' | '));
  }
}
/** A JS-szál mérése 20 mp-ig: 250 ms-os ketyegés, a késés a fagyást mutatja. Túléli a navigációt. */
export function startFreezeWatch(log: Log) {
  let last = Date.now();
  let worst = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last - 250);
    last = now;
    ticks += 1;
    if (ticks === 80) {
      clearInterval(timer);
      const s = useEditorStore.getState();
      log(worst < 500, 'JS-szál a valódi stúdióban (20 mp)', `legnagyobb akadás ${worst} ms, dirty=${s.dirty}, past=${s.past.length}`);
      console.log('[IMG-SMOKE] WATCH-DONE');
    }
  }, 250);
}
