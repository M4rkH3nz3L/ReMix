import { useRef, useState } from 'react';

/**
 * ⋯ A projekt-menü lap állapota: nyitva-e, és a lezárulása UTÁN futó akció.
 * A szerkesztő-képernyőből kiemelve.
 */
export function useProjectMenu() {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  // a projekt-menü lezárulása UTÁN futó akció (lásd `menuAction`) — a korai return-ök ELÉ
  const pendingMenuAction = useRef<(() => void) | null>(null);

  // ⋯ projekt-menü lapként (nem Alert): telefonon ide költöznek a fejléc ritka
  // elemei is (képarány, közreműködők, bemutató) — az Android Alert max 3 gombot tud.
  const openProjectMenu = () => setProjectMenuOpen(true);
  // a menü-akció a lap TELJES lezárulása után fut (onDismissed): a bemutató/navigáció
  // új felületet nyit, ami iOS-en egy záródó Modal alatt elveszhetne
  const menuAction = (fn: () => void) => () => {
    pendingMenuAction.current = fn;
    setProjectMenuOpen(false);
  };
  const runPendingMenuAction = () => {
    const fn = pendingMenuAction.current;
    pendingMenuAction.current = null;
    fn?.();
  };

  return { projectMenuOpen, setProjectMenuOpen, openProjectMenu, menuAction, runPendingMenuAction };
}
