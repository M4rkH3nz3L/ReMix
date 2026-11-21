import type { Dispatch, SetStateAction } from 'react';

/** a 3D Stúdió képernyő-fázisa */
export type Phase = 'empty' | 'capturing' | 'meshScanning' | 'roomScanning' | 'reconstructing' | 'viewer';

export type SetState<T> = Dispatch<SetStateAction<T>>;
