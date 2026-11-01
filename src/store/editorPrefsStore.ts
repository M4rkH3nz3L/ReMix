import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { WorkspaceMode } from '@/lib/imageWorkspaceLayout';
import type { EditMode } from '@/lib/toolbarSpec';
import { logCaught } from '@/lib/logCaught';

/** a Kép Stúdió oldalsó paneljeinek nyitottsága eszköz-típusonként */
export type ImagePanels = Partial<Record<WorkspaceMode, { rail?: boolean; layers?: boolean }>>;

/**
 * 🎛️ A videószerkesztő ESZKÖZ-szintű kezelési beállításai (nem a projekt része, nem
 * kerül az undo-ba): a szerkesztési mód (Gyors / Haladó / AI — PRO-VIDEO-EDITOR D5) és
 * az idővonal kiegészítő sorainak (sztori/tempó-sáv, térkép) nyitottsága (D6).
 */
const STORAGE_KEY = 'remix.editorPrefs.v1';

interface EditorPrefs {
  editMode: EditMode;
  /** a sztori/tempó-sáv + térkép látszik-e (összecsukva több hely jut a sávoknak) */
  timelineExtras: boolean;
  imagePanels: ImagePanels;
  /** a Live Stúdió paneljeinek sorrendje */
  livePanels: string[];
}

interface EditorPrefsState extends EditorPrefs {
  setEditMode: (mode: EditMode) => void;
  setTimelineExtras: (open: boolean) => void;
  setImagePanel: (mode: WorkspaceMode, patch: { rail?: boolean; layers?: boolean }) => void;
  setLivePanels: (order: string[]) => void;
}

const pick = ({ editMode, timelineExtras, imagePanels, livePanels }: EditorPrefs): EditorPrefs => ({ editMode, timelineExtras, imagePanels, livePanels });

function persist(p: EditorPrefs): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(p)).catch((caught) => {
    logCaught('store/editorPrefsStore.ts:persist', caught);
    // best-effort: a kezelési beállítás elvesztése nem kritikus
  });
}

export const useEditorPrefs = create<EditorPrefsState>((set, get) => ({
  editMode: 'advanced',
  timelineExtras: true,
  imagePanels: {},
  livePanels: [],
  setEditMode: (editMode) => {
    set({ editMode });
    persist({ ...pick(get()), editMode });
  },
  setTimelineExtras: (timelineExtras) => {
    set({ timelineExtras });
    persist({ ...pick(get()), timelineExtras });
  },
  setImagePanel: (mode, patch) => {
    const imagePanels = { ...get().imagePanels, [mode]: { ...get().imagePanels[mode], ...patch } };
    set({ imagePanels });
    persist({ ...pick(get()), imagePanels });
  },
  setLivePanels: (livePanels) => {
    set({ livePanels });
    persist({ ...pick(get()), livePanels });
  },
}));

// induláskor egyszer betöltjük (a hiányzó / sérült érték az alapra esik vissza)
AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<EditorPrefs>;
    useEditorPrefs.setState({
      ...(p.editMode === 'quick' || p.editMode === 'advanced' || p.editMode === 'ai' ? { editMode: p.editMode } : {}),
      ...(typeof p.timelineExtras === 'boolean' ? { timelineExtras: p.timelineExtras } : {}),
      ...(p.imagePanels && typeof p.imagePanels === 'object' ? { imagePanels: p.imagePanels } : {}),
      ...(Array.isArray(p.livePanels) ? { livePanels: p.livePanels.filter((v) => typeof v === 'string') } : {}),
    });
  })
  .catch((caught) => { logCaught('store/editorPrefsStore.ts', caught); });
