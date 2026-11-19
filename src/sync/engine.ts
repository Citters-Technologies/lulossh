/**
 * Una pasada de sincronización: bajar → descifrar → fusionar → aplicar en
 * local → cifrar → subir. La nube solo ve un fichero cifrado.
 *
 * La subida es condicional (ETag): si otro dispositivo escribió entre medias,
 * el proveedor lanza SyncConflict y se repite la pasada con lo nuevo.
 */
import { Ssh } from '../native/SshModule';
import {
  buildSyncDoc,
  KeySecret,
  LocalState,
  mergeSync,
  parseSyncDoc,
  SyncDoc,
} from './document';
import { diffSummary } from './merge';

/** Almacenamiento en la nube del usuario (Google Drive, OneDrive…). */
export interface CloudProvider {
  readonly id: 'google' | 'microsoft';
  readonly label: string;
  /** Contenido cifrado y su versión (ETag), o null si aún no existe. */
  download(): Promise<{ content: string; etag: string } | null>;
  /**
   * Sube el contenido. Con `etag`, solo si la versión remota sigue siendo
   * esa (si no, lanza SyncConflict). Sin `etag`, solo si no existe aún.
   */
  upload(content: string, etag: string | null): Promise<void>;
}

/** Otro dispositivo escribió entre la bajada y la subida. */
export class SyncConflict extends Error {
  constructor() {
    super('La nube cambió durante la sincronización');
  }
}

/** Lo que el motor necesita del almacén local (useStore). */
export interface SyncTarget {
  snapshot(): LocalState;
  /**
   * Aplica el estado fusionado tal cual (sin volver a fechar) e importa al
   * vault las claves nuevas con sus secretos; borra del vault las que ya
   * no están.
   */
  apply(state: LocalState, secrets: Record<string, KeySecret>): Promise<void>;
}

export interface SyncResult {
  hosts: { added: number; changed: number; removed: number };
  identities: { added: number; changed: number; removed: number };
  keys: { added: number; changed: number; removed: number };
  uploaded: boolean;
}

const MAX_ATTEMPTS = 3;

export async function syncOnce(
  target: SyncTarget,
  cloud: CloudProvider,
  password: string,
  deviceId: string,
  now: () => number = Date.now,
): Promise<SyncResult> {
  for (let attempt = 1; ; attempt++) {
    const remoteFile = await cloud.download();
    let remote: SyncDoc | null = null;
    if (remoteFile) {
      // Falla con code BAD_PASSWORD si la contraseña no es la de la nube.
      remote = parseSyncDoc(
        await Ssh.decryptBackup(remoteFile.content, password),
      );
    }
    const before = target.snapshot();
    const merged = mergeSync(before, remote, now());
    await target.apply(merged, remote?.secrets ?? {});

    // Sin secretos: los añade nativo desde el vault al cifrar.
    const doc = buildSyncDoc(merged, {}, deviceId, now());
    const sealed = await Ssh.sealSync(
      JSON.stringify(doc),
      merged.keys.map(k => k.id),
      password,
    );
    try {
      await cloud.upload(sealed, remoteFile?.etag ?? null);
    } catch (e) {
      if (e instanceof SyncConflict && attempt < MAX_ATTEMPTS) {
        continue; // otro dispositivo se adelantó: fusionar de nuevo
      }
      throw e;
    }
    return {
      hosts: diffSummary(before.hosts, merged.hosts),
      identities: diffSummary(before.identities, merged.identities),
      keys: diffSummary(before.keys, merged.keys),
      uploaded: true,
    };
  }
}
