import AsyncStorage from '@react-native-async-storage/async-storage';

import { chainProjectOf, flowStats, linkRatio, recordEvent, type CswcrEvent, type FlowStats, type LinkRatio, type StudioKind } from '@/lib/cswcr';
import { logCaught } from '@/lib/logCaught';
import { listProjects, loadProject } from '@/lib/storage';

/**
 * 📊 CSWCR — az ESZKÖZ rétege a pure `cswcr.ts` magjához (ReMix.md 7.3 · AUDIO-PROD C5).
 *
 * A napló HELYBEN él (AsyncStorage), és innen SEMMI nem megy ki: se projekt-tartalom, se cím, se
 * média. A hozzájárulásos, összesített számláló (F1) külön, későbbi lépés — ez a napló annak az
 * alapja. A hívások tűz-és-felejt jellegűek: a naplózás hibája sosem akasztja meg a munkát.
 */

const KEY = 'vided.cswcr.v1';

let queue: Promise<void> = Promise.resolve();

export async function readCswcrLog(): Promise<CswcrEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as CswcrEvent[]) : [];
  } catch (caught) {
    logCaught('lib/cswcrClient.ts:readCswcrLog', caught);
    return [];
  }
}

/** esemény a helyi naplóba (sorban, hogy két gyors hívás ne írja felül egymást) */
export function logCswcr(e: Omit<CswcrEvent, 'at'> & { at?: string }): void {
  const event: CswcrEvent = { ...e, at: e.at ?? new Date().toISOString() };
  queue = queue
    .then(async () => {
      const log = await readCswcrLog();
      await AsyncStorage.setItem(KEY, JSON.stringify(recordEvent(log, event)));
    })
    .catch((caught) => {
      logCaught('lib/cswcrClient.ts:logCswcr', caught);
    });
}

/** a függő naplóírások megvárása (mérés, teszt) */
export function flushCswcr(): Promise<void> {
  return queue;
}

export async function clearCswcrLog(): Promise<void> {
  await flushCswcr();
  await AsyncStorage.removeItem(KEY);
}

export interface CswcrStats {
  link: LinkRatio;
  flow: FlowStats;
  events: number;
}

/** a mérőszámok a helyi projektekből és naplóból — minden a telefonon */
export async function cswcrStats(): Promise<CswcrStats> {
  await flushCswcr();
  const [metas, log] = await Promise.all([listProjects(), readCswcrLog()]);
  const projects = [];
  for (const m of metas) {
    const p = await loadProject(m.id).catch((caught) => {
      logCaught('lib/cswcrClient.ts:cswcrStats', caught);
      return null;
    });
    if (p) projects.push(chainProjectOf(p));
  }
  return { link: linkRatio(log), flow: flowStats(projects, log), events: log.length };
}

/** a projekt fajtája a napló számára (a `music`/`design` munkaterületek a saját fajtájukkal) */
export function studioKindOf(kind: string | undefined): StudioKind {
  switch (kind) {
    case 'image':
    case 'audio':
    case 'model3d':
    case 'live':
    case 'music':
    case 'design':
    case 'motion':
      return kind;
    default:
      return 'video';
  }
}
