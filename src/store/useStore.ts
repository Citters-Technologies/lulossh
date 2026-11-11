import { useCallback, useEffect, useState } from 'react';
import type { ImportResult } from '../import/xshell';
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
     * asocian por nombre; los hosts repetidos se omiten. Devuelve un resumen.
     */
    importBatch: async (data: ImportResult) => {
      const report: string[] = [];
      const newKeys: SshKey[] = [];
      const byName = new Map(keys.map(k => [k.name.toLowerCase(), k.id]));

      for (const k of data.keys) {
        if (byName.has(k.name.toLowerCase())) {
          report.push(`Clave ${k.name}: ya existía`);
          continue;
        }
        const id = newId();
        try {
          const info = await withUnlock(() =>
            Ssh.importKey(id, k.pem.trim() + '\n', null, k.name),
          );
          newKeys.push({ id, name: k.name, ...info, createdAt: Date.now() });
          byName.set(k.name.toLowerCase(), id);
        } catch (e: any) {
          report.push(
            `Clave ${k.name}: ${e?.message ?? e} (si tiene passphrase, impórtala desde Claves)`,
          );
        }
      }
      if (newKeys.length) {
        await saveKeys([...keys, ...newKeys]);
      }

      const sig = (h: Pick<Host, 'name' | 'host' | 'port' | 'username'>) =>
        `${h.name}|${h.username}@${h.host}:${h.port}`.toLowerCase();
      const seen = new Set(hosts.map(sig));
      const newHosts: Host[] = [];
      let noCreds = 0;
      for (const h of data.hosts) {
        if (seen.has(sig(h))) {
          continue;
        }
        seen.add(sig(h));
        const keyId = h.keyName && byName.get(h.keyName.toLowerCase());
        if (h.keyName && !keyId) {
          report.push(`${h.name}: falta la clave "${h.keyName}"`);
        }
        if (!keyId || !h.username) {
          noCreds++;
        }
        newHosts.push({
          id: newId(),
          name: h.name,
          group: h.group,
          host: h.host,
          port: h.port,
          username: h.username,
          auth: keyId
            ? { type: 'privateKey', keyId }
            : { type: 'password', password: '' },
        });
      }
      if (newHosts.length) {
        await saveHosts([...hosts, ...newHosts]);
      }
      return {
        hosts: newHosts.length,
        duplicates: data.hosts.length - newHosts.length,
        keys: newKeys.length,
        incomplete: noCreds,
        notes: [...report, ...data.skipped],
      };
    },

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
