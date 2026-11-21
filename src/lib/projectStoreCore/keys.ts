/** 🔑 Az AsyncStorage-kulcsok (a tárolt adat formátuma — NEM változhat). */

export const INDEX_KEY = 'vided.projects.v1';
export const projectKey = (id: string) => `vided.project.v1.${id}`;
export const eventsKey = (id: string) => `vided.events.v1.${id}`;
export const versionsKey = (id: string) => `vided.versions.v1.${id}`;
/** ⚡ az utolsó AUTO-verzió időbélyege külön, apró kulcson (olcsó throttle-döntés) */
export const lastAutoKey = (id: string) => `vided.versions.lastauto.v1.${id}`;
/** 🛟 crash-recovery pillanatkép külön kulcson (a félbeszakadt/bukott mentés ellen) */
export const recoveryKey = (id: string) => `vided.recovery.v1.${id}`;
/** 🪦 a törölt projektek id-i (sírkövek) — lásd `@/lib/projectTombstones` */
export const TOMBSTONE_KEY = 'vided.deletedProjects.v1';

/** a média-GC-ben hivatkozásnak számító kulcs-előtagok (projekt+verziók+recovery+napló) */
export const MEDIA_REF_PREFIXES = [
  projectKey(''),
  versionsKey(''),
  recoveryKey(''),
  eventsKey(''),
] as const;
