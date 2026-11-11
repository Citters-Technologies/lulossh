/**
 * Cruce de una importación con los hosts existentes: qué es nuevo, qué está
 * repetido y qué hosts existentes están incompletos y se pueden completar
 * con los datos nuevos (clave que antes faltaba, usuario, carpeta…).
 */
import { normPath } from '../store/folders';
import type { Host, SshKey } from '../store/models';
import type { ImportedHost } from './xshell';

/** Host sin usuario, sin contraseña o con una clave que ya no existe. */
export function isIncomplete(h: Host, keys: Pick<SshKey, 'id'>[]): boolean {
  if (!h.username.trim()) {
    return true;
  }
  if (h.auth.type === 'password') {
    return !h.auth.password;
  }
  return !keys.some(k => k.id === (h.auth as { keyId: string }).keyId);
}

export interface HostUpdate {
  id: string;
  name: string;
  patch: Partial<Host>;
  /** Qué se completa, para enseñarlo al usuario. */
  changes: string[];
}

export interface ImportPlan {
  toAdd: Host[];
  toUpdate: HostUpdate[];
  duplicates: number;
  notes: string[];
}

const target = (h: { host: string; port: number }) =>
  `${h.host.toLowerCase()}:${h.port}`;

export function planImport(
  existing: Host[],
  keys: SshKey[],
  imported: ImportedHost[],
  newId: () => string,
): ImportPlan {
  const keyByName = new Map(keys.map(k => [k.name.toLowerCase(), k.id]));
  const plan: ImportPlan = { toAdd: [], toUpdate: [], duplicates: 0, notes: [] };
  const claimed = new Set<string>();

  for (const h of imported) {
    const keyId = h.keyName
      ? keyByName.get(h.keyName.toLowerCase())
      : undefined;
    if (h.keyName && !keyId) {
      plan.notes.push(`${h.name}: falta la clave "${h.keyName}"`);
    }
    const group = normPath(h.group);

    // Mismo destino y (mismo usuario, o mismo nombre si a uno le falta el
    // usuario, o cualquiera si la importación no trae usuario, p. ej. JuiceSSH).
    const match = existing.find(
      e =>
        !claimed.has(e.id) &&
        target(e) === target(h) &&
        (e.username.toLowerCase() === h.username.toLowerCase() ||
          !h.username ||
          (!e.username && e.name.toLowerCase() === h.name.toLowerCase())),
    );

    if (!match) {
      plan.toAdd.push({
        id: newId(),
        name: h.name,
        group,
        host: h.host,
        port: h.port,
        username: h.username,
        importedKeyName: h.keyName,
        auth: keyId
          ? { type: 'privateKey', keyId }
          : { type: 'password', password: '' },
      });
      continue;
    }

    claimed.add(match.id);
    const patch: Partial<Host> = {};
    const changes: string[] = [];
    if (isIncomplete(match, keys) && keyId) {
      patch.auth = { type: 'privateKey', keyId };
      changes.push(`clave ${h.keyName}`);
    }
    if (!match.username && h.username) {
      patch.username = h.username;
      changes.push(`usuario ${h.username}`);
    }
    if (!normPath(match.group) && group) {
      patch.group = group;
      changes.push(`carpeta ${group}`);
    }
    if (h.keyName && !match.importedKeyName) {
      patch.importedKeyName = h.keyName; // para enlazarla si se importa luego
    }
    if (changes.length) {
      plan.toUpdate.push({ id: match.id, name: match.name, patch, changes });
    } else {
      if (Object.keys(patch).length) {
        plan.toUpdate.push({ id: match.id, name: match.name, patch, changes });
      }
      plan.duplicates++;
    }
  }
  return plan;
}

/** Hosts incompletos que esperaban una clave con este nombre. */
export function hostsWaitingForKey(
  hosts: Host[],
  keys: SshKey[],
  keyName: string,
): Host[] {
  const n = keyName.toLowerCase();
  return hosts.filter(
    h => h.importedKeyName?.toLowerCase() === n && isIncomplete(h, keys),
  );
}
