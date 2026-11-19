/**
 * A vided projekt-modell: Project → Track → Clip.
 * Minden idő másodpercben, minden pozíció/méret 0–1 közé normalizálva
 * (az előnézeti felület méretétől független).
 */

// A típusok tartományonként a ./project/ alatt élnek; ez a fájl csak újraexportál,
// így egyetlen import-hely sem változik.
export * from './project/common';
export * from './project/assets';
export * from './project/clipBase';
export * from './project/mediaClips';
export * from './project/graphicClips';
export * from './project/audioClips';
export * from './project/timeline';
export * from './project/image';
export * from './project/project';
