import { createHash } from 'node:crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
