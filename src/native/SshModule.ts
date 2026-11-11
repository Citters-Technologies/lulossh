import { NativeEventEmitter, NativeModules } from 'react-native';

/**
 * Contrato único del módulo SSH. Cada plataforma lo implementa en nativo:
 *  - Android: Kotlin + sshj (android/app/src/main/java/com/lulossh/ssh)
 *  - iOS: Swift (pendiente) con la misma API.
 * La UI solo depende de este fichero, así que es portable.
 */

export type AuthMethod =
  | { type: 'password'; password: string }
  /** La clave privada y su passphrase se leen del vault en nativo. */
  | { type: 'privateKey'; keyId: string };

export interface ConnectOptions {
  /**
   * Id de sesión generado por JS. Permite atender eventos (hostKey) antes de
   * que connect() resuelva, que espera a que el usuario acepte la huella.
   */
  sessionId: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  cols: number;
  rows: number;
  /** TERM, por defecto xterm-256color */
  term?: string;
  /** Huella conocida (SHA256:...) para verificar el host. */
  knownHostFingerprint?: string;
  /** Para listar/restaurar la sesión y mostrarla en la notificación. */
  hostId?: string;
  title?: string;
}

/** Sesión abierta en nativo (sigue viva aunque la UI se haya cerrado). */
export interface LiveSession {
  sessionId: string;
  hostId: string | null;
  title: string;
  startedAt: number;
}

export interface SshSessionEvents {
  /** Datos de la shell en base64 (los bytes pueden no ser UTF-8 válido). */
  data: { sessionId: string; base64: string };
  closed: { sessionId: string; reason?: string };
  /** El host es nuevo o su huella cambió: la UI debe pedir confirmación. */
  hostKey: { sessionId: string; fingerprint: string; changed: boolean };
  error: { sessionId: string; message: string };
}

export interface SshModuleSpec {
  /** Resuelve con el mismo sessionId de options cuando la shell está lista. */
  connect(options: ConnectOptions): Promise<string>;
  write(sessionId: string, base64: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  acceptHostKey(sessionId: string, accept: boolean): Promise<void>;
  /**
   * Ejecuta un comando corto en un canal aparte de la misma conexión (no se
   * ve en la terminal). Devuelve stdout.
   */
  exec(sessionId: string, command: string, timeoutMs: number): Promise<string>;

  /**
   * Sesiones en segundo plano: siguen abiertas (servicio en primer plano con
   * notificación) hasta que se desconectan o el servidor las cierra.
   */
  listSessions(): Promise<LiveSession[]>;
  /** Historial reciente de la sesión (base64), para repintar la terminal. */
  attach(sessionId: string): Promise<string>;
  /** Sesión que el usuario pidió abrir desde la notificación, una vez. */
  consumePendingOpen(): Promise<string | null>;

  /**
   * Vault cifrado (Keystore/Keychain). Si el usuario no se ha autenticado
   * recientemente, las llamadas fallan con code === 'LOCKED': llamar a unlock().
   */
  unlock(reason: string): Promise<void>;
  secureGet(name: string): Promise<string | null>;
  secureSet(name: string, value: string): Promise<void>;
  secureDelete(name: string): Promise<void>;

  /** Genera un par ed25519; la privada se queda en el vault. */
  generateKey(keyId: string, comment: string): Promise<KeyInfo>;
  /** Valida y guarda una clave PEM/OpenSSH (y su passphrase, si tiene). */
  importKey(
    keyId: string,
    pem: string,
    passphrase: string | null,
    comment: string,
  ): Promise<KeyInfo>;
  deleteKey(keyId: string): Promise<void>;

  /**
   * Teclado del sistema para la terminal, vía una vista nativa que se anuncia
   * como "contraseña visible sin sugerencias" (sin mayúsculas ni
   * autocorrección en ningún teclado). Lo escrito llega como evento
   * "termInput" {data}.
   */
  showKeyboard(): void;
  hideKeyboard(detach: boolean): void;

  /** Teclas de volumen -> evento "volumeKey" {direction: 'up'|'down'}. */
  setVolumeKeysEnabled(enabled: boolean): void;
  /** Preferencias de interfaz NO sensibles, sin cifrar. */
  prefGet(name: string): Promise<string | null>;
  prefSet(name: string, value: string): Promise<void>;

  /**
   * Selector de ficheros (varios). Los zip (.xts/.zip) se expanden conservando
   * las carpetas. Resuelve con [] si el usuario cancela.
   */
  pickImportFiles(): Promise<ImportEntry[]>;

  /** Portapapeles del sistema. */
  copyText(text: string): void;
  pasteText(): Promise<string | null>;
}

export interface ImportEntry {
  /** Ruta dentro del zip (con carpetas) o nombre del fichero. */
  path: string;
  text: string;
}

export interface KeyInfo {
  /** ssh-ed25519, ssh-rsa, ecdsa-sha2-nistp256… */
  type: string;
  /** Línea lista para authorized_keys. */
  publicKey: string;
}

const native = NativeModules.LuloSsh as SshModuleSpec | undefined;

if (!native) {
  console.warn('LuloSsh native module no disponible en esta plataforma');
}

// Sin módulo nativo (tests, plataforma sin implementar), cada llamada
// devuelve una promesa rechazada en lugar de romper el render.
export const Ssh: SshModuleSpec =
  native ??
  (new Proxy(
    {},
    {
      get: () => () => {
        const p = Promise.reject(new Error('LuloSsh no disponible'));
        p.catch(() => {});
        return p;
      },
    },
  ) as SshModuleSpec);
type Listener = (payload: any) => void;
interface EventSource {
  addListener(event: string, l: Listener): { remove(): void };
}

// Sin módulo nativo (tests, plataforma sin implementar) devuelve un emisor inerte.
export const sshEvents: EventSource = native
  ? (new NativeEventEmitter(NativeModules.LuloSsh) as unknown as EventSource)
  : { addListener: () => ({ remove() {} }) };

/** Codifica texto en UTF-8 y lo devuelve en base64. */
export function toBase64(text: string): string {
  const bin = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_m, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  return (globalThis as any).btoa(bin);
}
