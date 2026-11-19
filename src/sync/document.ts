/**
 * El documento de sincronización: lo que se cifra y se guarda en la nube del
 * usuario (Google Drive o OneDrive, carpeta privada de la app).
 *
 * Viaja cifrado con la contraseña de sincronización (scrypt + AES-256-GCM,
 * el mismo formato que la copia de seguridad): ni Google, ni Microsoft, ni
 * Citters pueden leerlo. La contraseña no sale nunca del dispositivo.
 */
import type { Host, Identity, SshKey } from '../store/models';
import { mergeItems, mergeTombstones, Tombstone } from './merge';

export const SYNC_FORMAT = 'lulossh-sync';
export const SYNC_VERSION = 1;
/** Nombre del fichero en la carpeta privada de la app en la nube. */
export const SYNC_FILE_NAME = 'lulossh-sync.bin';

/** Clave privada (y passphrase) que viaja dentro del documento cifrado. */
export interface KeySecret {
  pem: string;
  passphrase?: string;
}

export interface SyncDoc {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  /** Dispositivo y momento de la última escritura (diagnóstico). */
  writtenBy: string;
  writtenAt: number;
  hosts: Host[];
  identities: Identity[];
  keys: SshKey[];
  secrets: Record<string, KeySecret>;
  tombstones: Tombstone[];
}

export interface LocalState {
  hosts: Host[];
  identities: Identity[];
  keys: SshKey[];
  tombstones: Tombstone[];
}

export function parseSyncDoc(json: string): SyncDoc {
  const d = JSON.parse(json);
  if (d?.format !== SYNC_FORMAT) {
    throw new Error(
      'El fichero de la nube no es una sincronización de LuloSSH',
    );
  }
  if (d.version > SYNC_VERSION) {
    throw new Error(
      'La sincronización la escribió una versión más nueva de LuloSSH: actualiza la app',
    );
  }
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    writtenBy: String(d.writtenBy ?? ''),
    writtenAt: Number(d.writtenAt) || 0,
    hosts: Array.isArray(d.hosts) ? d.hosts : [],
    identities: Array.isArray(d.identities) ? d.identities : [],
    keys: Array.isArray(d.keys) ? d.keys : [],
    secrets: d.secrets && typeof d.secrets === 'object' ? d.secrets : {},
    tombstones: Array.isArray(d.tombstones) ? d.tombstones : [],
  };
}

/**
 * Fusiona el estado local con el remoto (si lo hay). El resultado es a la
 * vez el nuevo estado local y lo que se sube.
 */
export function mergeSync(
  local: LocalState,
  remote: SyncDoc | null,
  now: number,
): LocalState {
  if (!remote) {
    return {
      ...local,
      tombstones: mergeTombstones(local.tombstones, [], now),
    };
  }
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones, now);
  return {
    hosts: mergeItems('host', local.hosts, remote.hosts, tombstones),
    identities: mergeItems(
      'identity',
      local.identities,
      remote.identities,
      tombstones,
    ),
    keys: mergeItems('key', local.keys, remote.keys, tombstones),
    tombstones,
  };
}

export function buildSyncDoc(
  state: LocalState,
  secrets: Record<string, KeySecret>,
  deviceId: string,
  now: number,
): SyncDoc {
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    writtenBy: deviceId,
    writtenAt: now,
    hosts: state.hosts,
    identities: state.identities,
    keys: state.keys,
    // Solo las claves que siguen existiendo.
    secrets: Object.fromEntries(
      state.keys.filter(k => secrets[k.id]).map(k => [k.id, secrets[k.id]]),
    ),
    tombstones: state.tombstones,
  };
}
