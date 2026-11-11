import { useCallback, useEffect, useState } from 'react';
import {
  HostUpdate,
  hostsWaitingForKey,
  isIncomplete,
  planImport,
} from '../import/merge';
import type { ImportResult } from '../import/xshell';
import { renameFolder } from './folders';
import { Ssh } from '../native/SshModule';
import { Host, SshKey } from './models';
import { newId, readJson, withUnlock, writeJson } from './vault';

const HOSTS = 'hosts';
const KEYS = 'keys';

/**
 * Estado de hosts y claves, persistido cifrado en el vault.
 * (Más adelante, la sync de Drive exportará estos mismos datos cifrados.)
 */
export function useStore() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [h, k] = [
        await readJson<Host[]>(HOSTS, []),
        await readJson<SshKey[]>(KEYS, []),
      ];
      setHosts(h);
      setKeys(k);
      setLoaded(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveHosts = async (next: Host[]) => {
    await writeJson(HOSTS, next);
    setHosts(next);
  };

  const saveKeys = async (next: SshKey[]) => {
    await writeJson(KEYS, next);
    setKeys(next);
  };

  return {
    hosts,
    keys,
    loaded,
    error,
    reload: load,

    upsertHost: (h: Omit<Host, 'id'> & { id?: string }) => {
      const host: Host = { ...h, id: h.id ?? newId() };
      const exists = hosts.some(x => x.id === host.id);
      return saveHosts(
        exists
          ? hosts.map(x => (x.id === host.id ? host : x))
          : [...hosts, host],
      );
    },

    deleteHost: (id: string) => saveHosts(hosts.filter(h => h.id !== id)),

    patchHost: (id: string, patch: Partial<Host>) =>
      saveHosts(hosts.map(h => (h.id === id ? { ...h, ...patch } : h))),

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
            `Clave ${k.name}: ${e?.message ?? e} (si tiene passphrase, impórtala desde Claves)`,
          );
        }
      }
      const allKeys = [...keys, ...newKeys];
      if (newKeys.length) {
        await saveKeys(allKeys);
      }

      const plan = planImport(hosts, allKeys, data.hosts, newId);
      const visible = plan.toUpdate.filter(u => u.changes.length);
      const apply =
        visible.length === 0 ? true : await confirmUpdates(visible);
      const updates = new Map(
        plan.toUpdate
          .filter(u => apply || !u.changes.length)
          .map(u => [u.id, u.patch]),
      );
      const next = [
        ...hosts.map(h => (updates.has(h.id) ? { ...h, ...updates.get(h.id) } : h)),
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
        incomplete: next.filter(h => isIncomplete(h, allKeys)).length,
        notes: [...report, ...plan.notes, ...data.skipped],
      };
    },

    /** Hosts importados que esperaban esta clave (por nombre). */
    hostsWaitingForKey: (key: SshKey) =>
      hostsWaitingForKey(hosts, keys, key.name),

    /** Asigna una clave a varios hosts de una vez. */
    assignKey: (keyId: string, hostIds: string[]) =>
      saveHosts(
        hosts.map(h =>
          hostIds.includes(h.id)
            ? { ...h, auth: { type: 'privateKey', keyId } }
            : h,
        ),
      ),

    /** Mover/renombrar una carpeta con todo su contenido. */
    renameFolder: (from: string, to: string) =>
      saveHosts(renameFolder(hosts, from, to)),

    /** No se puede borrar una clave en uso por algún host. */
    deleteKey: async (id: string) => {
      const users = hosts.filter(
        h => h.auth.type === 'privateKey' && h.auth.keyId === id,
      );
      if (users.length) {
        throw new Error(
          `La usan: ${users
            .map(h => h.name)
            .join(', ')}. Cambia esos hosts primero.`,
        );
      }
      await withUnlock(() => Ssh.deleteKey(id));
      await saveKeys(keys.filter(k => k.id !== id));
    },
  };
}

export type Store = ReturnType<typeof useStore>;
