import { cloudBaseUrl } from '@/lib/backend';
import { logCaught } from '@/lib/logCaught';

type LoginError = 'invalidCredentials' | 'emailNotConfirmed' | 'unavailable';

/** Belépés felhasználónévvel vagy telefonnal: a szerver oldja fel az e-mailt, a kliens csak tokent kap. */
export async function loginWithIdentifier(identifier: string, password: string): Promise<{ access_token: string; refresh_token: string } | { error: LoginError }> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    if (res.ok) {
      return (await res.json()) as { access_token: string; refresh_token: string };
    }
    if (res.status === 401 || res.status === 400) {
      return { error: 'invalidCredentials' };
    }
    return { error: res.status === 403 ? 'emailNotConfirmed' : 'unavailable' };
  } catch (caught) {
    logCaught('lib/loginIdentifier.ts', caught);
    return { error: 'unavailable' };
  }
}
