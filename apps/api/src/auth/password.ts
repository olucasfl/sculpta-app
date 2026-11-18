import { hash, verify } from '@node-rs/argon2';

// Parâmetros argon2id recomendados pela OWASP (19 MiB, 2 iterações).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

let dummyHash: Promise<string> | undefined;

/** Compara a senha. Sem hash (usuário inexistente), compara com um hash falso para não vazar timing. */
export async function verifyPassword(passwordHash: string | null, password: string) {
  if (!passwordHash) {
    dummyHash ??= hashPassword('senha-inexistente-para-timing');
    await verify(await dummyHash, password);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
