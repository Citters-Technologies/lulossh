import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HostUpdate,
  hostsWaitingForKey,
  isIncomplete,
  planImport,
} from '../import/merge';
import type { ImportResult } from '../import/xshell';
import { renameFolder } from './folders';
import { Ssh } from '../native/SshModule';
import { Host, Identity, resolveHost, SshKey } from './models';
import { newId, readJson, withUnlock, writeJson } from './vault';

const HOSTS = 'hosts';
const KEYS = 'keys';
const IDENTITIES = 'identities';

/**
 * Estado de hosts y claves, persistido cifrado en el vault.
 * (Más adelante, la sync de Drive exportará estos mismos datos cifrados.)
 */
/** `enabled`: no leer el vault hasta que la app esté desbloqueada. */
export function useStore(enabled = true) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [h, k, i] = [
        await readJson<Host[]>(HOSTS, []),
        await readJson<SshKey[]>(KEYS, []),
        await readJson<Identity[]>(IDENTITIES, []),
      ];
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

  const saveHosts = async (next: Host[]) => {
    await writeJson(HOSTS, next);
    setHosts(next);
  };

  const saveKeys = async (next: SshKey[]) => {
    await writeJson(KEYS, next);
    setKeys(next);
  };

  const saveIdentities = async (next: Identity[]) => {
    await writeJson(IDENTITIES, next);
    setIdentities(next);
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
      const users = hosts.filter(h => h.identityId === id);
      if (users.length) {
        await saveHosts(
          hosts.map(h =>
            h.identityId === id ? { ...h, identityId: undefined } : h,
          ),
        );
      }
      await saveIdentities(identities.filter(i => i.id !== id));
    },

    /** Deja la identidad exactamente en estos hosts (quita del resto). */
    setIdentityHosts: (identityId: string, hostIds: string[]) =>
      saveHosts(
        hosts.map(h =>
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
        hosts.map(h =>
          hostIds.includes(h.id)
            ? { ...h, identityId: identityId ?? undefined }
            : h,
        ),
      ),
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

      const plan = planImport(hosts, allKeys, data.hosts, newId, identities);
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
        incomplete: next.filter(h => isIncomplete(h, allKeys, identities))
          .length,
        notes: [...report, ...plan.notes, ...data.skipped],
      };
    },

    /** Hosts importados que esperaban esta clave (por nombre). */
    hostsWaitingForKey: (key: SshKey) =>
      hostsWaitingForKey(hosts, keys, key.name, identities),

    /** Asigna una clave a varios hosts de una vez. */
    assignKey: (keyId: string, hostIds: string[]) =>
      saveHosts(
        hosts.map(h =>
          hostIds.includes(h.id)
            ? { ...h, auth: { type: 'privateKey', keyId }, identityId: undefined }
            : h,
        ),
      ),

    /** Mover/renombrar una carpeta con todo su contenido. */
    renameFolder: (from: string, to: string) =>
      saveHosts(renameFolder(hosts, from, to)),

    /** No se puede borrar una clave en uso por algún host o identidad. */
    deleteKey: async (id: string) => {
      const uses = (a: Host['auth']) =>
        a.type === 'privateKey' && a.keyId === id;
      const users = [
        ...hosts.filter(h => uses(h.auth)).map(h => h.name),
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
