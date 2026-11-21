/**
 * 🛡️ Dupla koppintás az admin-panelen: a jog-kapcsoló, a bejelentés/fellebbezés lezárása, a
 * DAC7-export és a kifizetés-/cég-jóváhagyás két szinkron koppintásra (ugyanabban a renderben)
 * is csak EGY írást küldhet — a jog-kapcsolónál a helyes értékkel; a művelet végén (siker és
 * hiba után is) a következő koppintás újra működik.
 */
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { Alert, Text } from 'react-native';

import AdminScreen from '@/app/admin';
import { RolePermissionMatrix } from '@/components/admin/RolePermissionMatrix';
import { useRoles } from '@/store/roleStore';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockSetRolePermission = jest.fn();
const mockResolveReport = jest.fn();
const mockModeratePost = jest.fn();
const mockResolveAppeal = jest.fn();
const mockDac7 = jest.fn();
const mockReviewPayout = jest.fn();
const mockMarkInvoicePaid = jest.fn();

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: unknown }) => children }));
jest.mock('react-i18next', () => {
  // stabil `t` (a gyökér `load`-ja függ tőle — renderenként új függvény végtelen újratöltést adna)
  const t = (k: string) => k;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/components/admin/AdminHeader', () => ({ AdminHeader: () => null }));
jest.mock('@/lib/roles', () => ({
  fetchMyPermissions: async () => [],
  listRoles: async () => [{ slug: 'mod', label: 'Moderátor', builtin: true }],
  listPermissions: async () => [{ key: 'post.remove', label: 'Poszt törlése', description: null }],
  listRolePermissions: async () => [],
  listUsersWithRoles: async () => [],
  assignRole: jest.fn(),
  createRole: jest.fn(),
  deleteRole: jest.fn(),
  moderateCommentGlobal: jest.fn(),
  moderatePostGlobal: (...a: unknown[]) => mockModeratePost(...a),
  setRolePermission: (...a: unknown[]) => mockSetRolePermission(...a),
  setUserSuspended: jest.fn(),
}));
jest.mock('@/lib/reports', () => ({
  listOpenReports: async () => [
    { id: 'r1', targetType: 'post', postId: 'p1', commentId: null, messageId: null, messageBody: null, messageSender: null, reason: 'spam', note: null, status: 'open', createdAt: '2026-11-01T00:00:00Z' },
  ],
  resolveReport: (...a: unknown[]) => mockResolveReport(...a),
}));
jest.mock('@/lib/appeals', () => ({
  listOpenAppeals: async () => [{ id: 'a1', postId: 'p2', postTitle: 'Poszt', postDescription: null, note: null, createdAt: '2026-11-01T00:00:00Z' }],
  resolveAppeal: (...a: unknown[]) => mockResolveAppeal(...a),
}));
jest.mock('@/lib/wallet', () => ({
  downloadDac7: (...a: unknown[]) => mockDac7(...a),
  listPayoutsUnderReview: async () => [{ id: 'pay1', username: 'anna', cents: 2000, amountEurCents: 6000, riskFlags: [], createdAt: '2026-11-01T00:00:00Z' }],
  reviewPayout: (...a: unknown[]) => mockReviewPayout(...a),
}));
jest.mock('@/lib/org', () => ({
  listPendingOrgs: async () => [],
  listOpenInvoices: async () => [{ id: 'inv1', number: 'R-1', orgName: 'Cég', grossCents: 10000, dueAt: '2026-11-30' }],
  markInvoicePaid: (...a: unknown[]) => mockMarkInvoicePaid(...a),
  reviewOrg: jest.fn(),
}));

const ALL_PERMS = ['role.manage', 'report.review', 'payout.review', 'finance.manage'];

async function mount() {
  useRoles.setState({ permissions: ALL_PERMS });
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<AdminScreen />);
  });
  return view;
}

/** az a koppintható csomópont, amelynek a fájában a `label` szöveg (i18n-kulcs) szerepel */
function pressable(view: ReactTestRenderer, label: string): ReactTestInstance {
  const hit = view.root.findAll(
    (n) =>
      typeof n.props.onPress === 'function' &&
      n.findAllByType(Text).some((x) => [].concat(x.props.children).join('') === label)
  );
  // a legbelső találat (a Pressable maga), nem a szülők
  return hit[hit.length - 1];
}
const doubleTap = (node: ReactTestInstance) =>
  act(() => {
    const { onPress } = node.props;
    onPress();
    onPress(); // ugyanaz a render-kori closure
  });

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const m of [mockSetRolePermission, mockResolveReport, mockModeratePost, mockResolveAppeal, mockDac7, mockReviewPayout, mockMarkInvoicePaid]) {
    m.mockReset();
  }
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

describe('AdminScreen — dupla koppintás egyetlen írás', () => {
  it('jog-kapcsoló: két koppintás ugyanabban a renderben → EGY setRolePermission a helyes (bekapcsolt) értékkel', async () => {
    const view = await mount();
    const d = deferred<void>();
    mockSetRolePermission.mockReturnValue(d.promise);
    const { toggle } = view.root.findByType(RolePermissionMatrix).props;
    act(() => {
      toggle('mod', 'post.remove');
      toggle('mod', 'post.remove');
    });
    expect(mockSetRolePermission).toHaveBeenCalledTimes(1);
    expect(mockSetRolePermission).toHaveBeenCalledWith('mod', 'post.remove', true);
    await act(async () => d.resolve());
    // a következő koppintás az ÚJ állapotból kapcsol (ki)
    mockSetRolePermission.mockResolvedValue(undefined);
    await act(async () => view.root.findByType(RolePermissionMatrix).props.toggle('mod', 'post.remove'));
    expect(mockSetRolePermission).toHaveBeenLastCalledWith('mod', 'post.remove', false);
    expect(mockSetRolePermission).toHaveBeenCalledTimes(2);
  });

  it('jog-kapcsoló: hiba után visszagörget, és a zár felenged', async () => {
    const view = await mount();
    mockSetRolePermission.mockRejectedValueOnce(new Error('rls')).mockResolvedValueOnce(undefined);
    await act(async () => view.root.findByType(RolePermissionMatrix).props.toggle('mod', 'post.remove'));
    expect(view.root.findByType(RolePermissionMatrix).props.pairs.size).toBe(0);
    await act(async () => view.root.findByType(RolePermissionMatrix).props.toggle('mod', 'post.remove'));
    expect(mockSetRolePermission).toHaveBeenNthCalledWith(2, 'mod', 'post.remove', true);
  });

  it('bejelentés lezárása: dupla koppintás → EGY resolveReport', async () => {
    const view = await mount();
    mockResolveReport.mockReturnValue(new Promise(() => {}));
    await doubleTap(pressable(view, 'admin.reportResolve'));
    expect(mockResolveReport).toHaveBeenCalledTimes(1);
  });

  it('bejelentett poszt eltávolítása: dupla koppintás → EGY moderatePostGlobal és EGY lezárás', async () => {
    const view = await mount();
    const d = deferred<void>();
    mockModeratePost.mockReturnValue(d.promise);
    mockResolveReport.mockResolvedValue(undefined);
    await doubleTap(pressable(view, 'admin.reportRemove'));
    await act(async () => d.resolve());
    expect(mockModeratePost).toHaveBeenCalledTimes(1);
    expect(mockResolveReport).toHaveBeenCalledTimes(1);
  });

  it('fellebbezés elbírálása: dupla koppintás → EGY resolveAppeal', async () => {
    const view = await mount();
    mockResolveAppeal.mockReturnValue(new Promise(() => {}));
    await doubleTap(pressable(view, 'admin.appealGrant'));
    expect(mockResolveAppeal).toHaveBeenCalledTimes(1);
  });

  it('DAC7-export: dupla koppintás → EGY letöltés; hiba után újra indítható', async () => {
    const view = await mount();
    const d = deferred<void>();
    mockDac7.mockReturnValue(d.promise);
    await doubleTap(pressable(view, 'admin.dac7Export'));
    expect(mockDac7).toHaveBeenCalledTimes(1);
    await act(async () => d.reject(new Error('hálózat')));
    mockDac7.mockResolvedValue(undefined);
    await act(async () => pressable(view, 'admin.dac7Export').props.onPress());
    expect(mockDac7).toHaveBeenCalledTimes(2);
  });

  it('kifizetés jóváhagyása: dupla koppintás → EGY reviewPayout', async () => {
    const view = await mount();
    mockReviewPayout.mockReturnValue(new Promise(() => {}));
    await doubleTap(pressable(view, 'admin.payouts.approve'));
    expect(mockReviewPayout).toHaveBeenCalledTimes(1);
  });

  it('számla kifizetettnek jelölése: dupla koppintás → EGY markInvoicePaid', async () => {
    const view = await mount();
    mockMarkInvoicePaid.mockReturnValue(new Promise(() => {}));
    await doubleTap(pressable(view, 'admin.orgs.markPaid'));
    expect(mockMarkInvoicePaid).toHaveBeenCalledTimes(1);
  });
});
