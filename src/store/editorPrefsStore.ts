import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { EditMode } from '@/lib/toolbarSpec';

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
}

interface EditorPrefsState extends EditorPrefs {
  setEditMode: (mode: EditMode) => void;
  setTimelineExtras: (open: boolean) => void;
}

function persist(p: EditorPrefs): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(p)).catch(() => {
    // best-effort: a kezelési beállítás elvesztése nem kritikus
  });
}

export const useEditorPrefs = create<EditorPrefsState>((set, get) => ({
  editMode: 'advanced',
  timelineExtras: true,
  setEditMode: (editMode) => {
    set({ editMode });
    persist({ editMode, timelineExtras: get().timelineExtras });
  },
  setTimelineExtras: (timelineExtras) => {
    set({ timelineExtras });
    persist({ editMode: get().editMode, timelineExtras });
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
    });
  })
  .catch(() => {});
