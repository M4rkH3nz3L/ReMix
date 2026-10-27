import { Redirect } from 'expo-router';

import { isEditableKind, isKindAvailable } from '@/lib/projectKinds';

/**
 * 🧊 3D Stúdió útvonal — ŐR (3D-Studio.md §1.1).
 *
 * LiDAR nélküli eszközön (és amíg a stúdió nincs kész — `editable: false`) a 3D
 * egyáltalán nem létezik az appban: a deep linkek / értesítések ide mutató
 * hivatkozása csendben a Stúdió-listára visz, hibaképernyő nélkül. A valódi
 * stúdió-képernyő a 3D-1 fázisban kerül ide (a feltétel teljesülésekor).
 */
export default function Model3DStudioRoute() {
  if (!isKindAvailable('model3d') || !isEditableKind('model3d')) {
    return <Redirect href="/studio" />;
  }
  // 3D-1: a stúdió-képernyő (szkennelés → rekonstrukció → néző/szerkesztő)
  return <Redirect href="/studio" />;
}
