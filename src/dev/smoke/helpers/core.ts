/** 🧪 Füstteszt — a napló-típus és a várakozás — minden csomag közös alapja. (Áthelyezve: shared; viselkedés-változás nélkül.) */
export type Log = (ok: boolean | null, name: string, detail?: string) => void;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
