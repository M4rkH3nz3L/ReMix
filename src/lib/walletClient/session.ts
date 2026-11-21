import { useAuth } from '@/store/authStore';

export function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}
