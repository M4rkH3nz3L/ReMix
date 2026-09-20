import { reachableMediaUrl } from '@/lib/mediaUrl';

// A tesztek az EXPO_PUBLIC_SUPABASE_URL-t egy LAN-originre állítják.
const ORIGINAL = process.env.EXPO_PUBLIC_SUPABASE_URL;

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://192.168.0.34:54421';
});
afterAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = ORIGINAL;
});

describe('reachableMediaUrl', () => {
  it('a 127.0.0.1 storage-URL originjét az elérhető hostra írja (port + path marad)', () => {
    expect(
      reachableMediaUrl('http://127.0.0.1:54421/storage/v1/object/public/renders/feed/x.mp4')
    ).toBe('http://192.168.0.34:54421/storage/v1/object/public/renders/feed/x.mp4');
  });

  it('localhost / 0.0.0.0 origint is átír', () => {
    expect(reachableMediaUrl('http://localhost:54421/storage/a.mp4')).toBe(
      'http://192.168.0.34:54421/storage/a.mp4'
    );
    expect(reachableMediaUrl('http://0.0.0.0:54421/x')).toBe('http://192.168.0.34:54421/x');
  });

  it('éles (nem-loopback) URL-t érintetlenül hagy', () => {
    const prod = 'https://abc.supabase.co/storage/v1/object/public/renders/feed/x.mp4';
    expect(reachableMediaUrl(prod)).toBe(prod);
  });

  it('null / üres biztonságos', () => {
    expect(reachableMediaUrl(null)).toBeNull();
    expect(reachableMediaUrl(undefined)).toBeNull();
    expect(reachableMediaUrl('')).toBeNull();
  });
});
