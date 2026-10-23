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
import {
  defaultProjectRoles,
  hasProjectPermission,
  type ProjectPermission,
  type ProjectRole,
} from './projectRoles';

/** Meghívhat-e / részt vehet-e projekt-együttműködésben? (Amatőr+; free NEM.) */
export function canCollaborate(tier: Tier): boolean {
  return tierMeetsMin(tier, 'basic');
}

/** Létrehozhat-e céget + kezelheti-e a dolgozók jogosultságát? (Csak Céges.) */
export function canManageCompany(tier: Tier): boolean {
  return tierMeetsMin(tier, 'business');
}

export type CollabAction = 'view' | 'edit' | 'invite' | 'manage' | 'delete';

/** a régi akció-nevek → projekt-jogosultság (a dinamikus role-mag nyelvén) */
const ACTION_PERMISSION: Record<CollabAction, ProjectPermission> = {
  view: 'view',
  edit: 'edit',
  invite: 'invite',
  manage: 'manageProject',
  delete: 'manageProject',
};

/**
 * Egy collab-szerep mit tehet a megosztott projekten. A jogok a TULAJ által
 * definiált role-okból jönnek (`projectRoles` — a chat-szoba is ezt örökli);
 * `roles` nélkül az alap-készlet (owner/editor/viewer) érvényes. **owner =
 * Admin → MINDEN** (a tartalom tulajdonosa teljes jogú).
 */
export function collabCan(
  role: CollabRole,
  action: CollabAction,
  roles: readonly ProjectRole[] = defaultProjectRoles()
): boolean {
  return hasProjectPermission(roles, role, ACTION_PERMISSION[action]);
}
