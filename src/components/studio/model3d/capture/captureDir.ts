import { Directory, Paths } from 'expo-file-system';

/** a fotogrammetria IDEIGLENES képkészlete (cache) — projektenként */
export const captureDirFor = (projectId: string) => new Directory(Paths.cache, `m3dcap_${projectId}`);
