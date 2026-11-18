import type { PhotoRegister } from '@sim/contracts';
import type { EncodedPhoto } from './imageEncoding';

export interface PendingPhoto extends EncodedPhoto {
  meta: Omit<PhotoRegister, 'key'>;
}
