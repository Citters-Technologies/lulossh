import {NativeEventEmitter, NativeModules} from 'react-native';

/**
 * Contrato único del módulo SSH. Cada plataforma lo implementa en nativo:
 *  - Android: Kotlin + sshj (android/app/src/main/java/com/lulossh/ssh)
 *  - iOS: Swift (pendiente) con la misma API.
 * La UI solo depende de este fichero, así que es portable.
 */

export type AuthMethod =
  | {type: 'password'; password: string}
  | {type: 'privateKey'; keyId: string; passphrase?: string};

export interface ConnectOptions {
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
}

export interface SshSessionEvents {
  /** Datos de la shell en base64 (los bytes pueden no ser UTF-8 válido). */
  data: {sessionId: string; base64: string};
  closed: {sessionId: string; reason?: string};
  /** El host es nuevo o su huella cambió: la UI debe pedir confirmación. */
  hostKey: {sessionId: string; fingerprint: string; changed: boolean};
  error: {sessionId: string; message: string};
}

export interface SshModuleSpec {
  connect(options: ConnectOptions): Promise<string>; // sessionId
  write(sessionId: string, base64: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  acceptHostKey(sessionId: string, accept: boolean): Promise<void>;
  /** Guarda la clave privada (PEM/OpenSSH) cifrada en Keystore/Keychain. */
  importKey(keyId: string, pem: string): Promise<void>;
  deleteKey(keyId: string): Promise<void>;
}

const native = NativeModules.LuloSsh as SshModuleSpec | undefined;

if (!native) {
  console.warn('LuloSsh native module no disponible en esta plataforma');
}

export const Ssh = native as SshModuleSpec;
export const sshEvents = new NativeEventEmitter(NativeModules.LuloSsh);

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return globalThis.btoa(bin);
}
