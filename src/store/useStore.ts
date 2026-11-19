import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HostUpdate,
  hostsWaitingForKey,
  isIncomplete,
  planImport,
} from '../import/merge';
import type { ImportResult } from '../import/xshell';
import {
  BACKUP_PREFS,
  backupFileName,
  BackupPayload,
  buildMeta,
  mergeById,
} from './backup';
import { renameFolder } from './folders';
import { Ssh } from '../native/SshModule';
import { Host, Identity, resolveHost, SshKey } from './models';
import { newId, readJson, withUnlock, writeJson } from './vault';
import { stampChanges, SyncKind, Tombstone } from '../sync/merge';

const HOSTS = 'hosts';
const KEYS = 'keys';
const IDENTITIES = 'identities';
/** Borrados recientes (para que la sincronización no los resucite). */
const TOMBSTONES = 'syncTombstones';

/**
 * Estado de hosts, identidades y claves, persistido cifrado en el vault.
 * Cada cambio queda fechado (updatedAt) y cada borrado deja una lápida: es
 * lo que usa la sincronización cifrada entre dispositivos (src/sync).
 */
/** `enabled`: no leer el vault hasta que la app esté desbloqueada. */
export function useStore(enabled = true) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const hostsRef = useRef<Host[]>([]);
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const keysRef = useRef<SshKey[]>([]);
  const identitiesRef = useRef<Identity[]>([]);
  const tombstonesRef = useRef<Tombstone[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [h, k, i, t] = [
        await readJson<Host[]>(HOSTS, []),
        await readJson<SshKey[]>(KEYS, []),
        await readJson<Identity[]>(IDENTITIES, []),
        await readJson<Tombstone[]>(TOMBSTONES, []),
      ];
      hostsRef.current = h;
      keysRef.current = k;
      identitiesRef.current = i;
      tombstonesRef.current = t;
      setHosts(h);
      setKeys(k);
      setIdentities(i);
      setLoaded(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      load();
    }
  }, [enabled, load]);

  // Última lista conocida: los parches seguidos (huella, SO, uso) no se pisan.
  // (Solo se actualiza al cargar y al guardar, nunca desde el render.)
  /** Fecha lo cambiado respecto a `prev` y apunta lo borrado. */
  const stamp = async <T extends { id: string; updatedAt?: number }>(
    kind: SyncKind,
    prev: T[],
    next: T[],
  ): Promise<T[]> => {
    const { items, deleted } = stampChanges(kind, prev, next, Date.now());
    if (deleted.length) {
      tombstonesRef.current = [...tombstonesRef.current, ...deleted];
      await writeJson(TOMBSTONES, tombstonesRef.current);
    }
    return items;
  };

  const saveHosts = async (next: Host[]) => {
    const items = await stamp('host', hostsRef.current, next);
    hostsRef.current = items;
    await writeJson(HOSTS, items);
    setHosts(items);
  };

  const saveKeys = async (next: SshKey[]) => {
    const items = await stamp('key', keysRef.current, next);
    keysRef.current = items;
    await writeJson(KEYS, items);
    setKeys(items);
  };

  const saveIdentities = async (next: Identity[]) => {
    const items = await stamp('identity', identitiesRef.current, next);
    identitiesRef.current = items;
    await writeJson(IDENTITIES, items);
    setIdentities(items);
  };

  return {
    hosts,
    keys,
    identities,
    loaded,

    /** Host con las credenciales efectivas (identidad aplicada). */
    resolve: (h: Host) => resolveHost(h, identities),
    isIncomplete: (h: Host) => isIncomplete(h, keys, identities),

    upsertIdentity: (i: Omit<Identity, 'id'> & { id?: string }) => {
      const idn: Identity = { ...i, id: i.id ?? newId() };
      const exists = identities.some(x => x.id === idn.id);
      return saveIdentities(
        exists
          ? identities.map(x => (x.id === idn.id ? idn : x))
          : [...identities, idn],
      ).then(() => idn);
    },

    /** Al borrar una identidad, sus hosts quedan con sus propios datos. */
    deleteIdentity: async (id: string) => {
      const users = hostsRef.current.filter(h => h.identityId === id);
      if (users.length) {
        await saveHosts(
          hostsRef.current.map(h =>
            h.identityId === id ? { ...h, identityId: undefined } : h,
          ),
        );
      }
      await saveIdentities(identities.filter(i => i.id !== id));
    },

    /** Deja la identidad exactamente en estos hosts (quita del resto). */
    setIdentityHosts: (identityId: string, hostIds: string[]) =>
      saveHosts(
        hostsRef.current.map(h =>
          hostIds.includes(h.id)
            ? { ...h, identityId }
            : h.identityId === identityId
            ? { ...h, identityId: undefined }
            : h,
        ),
      ),

    /** Asigna (o quita, con null) una identidad a varios hosts de una vez. */
    assignIdentity: (identityId: string | null, hostIds: string[]) =>
      saveHosts(
        hostsRef.current.map(h =>
          hostIds.includes(h.id)
            ? { ...h, identityId: identityId ?? undefined }
            : h,
        ),
      ),
    error,
    reload: load,

    upsertHost: (h: Omit<Host, 'id'> & { id?: string }) => {
      const host: Host = { ...h, id: h.id ?? newId() };
      const exists = hostsRef.current.some(x => x.id === host.id);
      return saveHosts(
        exists
          ? hostsRef.current.map(x => (x.id === host.id ? host : x))
          : [...hostsRef.current, host],
      );
    },

    deleteHost: (id: string) =>
      saveHosts(hostsRef.current.filter(h => h.id !== id)),

    deleteHosts: (ids: string[]) => {
      const gone = new Set(ids);
      return saveHosts(hostsRef.current.filter(h => !gone.has(h.id)));
    },

    patchHost: (id: string, patch: Partial<Host>) =>
      saveHosts(
        hostsRef.current.map(h => (h.id === id ? { ...h, ...patch } : h)),
      ),

    generateKey: async (name: string) => {
      const id = newId();
      const info = await withUnlock(() => Ssh.generateKey(id, name));
      const key: SshKey = { id, name, ...info, createdAt: Date.now() };
      await saveKeys([...keys, key]);
      return key;
    },

    importKey: async (name: string, pem: string, passphrase: string) => {
      const id = newId();
      const info = await withUnlock(() =>
        Ssh.importKey(id, pem.trim() + '\n', passphrase || null, name),
      );
      const key: SshKey = { id, name, ...info, createdAt: Date.now() };
      await saveKeys([...keys, key]);
      return key;
    },

    /**
     * Importa hosts y claves de otro cliente (p. ej. Xshell). Las claves se
     * asocian por nombre. Si hay hosts existentes incompletos que la
     * importación puede completar, se pregunta con `confirmUpdates`.
     */
    importBatch: async (
      data: ImportResult,
      confirmUpdates: (u: HostUpdate[]) => Promise<boolean>,
    ) => {
      const report: string[] = [];
      const newKeys: SshKey[] = [];
      const known = new Set(keys.map(k => k.name.toLowerCase()));

      for (const k of data.keys) {
        if (known.has(k.name.toLowerCase())) {
          report.push(`Clave ${k.name}: ya existía`);
          continue;
        }
        const id = newId();
        try {
          const info = await withUnlock(() =>
            Ssh.importKey(id, k.pem.trim() + '\n', null, k.name),
          );
          newKeys.push({ id, name: k.name, ...info, createdAt: Date.now() });
          known.add(k.name.toLowerCase());
        } catch (e: any) {
          report.push(
            `Clave ${k.name}: ${
              e?.message ?? e
            } (si tiene passphrase, impórtala desde Claves)`,
          );
        }
      }
      const allKeys = [...keys, ...newKeys];
      if (newKeys.length) {
        await saveKeys(allKeys);
      }

      const plan = planImport(
        hostsRef.current,
        allKeys,
        data.hosts,
        newId,
        identities,
      );
      const visible = plan.toUpdate.filter(u => u.changes.length);
      const apply = visible.length === 0 ? true : await confirmUpdates(visible);
      const updates = new Map(
        plan.toUpdate
          .filter(u => apply || !u.changes.length)
          .map(u => [u.id, u.patch]),
      );
      const next = [
        ...hostsRef.current.map(h =>
          updates.has(h.id) ? { ...h, ...updates.get(h.id) } : h,
        ),
        ...plan.toAdd,
      ];
      if (plan.toAdd.length || updates.size) {
        await saveHosts(next);
      }
      return {
        hosts: plan.toAdd.length,
        updated: apply ? visible.length : 0,
        duplicates: plan.duplicates,
        keys: newKeys.length,
        incomplete: next.filter(h => isIncomplete(h, allKeys, identities))
          .length,
        notes: [...report, ...plan.notes, ...data.skipped],
      };
    },

    /** Hosts importados que esperaban esta clave (por nombre). */
    hostsWaitingForKey: (key: SshKey) =>
      hostsWaitingForKey(hostsRef.current, keys, key.name, identities),

    /** Asigna una clave a varios hosts de una vez. */
    assignKey: (keyId: string, hostIds: string[]) =>
      saveHosts(
        hostsRef.current.map(h =>
          hostIds.includes(h.id)
            ? {
                ...h,
                auth: { type: 'privateKey', keyId },
                identityId: undefined,
              }
            : h,
        ),
      ),

    /** Mover/renombrar una carpeta con todo su contenido. */
    renameFolder: (from: string, to: string) =>
      saveHosts(renameFolder(hostsRef.current, from, to)),

    /** Exporta todo a un fichero cifrado con `password`. null si se cancela. */
    exportBackup: async (password: string) => {
      const meta = await buildMeta({
        hosts: hostsRef.current,
        identities,
        keys,
      });
      return withUnlock(
        () =>
          Ssh.exportBackup(
            JSON.stringify(meta),
            keys.map(k => k.id),
            password,
            backupFileName(),
          ),
        'Exportar copia de seguridad',
      );
    },

    /**
     * Restaura una copia descifrada: añade claves (con sus ids), identidades,
     * hosts y ajustes que no existan. Lo que ya hay se conserva.
     */
    restoreBackup: async (p: BackupPayload) => {
      const notes: string[] = [];
      const newKeys: SshKey[] = [];
      const haveKeys = new Set(keys.map(k => k.id));
      for (const k of p.meta.keys) {
        if (haveKeys.has(k.id)) {
          continue;
        }
        const s = p.secrets[k.id];
        if (!s) {
          notes.push(`Clave ${k.name}: no venía en la copia`);
          continue;
        }
        try {
          const info = await withUnlock(() =>
            Ssh.importKey(k.id, s.pem, s.passphrase ?? null, k.name),
          );
          newKeys.push({ ...k, ...info });
        } catch (e: any) {
          notes.push(`Clave ${k.name}: ${e?.message ?? e}`);
        }
      }
      if (newKeys.length) {
        await saveKeys([...keys, ...newKeys]);
      }
      const ids = mergeById(identities, p.meta.identities);
      if (ids.added) {
        await saveIdentities(ids.merged);
      }
      const hs = mergeById(hostsRef.current, p.meta.hosts);
      if (hs.added) {
        await saveHosts(hs.merged);
      }
      for (const [name, value] of Object.entries(p.meta.prefs)) {
        if (BACKUP_PREFS.includes(name)) {
          await Ssh.prefSet(name, value).catch(() => {});
        }
      }
      return {
        hosts: hs.added,
        identities: ids.added,
        keys: newKeys.length,
        notes,
      };
    },

    /** Puente con el motor de sincronización (src/sync/engine.ts). */
    syncTarget: {
      snapshot: () => ({
        hosts: hostsRef.current,
        identities: identitiesRef.current,
        keys: keysRef.current,
        tombstones: tombstonesRef.current,
      }),
      apply: async (
        state: {
          hosts: Host[];
          identities: Identity[];
          keys: SshKey[];
          tombstones: Tombstone[];
        },
        secrets: Record<string, { pem: string; passphrase?: string }>,
      ) => {
        // Claves: importar al vault las nuevas y quitar las borradas.
        const had = new Set(keysRef.current.map(k => k.id));
        const keep = new Set(state.keys.map(k => k.id));
        const finalKeys: SshKey[] = [];
        for (const k of state.keys) {
          if (had.has(k.id)) {
            finalKeys.push(k);
            continue;
          }
          const sec = secrets[k.id];
          if (!sec) {
            continue; // sin su clave privada no sirve de nada
          }
          await withUnlock(() =>
            Ssh.importKey(k.id, sec.pem, sec.passphrase ?? null, k.name),
          );
          finalKeys.push(k);
        }
        for (const k of keysRef.current) {
          if (!keep.has(k.id)) {
            await withUnlock(() => Ssh.deleteKey(k.id)).catch(() => {});
          }
        }
        // Tal cual, sin volver a fechar: las fechas vienen de la fusión.
        keysRef.current = finalKeys;
        identitiesRef.current = state.identities;
        hostsRef.current = state.hosts;
        tombstonesRef.current = state.tombstones;
        await writeJson(KEYS, finalKeys);
        await writeJson(IDENTITIES, state.identities);
        await writeJson(HOSTS, state.hosts);
        await writeJson(TOMBSTONES, state.tombstones);
        setKeys(finalKeys);
        setIdentities(state.identities);
        setHosts(state.hosts);
      },
    },

    /** No se puede borrar una clave en uso por algún host o identidad. */
    deleteKey: async (id: string) => {
      const uses = (a: Host['auth']) =>
        a.type === 'privateKey' && a.keyId === id;
      const users = [
        ...hostsRef.current.filter(h => uses(h.auth)).map(h => h.name),
        ...identities.filter(i => uses(i.auth)).map(i => `identidad ${i.name}`),
      ];
      if (users.length) {
        throw new Error(
          `La usan: ${users.slice(0, 8).join(', ')}${
            users.length > 8 ? '…' : ''
          }. Cámbialos primero.`,
        );
      }
      await withUnlock(() => Ssh.deleteKey(id));
      await saveKeys(keys.filter(k => k.id !== id));
    },
  };
}

export type Store = ReturnType<typeof useStore>;
