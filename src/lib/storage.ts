// Barrel — a helyi projekt-tár (AsyncStorage). Expo-mentes mag: projectStoreCore/ (kulcsok,
// lista-bejegyzés, verzió/recovery-típusok + frissesség-döntés, méret-limitek); tárolás:
// projectStoreClient/ (index + újraépítés, sírkövek, projekt mentés/betöltés/törlés/duplikálás,
// verziók, eseménynapló, crash-recovery, uri-rebase).
export {
  type ProjectVersion,
  type RecoverySnapshot,
  recoveryIsFresher,
} from '@/lib/projectStoreCore/snapshots';
export {
  estimateProjectBytes,
  isProjectTooLarge,
  PROJECT_SIZE_WARN_BYTES,
} from '@/lib/projectStoreCore/limits';
export { listProjects } from '@/lib/projectStoreClient/projectIndex';
export { deletedProjectIds, markProjectsDeleted } from '@/lib/projectStoreClient/tombstones';
export {
  deleteProject,
  duplicateProject,
  loadProject,
  saveProject,
  saveProjectAndEvents,
} from '@/lib/projectStoreClient/projects';
export { loadVersions, recordAutoVersion, saveVersions } from '@/lib/projectStoreClient/versions';
export { loadEvents, saveEvents } from '@/lib/projectStoreClient/events';
export { clearRecovery, readRecovery, writeRecovery } from '@/lib/projectStoreClient/recovery';
