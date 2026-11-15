import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * 🎨 DESIGN belépési pont (PRO-DESIGN-STUDIO K2 · DS0 · IMAGE-PROD S8): külön Design Stúdió nincs és
 * nem is kell — a `design` fajtájú projekt UGYANAZT a Kép Stúdiót nyitja, a Design munkaterületre
 * állítva (sablon, méret, tipográfia, márka elöl). A dokumentum-modell azonos (`ImageDoc`).
 */
export default function DesignStudioRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/studio/image/${id}?ws=design`} />;
}
