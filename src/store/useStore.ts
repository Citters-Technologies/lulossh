import { useCallback, useEffect, useState } from 'react';
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
