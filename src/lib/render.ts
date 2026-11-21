import { renderServerUrl } from '@/lib/backend';

/**
 * Render-kliens. Két út:
 *   • ESZKÖZÖN (ingyen): a natív renderelő a telefonon készíti az MP4-et,
 *     szerver nélkül (lásd `@/lib/nativeRender`). Ez az alapértelmezett.
 *   • FELHŐ (Pro): a projekt + médiafájlok feltöltése a felhő-workernek,
 *     státusz-poll, majd a kész MP4 letöltése — nagyobb felbontás/gyorsaság.
 * A `renderServerUrl` a `@/lib/backend`-ből jön (a dev-worker feloldása); itt
 * csak re-exportáljuk, hogy a régi importőrök (~28 modul) változatlanul menjenek.
 */

export { renderServerUrl };

// A modulcsalád: expo-mentes mag a `renderPipeline/`, a hálózati/natív oldal a `renderPipelineClient/` alatt.
export { PLATFORM_PRESETS, settingsNeedCloud } from './renderPipeline/settings';
export type { ExportPlatform, RenderCodec, RenderMode, RenderOptions, RenderSettings } from './renderPipeline/settings';
export { isRenderCancelledError, RenderCancelledError } from './renderPipeline/cancel';
export { renderMp4, renderProjectVersion } from './renderPipelineClient/orchestrate';
export { uploadMedia, uploadMediaResult } from './renderPipelineClient/upload';
export type { MediaKind, UploadTarget } from './renderPipelineClient/upload';
export {
  exportAudioFile,
  exportAudioToFile,
  renderAndDownloadWeb,
  renderAndUploadWeb,
  renderCloudFileUrl,
} from './renderPipelineClient/cloudExport';
export { downloadTrack, fetchSoundLibrary } from './renderPipelineClient/soundLibrary';
export type { LibraryTrack } from './renderPipelineClient/soundLibrary';
export { transcribeToSrt } from './renderPipelineClient/captions';
export { collectAndShareProject } from './renderPipelineClient/collect';
export { renderAndPost, renderAndShareMp4 } from './renderPipelineClient/share';
export type { PostTarget } from './renderPipelineClient/share';
