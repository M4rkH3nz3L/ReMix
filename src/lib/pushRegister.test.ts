import { registerForPush } from '@/lib/pushNotifications';
import { saveCurrentDevicePushToken } from '@/lib/deviceInfo';

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4 },
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getExpoPushTokenAsync: () => mockGetToken(),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'p' } } } } }));
jest.mock('@/lib/deviceInfo', () => ({ saveCurrentDevicePushToken: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

describe('push-regisztráció', () => {
  it('a token hibája nem vonja vissza a megadott engedélyt', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockRejectedValue(new Error('nem található érvényes aps-environment'));
    await expect(registerForPush('u')).resolves.toEqual({ granted: true, token: null });
  });
  it('sikeres tokennél ment', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'tok' });
    await expect(registerForPush('u')).resolves.toEqual({ granted: true, token: 'tok' });
    expect(saveCurrentDevicePushToken).toHaveBeenCalledWith('u', 'tok');
  });
  it('elutasított engedélynél nincs token-kérés', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    await expect(registerForPush('u')).resolves.toEqual({ granted: false, token: null });
    expect(mockGetToken).not.toHaveBeenCalled();
  });
});
