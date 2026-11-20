import { useRef, useState } from 'react';

import type { SheetKind } from '@/components/studio/image/body/ImageStudioSheets';
import { useLayout } from '@/hooks/useLayout';
import { initialSheetDetent } from '@/lib/imageStudioOps';
import { panelState, workspaceLayout } from '@/lib/imageWorkspaceLayout';
import type { Detent } from '@/lib/panelLayout';
import type { ImageSheetId } from '@/lib/panelSpecs';
import { useEditorPrefs } from '@/store/editorPrefsStore';

/**
 * 🧭 A stúdió paneljei: az inline lap (+ detent-memória) és a munkaterület oszlopai (sín, rétegpanel).
 * VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból — a hookok sorrendje azonos.
 */
export function useStudioPanels() {
  const [sheet, setSheetRaw] = useState<SheetKind>(null);
  // 📐 MOBILE-UI §6.6: az inline lap detentje + a felhasználó utolsó választása laponként
  const [sheetDetent, setSheetDetent] = useState<Detent>('peek');
  const detentMemory = useRef<Partial<Record<ImageSheetId, Detent>>>({});
  const [workH, setWorkH] = useState(0);
  // 🧭 bal: szerszámsín, közép: vászon + eszköz-beállítások, jobb: rétegek. A sín mindig a
  // sorban van; a rétegpanel telefonon a vászon fölé nyílik, tableten a sorba épül
  const L = useLayout();
  const workspace = workspaceLayout(L.sizeClass, L.width);
  const imagePanels = useEditorPrefs((s) => s.imagePanels);
  const panels = panelState(workspace.mode, imagePanels);
  // telefonon a nyitott rétegpanel mellett a sín behúzódik, hogy a vászon látsszon rendezés közben
  const railYieldsToPanel = workspace.mode === 'overlay' && panels.layers;
  const setRailOpen = (rail: boolean) => useEditorPrefs.getState().setImagePanel(workspace.mode, { rail });
  const setLayersOpen = (layers: boolean) => useEditorPrefs.getState().setImagePanel(workspace.mode, { layers });
  const setSheet = (next: SheetKind) => {
    if (next === 'layers') {
      setLayersOpen(true);
      setSheetRaw(null);
      return;
    }
    if (next) {
      setSheetDetent(initialSheetDetent(detentMemory.current, next));
    }
    setSheetRaw(next);
  };
  const onSheetDetent = (detent: Detent) => {
    setSheetDetent(detent);
    if (sheet) {
      detentMemory.current[sheet] = detent;
    }
  };
  return {
    sheet,
    setSheet,
    sheetDetent,
    onSheetDetent,
    workH,
    setWorkH,
    workspace,
    panels,
    railYieldsToPanel,
    setRailOpen,
    setLayersOpen,
  };
}
