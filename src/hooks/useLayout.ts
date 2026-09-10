import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { layoutTokens, sizeClassFor, type LayoutTokens } from '@/constants/layout';

/**
 * 📐 A reszponzív elrendezés belépési pontja — minden komponens ezt használja
 * a saját `useWindowDimensions()` + kézzel írt küszöb helyett.
 *
 *   const L = useLayout();
 *   L.isExpanded          → iPad fekvő / desktop: dokkolt inspector + teljes idővonal
 *   L.spacing.md          → méret-osztályhoz igazított térköz
 *   L.font(11)            → méret-osztályhoz igazított betűméret
 *   L.editor.railWidth    → szerkesztő-specifikus méretek
 */
export interface Layout extends LayoutTokens {
  width: number;
  height: number;
  isLandscape: boolean;
  /** álló tablet: széles, de magasabb mint amilyen széles */
  isTabletPortrait: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const sizeClass = sizeClassFor(width, height);
    const isLandscape = width > height;
    return {
      ...layoutTokens(sizeClass),
      width,
      height,
      isLandscape,
      isTabletPortrait: sizeClass !== 'compact' && !isLandscape,
    };
  }, [width, height]);
}
