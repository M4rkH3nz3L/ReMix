/**
 * 🧱 Közös slice-creator típus a zustand slice-mintához.
 *
 * Minden slice ugyanazt a teljes `EditorState`-et látja a `set`/`get`-en át
 * (a slice-ok közti csatolás kizárólag `get().x()` hívásokon megy), így a
 * felosztás pusztán SZERVEZÉSI — a futásidejű viselkedés azonos a korábbi
 * egyetlen `create()` objektummal.
 */
import type { StateCreator } from 'zustand';

import type { EditorState } from '../editorState';

/** Egy slice: a teljes állapotot látja, de csak a `T` részt adja vissza. */
export type EditorSlice<T> = StateCreator<EditorState, [], [], T>;
