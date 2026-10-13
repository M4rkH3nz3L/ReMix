/**
 * 🤝 Collab-hozzáférés — tier-gate + szerep→jog mátrix (TECH-TOP §4), pure + tesztelt.
 *
 * Szabályok:
 *  - a user a SAJÁT tartalmánál mindig **owner = Admin** (minden jog), függetlenül az RBAC-tól;
 *  - **collab (projekt-együttműködés) = Amatőr+** (`basic`), a free-ben nincs;
 *  - **Céges cégkezelés** (szervezet + dolgozó-jogosultság) = `business`.
 *
 * A kliens-gate ebből nyit paywallt; a szerver-enforce ugyanezt a rangot használja
 * (a worker /invite min. Amatőr). A tier-rang a [tiers](./tiers) magból (contract-tesztelt).
 */
import { tierMeetsMin, type Tier } from './tiers';
import type { CollabRole } from './collab';

/** Meghívhat-e / részt vehet-e projekt-együttműködésben? (Amatőr+; free NEM.) */
export function canCollaborate(tier: Tier): boolean {
  return tierMeetsMin(tier, 'basic');
}

/** Létrehozhat-e céget + kezelheti-e a dolgozók jogosultságát? (Csak Céges.) */
export function canManageCompany(tier: Tier): boolean {
  return tierMeetsMin(tier, 'business');
}

export type CollabAction = 'view' | 'edit' | 'invite' | 'manage' | 'delete';

/**
 * Egy collab-szerep mit tehet a megosztott projekten. **owner = Admin → MINDEN** (a
 * tartalom tulajdonosa teljes jogú); editor = néz + szerkeszt; viewer = csak néz.
 */
export function collabCan(role: CollabRole, action: CollabAction): boolean {
  if (role === 'owner') {
    return true; // owner = Admin: minden jog (invite/manage/delete is)
  }
  if (role === 'editor') {
    return action === 'view' || action === 'edit';
  }
  return action === 'view'; // viewer
}
