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
  /** Veces que se ha conectado (para "Usados con frecuencia"). */
  useCount?: number;
  favorite?: boolean;
  /** SO detectado al conectar (ID de os-release: "ubuntu", "debian"…). */
  os?: string;
  /**
   * Nombre de la clave en el cliente de origen (p. ej. UserKey de Xshell).
   * Sirve para enlazarla si se importa más tarde.
   */
  importedKeyName?: string;
  /**
   * Identidad reutilizable (usuario + credenciales). Si está, manda sobre
   * username/auth del propio host.
   */
  identityId?: string;
  /**
   * Sesión persistente: al conectar entra en una sesión de tmux (la crea o se
   * reengancha). Si se corta la conexión, lo que corría sigue en el servidor
   * y al reconectar se vuelve al mismo terminal.
   */
  tmux?: boolean;
  /** Nombre de la sesión de tmux (por defecto DEFAULT_TMUX_SESSION). */
  tmuxSession?: string;
}

export const DEFAULT_TMUX_SESSION = 'lulossh';

/** Nombre de sesión de tmux seguro para la línea de comandos. */
export function tmuxSessionName(h: Pick<Host, 'tmuxSession'>): string {
  return (
    (h.tmuxSession ?? '').replace(/[^A-Za-z0-9_.-]/g, '') ||
    DEFAULT_TMUX_SESSION
  );
}

/**
 * Lo que se escribe en la shell al conectar para entrar en tmux. Empieza con
 * espacio para no quedar en el historial (HISTCONTROL=ignorespace) y activa
 * el ratón en esa sesión para que el desplazamiento táctil recorra el
 * historial de tmux. Sin tmux instalado, avisa y se queda en la shell.
 */
export function tmuxCommand(h: Pick<Host, 'tmuxSession'>): string {
  const n = tmuxSessionName(h);
  return (
    ` command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s ${n} \\; set-option mouse on` +
    ` || echo "LuloSSH: tmux no está instalado en este servidor (p. ej. sudo apt install tmux)"\r`
  );
}

/** Usuario + credenciales reutilizables en muchos hosts (como en JuiceSSH). */
export interface Identity {
  id: string;
  name: string;
  username: string;
  auth: HostAuth;
}

/** Host con el usuario y las credenciales efectivas (las de su identidad). */
export function resolveHost(h: Host, identities: Identity[]): Host {
  const idn = h.identityId && identities.find(i => i.id === h.identityId);
  return idn ? { ...h, username: idn.username, auth: idn.auth } : h;
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
