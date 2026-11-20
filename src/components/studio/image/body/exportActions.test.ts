import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { commitRendered, markExported } from '@/components/studio/image/body/exportCommon';
import { createExportRasterizer } from '@/components/studio/image/body/exportRasterizer';
import { createFileExportActions } from '@/components/studio/image/body/fileExportActions';
import { createPublishActions } from '@/components/studio/image/body/publishActions';
import { createRasterExportActions } from '@/components/studio/image/body/rasterExportActions';
import { renderImageDoc, renderSvgPdf } from '@/lib/imageDocClient';
import { ImageRenderRejected } from '@/lib/imageExport';
import { chooseImageRenderRoute } from '@/lib/imageRenderRoute';
import { logCaught } from '@/lib/logCaught';
import { saveImageToPhotos } from '@/lib/media';
import { listProjects } from '@/lib/storage';
import type { ImageDoc, Project } from '@/types/project';

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('expo-file-system', () => {
  const written: { uri: string; content: unknown }[] = [];
  class Directory {
    uri: string;
    exists = false;
    constructor(base: { uri: string }, name: string) {
      this.uri = `${base.uri}/${name}`;
    }
    create() {}
  }
  class File {
    uri: string;
    exists = false;
    constructor(a: { uri: string } | string, name?: string) {
      this.uri = typeof a === 'string' ? a : `${a.uri}/${name}`;
    }
    delete() {}
    write(content: unknown) {
      written.push({ uri: this.uri, content });
    }
    async bytes() {
      return new Uint8Array([0xff, 0xd8]);
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache' } }, __written: written };
});
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///cap.png') }));
jest.mock('@/lib/imageDocClient', () => {
  class ExportCancelled extends Error {}
  return { ExportCancelled, renderImageDoc: jest.fn(), renderSvgPdf: jest.fn(), exportPsd: jest.fn() };
});
jest.mock('@/lib/imageRenderRoute', () => ({ chooseImageRenderRoute: jest.fn(() => 'device') }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
jest.mock('@/lib/media', () => ({ saveImageToPhotos: jest.fn(async () => 'saved') }));
jest.mock('@/lib/rasterPdf', () => ({ jpegToPdf: jest.fn(() => new Uint8Array([1])) }));
jest.mock('@/lib/cswcrClient', () => ({ logCswcr: jest.fn(), studioKindOf: (k: unknown) => k }));
jest.mock('@/lib/storage', () => ({ listProjects: jest.fn(async () => []), loadProject: jest.fn() }));
jest.mock('@/lib/svgExport', () => ({ imageDocToSvg: () => '<svg/>', svgDocSize: () => ({ width: 10, height: 20 }) }));
jest.mock('@/components/studio/image/exportVerify', () => ({ verifyExport: jest.fn(async () => []) }));
jest.mock('@/hooks/useProjectAutosave', () => ({ flushProjectSave: jest.fn(async () => {}) }));
const mockMenuOpen = jest.fn();
jest.mock('@/store/actionMenuStore', () => ({ useActionMenu: { getState: () => ({ open: mockMenuOpen }) } }));
const mockDispatch = jest.fn();
let mockStoreProject: unknown = null;
jest.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => ({ project: mockStoreProject, dispatch: mockDispatch }) } }));

/**
 * 🖨️ Az export-akciók gyárai (REFACTOR: a `useImageExport`-ból kiemelve) — útvonal-választás,
 * hibakezelés a régi logCaught-ujjlenyomatokkal, fájlnevek / MIME-ok, store-írás: a jelenlegi viselkedés.
 */

const t = ((k: string) => k) as unknown as TFunction;
const doc = { id: 'd1', name: 'Kép 1', aspectRatio: '1:1', width: 1000, height: 1000, layers: [] } as unknown as ImageDoc;
const project = { id: 'p1', name: 'P', kind: 'image', imageDocs: [doc] } as unknown as Project;

function rasterizer(device: string | null = 'file:///dev.png') {
  const rejectedRef = { current: false };
  const render = jest.fn(async () => device);
  const setCapturing = jest.fn();
  const r = createExportRasterizer({ t, rejectedRef, renderStageRef: { current: { render } as never }, canvasRef: { current: null }, setCapturing });
  return { r, render, rejectedRef, setCapturing };
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockStoreProject = { ...project };
  (chooseImageRenderRoute as jest.Mock).mockReturnValue('device');
});
afterEach(() => alertSpy.mockRestore());

describe('createExportRasterizer', () => {
  it('telefonos út: a RenderStage a kért (vagy a lap) magasságán renderel, worker nélkül', async () => {
    const { r, render } = rasterizer();
    expect(await r.rasterize(doc, { format: 'jpg', quality: 0.5 })).toBe('file:///dev.png');
    expect(render).toHaveBeenCalledWith(doc, 1000, { format: 'jpg', quality: 0.5 });
    expect(renderImageDoc).not.toHaveBeenCalled();
  });
  it('telefonos hiba → a worker a tartalék', async () => {
    (renderImageDoc as jest.Mock).mockResolvedValueOnce('file:///w.png');
    const { r } = rasterizer(null);
    expect(await r.rasterize(doc, { height: 500 })).toBe('file:///w.png');
    expect((renderImageDoc as jest.Mock).mock.calls[0][1]).toBe(500);
  });
  it('worker-út: a szerver szándékos elutasítása után nincs telefonos tartalék, és az általános hibaablak sem jön', async () => {
    (chooseImageRenderRoute as jest.Mock).mockReturnValue('worker');
    (renderImageDoc as jest.Mock).mockRejectedValueOnce(new ImageRenderRejected('túl nagy'));
    const { r, render, rejectedRef } = rasterizer();
    expect(await r.rasterize(doc)).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(rejectedRef.current).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith('studio.image.renderFailTitle', 'túl nagy');
    r.alertRenderFail();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
  it('worker-út, de a worker nem érhető el → a telefon renderel, és jelzi a hiányzó effekteket', async () => {
    (chooseImageRenderRoute as jest.Mock).mockReturnValue('worker');
    (renderImageDoc as jest.Mock).mockResolvedValueOnce(null);
    const { r } = rasterizer();
    expect(await r.rasterize(doc)).toBe('file:///dev.png');
    expect(alertSpy).toHaveBeenCalledWith('studio.image.deviceRenderGaps.title', 'studio.image.deviceRenderGaps.body');
  });
  it('captureCanvas: a hibát a régi ujjlenyomattal naplózza, null-t ad, és visszakapcsolja a króm-rejtést', async () => {
    const { captureRef } = jest.requireMock('react-native-view-shot');
    captureRef.mockRejectedValueOnce(new Error('x'));
    const { r, setCapturing } = rasterizer();
    expect(await r.captureCanvas(doc, 1000)).toBeNull();
    expect(logCaught).toHaveBeenCalledWith('components/studio/image/ImageStudioBody.tsx:rasterize', expect.any(Error));
    expect(setCapturing.mock.calls).toEqual([[true], [false]]);
  });
});

describe('exportCommon', () => {
  it('commitRendered: a store FRISS lapjára ír, „render” címkével; ismeretlen lapnál nem ír', () => {
    commitRendered('d1', 'file:///r.png');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'UPSERT_IMAGE_DOC', label: 'render', doc: expect.objectContaining({ id: 'd1', renderedUri: 'file:///r.png' }) }));
    commitRendered('nincs', 'file:///r.png');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
  it('markExported: projekt nélkül nem naplóz', () => {
    const { logCswcr } = jest.requireMock('@/lib/cswcrClient');
    markExported(null);
    expect(logCswcr).not.toHaveBeenCalled();
    markExported(project);
    expect(logCswcr).toHaveBeenCalledWith({ type: 'export', projectId: 'p1', kind: 'image' });
  });
});

describe('createRasterExportActions', () => {
  it('sikertelen render → az általános hibaablak, store-írás nélkül, és a busy / exporting visszaáll', async () => {
    const { r } = rasterizer(null);
    (renderImageDoc as jest.Mock).mockResolvedValueOnce(null);
    const setBusy = jest.fn();
    const setExporting = jest.fn();
    const exportAbort = { current: null as AbortController | null };
    const a = createRasterExportActions({ t, doc, project, busy: false, setBusy, setExporting, exportAbort, rasterize: r.rasterize, alertRenderFail: r.alertRenderFail });
    await a.exportImage({ target: 'photos' });
    expect(alertSpy).toHaveBeenCalledWith('studio.image.renderFailTitle', 'studio.image.renderFailBody');
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(saveImageToPhotos).not.toHaveBeenCalled();
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(setExporting.mock.calls).toEqual([[true], [false]]);
    expect(exportAbort.current).toBeNull();
  });
  it('foglalt állapotban semmit nem csinál', async () => {
    const setBusy = jest.fn();
    const { r } = rasterizer();
    const a = createRasterExportActions({ t, doc, project, busy: true, setBusy, setExporting: jest.fn(), exportAbort: { current: null }, rasterize: r.rasterize, alertRenderFail: r.alertRenderFail });
    await a.exportPack({ format: 'png', quality: 1 });
    await a.exportPart(doc);
    expect(setBusy).not.toHaveBeenCalled();
  });
});

describe('createFileExportActions', () => {
  it('SVG: a cache/export alá a tisztított néven, image/svg+xml MIME-mal oszt meg', async () => {
    const Sharing = jest.requireMock('expo-sharing');
    const { r } = rasterizer();
    const a = createFileExportActions({ t, doc, project, busy: false, setBusy: jest.fn(), rasterize: r.rasterize, alertRenderFail: r.alertRenderFail });
    await a.exportSvg();
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/export/K_p_1.svg', { mimeType: 'image/svg+xml', dialogTitle: 'studio.export' });
  });
  it('telefonos PDF: JPEG 0.92 minőséggel a raszter, a fájlnév ékezet-tartó', async () => {
    const Sharing = jest.requireMock('expo-sharing');
    const { r, render } = rasterizer('file:///p.jpg');
    const a = createFileExportActions({ t, doc, project, busy: false, setBusy: jest.fn(), rasterize: r.rasterize, alertRenderFail: r.alertRenderFail });
    await a.exportPdf();
    expect(render).toHaveBeenCalledWith(doc, 1000, { format: 'jpg', quality: 0.92 });
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/export/Kép_1.pdf', { mimeType: 'application/pdf', dialogTitle: 'studio.export' });
  });
  it('vektoros PDF sikertelen → az általános hibaablak (akkor is, ha előtte elutasítás volt)', async () => {
    (renderSvgPdf as jest.Mock).mockResolvedValueOnce(null);
    const { r } = rasterizer();
    const a = createFileExportActions({ t, doc, project, busy: false, setBusy: jest.fn(), rasterize: r.rasterize, alertRenderFail: r.alertRenderFail });
    await a.exportVectorPdf();
    expect(renderSvgPdf).toHaveBeenCalledWith('<svg/>', 10, 20);
    expect(alertSpy).toHaveBeenCalledWith('studio.image.renderFailTitle', 'studio.image.renderFailBody');
  });
});

describe('createPublishActions', () => {
  const deps = () => {
    const { r } = rasterizer();
    return { t, doc, project, pages: [doc], busy: false, setBusy: jest.fn(), rasterize: r.rasterize, alertRenderFail: r.alertRenderFail, onSave: jest.fn(async () => {}), onExit: jest.fn() };
  };
  it('videóba: két menüpont (új hivatkozott / meglévő)', () => {
    createPublishActions(deps()).insertIntoVideo();
    expect(mockMenuOpen).toHaveBeenCalledWith('studio.image.toVideo.title', [
      expect.objectContaining({ label: 'studio.image.toVideo.newLinked', icon: 'link-outline' }),
      expect.objectContaining({ label: 'studio.image.toVideo.existing', icon: 'film-outline' }),
    ]);
  });
  it('meglévő videó nélkül a „nincs videó” ablak jön', async () => {
    (listProjects as jest.Mock).mockResolvedValueOnce([{ id: 'p1', kind: 'video', name: 'self' }]);
    createPublishActions(deps()).insertIntoVideo();
    mockMenuOpen.mock.calls[0][1][1].onPress();
    await new Promise((r) => setTimeout(r, 0));
    expect(alertSpy).toHaveBeenCalledWith('studio.image.toVideo.title', 'studio.image.toVideo.noVideos');
  });
  it('scoped mentés: onSave nélkül / foglaltan kilép, különben a renderelt képpel ment', async () => {
    const d = deps();
    await createPublishActions({ ...d, onSave: undefined }).saveScoped();
    await createPublishActions({ ...d, busy: true }).saveScoped();
    expect(d.onExit).toHaveBeenCalledTimes(2);
    await createPublishActions(d).saveScoped();
    expect(d.onSave).toHaveBeenCalledWith(doc, 'file:///dev.png');
  });
});
