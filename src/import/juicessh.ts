/**
 * Importación desde JuiceSSH vía su API de plugins. Solo hay conexiones
 * (nombre, dirección, puerto, tipo) y grupos; los usuarios y credenciales
 * viven en "identidades", que la API no expone. Los hosts llegan sin usuario
 * y se completan al conectar (o reimportando desde Xshell).
 */
import type { JuiceData } from '../native/SshModule';
import type { ImportResult } from './xshell';

const TYPE_SSH = '0';
const TYPE_MOSH = '1'; // mosh arranca por SSH: se importa como SSH

export function parseJuice(data: JuiceData): ImportResult {
  const result: ImportResult = { hosts: [], keys: [], skipped: [] };
  const groupName = new Map(
    data.groups.filter(g => g.id && g.name).map(g => [g.id!, g.name!.trim()]),
  );
  // Una conexión puede estar en varios grupos: se usa el primero alfabético.
  const groupsOf = new Map<string, string[]>();
  for (const m of data.memberships) {
    const g = m.group_id && groupName.get(m.group_id);
    if (g && m.connection_id) {
      groupsOf.set(m.connection_id, [...(groupsOf.get(m.connection_id) ?? []), g]);
    }
  }

  for (const c of data.connections) {
    const label = (c.nickname || c.name || c.address || '').trim();
    const type = c.type ?? TYPE_SSH;
    if (type !== TYPE_SSH && type !== TYPE_MOSH) {
      result.skipped.push(`${label}: tipo no SSH`);
      continue;
    }
    let address = (c.address ?? '').trim();
    let username = '';
    const at = address.lastIndexOf('@');
    if (at > 0) {
      username = address.slice(0, at);
      address = address.slice(at + 1);
    }
    if (!address) {
      result.skipped.push(`${label || '(sin nombre)'}: sin dirección`);
      continue;
    }
    const port = parseInt(c.port ?? '22', 10);
    const groups = (c.id && groupsOf.get(c.id)) || [];
    groups.sort((a, b) => a.localeCompare(b));
    result.hosts.push({
      name: label || address,
      host: address,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 22,
      username,
      group: groups[0] ? `JuiceSSH/${groups[0]}` : 'JuiceSSH',
    });
  }
  return result;
}
