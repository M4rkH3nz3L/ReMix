// 🛑 A render-megszakítás hibaosztálya és felismerése — expo-mentes mag.
import { t as tr } from 'i18next';

/** A felhasználó megszakította a műveletet. */
export class RenderCancelledError extends Error {
  constructor() {
    super(tr('lib.render.cancelled'));
    this.name = 'RenderCancelledError';
  }
}

/** A ✕ után a hálózati hívás nyers AbortError-ral bukik: ezt is megszakításként adjuk vissza. */
export function asCancelled(e: unknown, signal?: AbortSignal): unknown {
  return signal?.aborted ? new RenderCancelledError() : e;
}

export function isRenderCancelledError(e: unknown): boolean {
  return (
    e instanceof RenderCancelledError ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'RenderCancelledError')
  );
}
