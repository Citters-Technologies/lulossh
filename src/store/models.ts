export type HostAuth =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; keyId: string };

export interface Host {
  id: string;
  /** Nombre visible, p. ej. "web-prod". */
  name: string;
  host: string;
  port: number;
  username: string;
  auth: HostAuth;
  /** Huella aceptada (SHA256:…). Si cambia, se avisa antes de conectar. */
  fingerprint?: string;
  /** Agrupación libre, p. ej. "Clientes" o "Casa". */
  group?: string;
  lastUsedAt?: number;
  /**
   * Nombre de la clave en el cliente de origen (p. ej. UserKey de Xshell).
   * Sirve para enlazarla si se importa más tarde.
   */
  importedKeyName?: string;
}

export interface SshKey {
  id: string;
  name: string;
  type: string;
  publicKey: string;
  createdAt: number;
}

export function hostLabel(h: Pick<Host, 'username' | 'host' | 'port'>) {
  return `${h.username}@${h.host}${h.port !== 22 ? `:${h.port}` : ''}`;
}

/** Valida un host antes de guardarlo. Devuelve un mensaje de error o null. */
export function validateHost(h: Omit<Host, 'id'>): string | null {
  if (!h.host.trim()) {
    return 'Falta el host';
  }
  if (/\s/.test(h.host.trim())) {
    return 'El host no puede tener espacios';
  }
  if (!Number.isInteger(h.port) || h.port < 1 || h.port > 65535) {
    return 'Puerto no válido (1-65535)';
  }
  if (!h.username.trim()) {
    return 'Falta el usuario';
  }
  if (h.auth.type === 'privateKey' && !h.auth.keyId) {
    return 'Elige una clave';
  }
  return null;
}
