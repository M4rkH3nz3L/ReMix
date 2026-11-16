import { create } from 'zustand';

import { missingSeoFields } from '@/lib/createProjectForm';
import type { Project } from '@/types/project';

/**
 * 📣 SEO-kapu a megosztás előtt (IMAGE-PROD S22): a projekt létrehozásakor a SEO elhagyható, a
 * feedbe/közzétételkor viszont kell. `ensureSeo(project)` azonnal továbbenged, ha a SEO teljes;
 * különben a gyökérben ülő `SeoGateHost` lap bekéri a hiányzó mezőket, és a kitöltött projekttel
 * (vagy megszakításkor `null`-lal) tér vissza.
 */
interface SeoGateState {
  /** `seq`: a kérés sorszáma — a lap ezzel indul újra friss kezdőértékekkel */
  request: { project: Project; resolve: (p: Project | null) => void; seq: number } | null;
  ensureSeo: (project: Project) => Promise<Project | null>;
  finish: (p: Project | null) => void;
}

export function seoComplete(project: Project): boolean {
  const s = project.seo;
  return missingSeoFields({ description: s?.description ?? '', hashtags: (s?.hashtags ?? []).join(' '), keywords: (s?.keywords ?? []).join(', ') }).length === 0;
}

let seq = 0;

export const useSeoGate = create<SeoGateState>((set, get) => ({
  request: null,
  ensureSeo: (project) => {
    if (seoComplete(project)) return Promise.resolve(project);
    // egy korábbi, nyitva hagyott kérés megszakítva zárul
    get().request?.resolve(null);
    seq += 1;
    const n = seq;
    return new Promise((resolve) => set({ request: { project, resolve, seq: n } }));
  },
  finish: (p) => {
    const r = get().request;
    set({ request: null });
    r?.resolve(p);
  },
}));
