import { Ssh } from '../native/SshModule';

/**
 * Ejecuta una operación del vault; si está bloqueado, pide huella/PIN y
 * reintenta una vez.
 */
export async function withUnlock<T>(
  op: () => Promise<T>,
  reason = 'Acceder a tus hosts y claves',
): Promise<T> {
  try {
    return await op();
  } catch (e: any) {
    if (e?.code !== 'LOCKED') {
      throw e;
    }
    await Ssh.unlock(reason);
    return op();
  }
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  const raw = await withUnlock(() => Ssh.secureGet(name));
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown): Promise<void> {
  return withUnlock(() => Ssh.secureSet(name, JSON.stringify(value)));
}

export function newId(): string {
  // Suficiente para ids locales; no se usa con fines criptográficos.
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  ).toLowerCase();
}
