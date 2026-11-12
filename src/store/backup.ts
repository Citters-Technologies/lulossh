/**
 * Copia de seguridad: qué se exporta y cómo se fusiona al restaurar.
 * El cifrado (scrypt + AES-256-GCM con la contraseña del usuario) se hace en
 * nativo, que además añade las claves privadas del vault.
 */
import { LAYOUT_PREF } from '../keyboard/catalog';
import { Ssh } from '../native/SshModule';
import type { Host, Identity, SshKey } from './models';

/** Preferencias no sensibles que también viajan en la copia. */
export const BACKUP_PREFS = [
  LAYOUT_PREF,
  'collapsedGroups',
  'hostOrder',
  'terminalFontSize',
  'terminalTheme',
  'terminalFont',
  'appLock',
  'appLockAfter',
];

export interface BackupMeta {
  app: 'LuloSSH';
  version: 1;
  hosts: Host[];
  identities: Identity[];
  keys: SshKey[];
  prefs: Record<string, string>;
}

export interface BackupPayload {
  exportedAt: number;
  meta: BackupMeta;
  secrets: Record<string, { pem: string; passphrase?: string }>;
}

export async function buildMeta(data: {
  hosts: Host[];
  identities: Identity[];
  keys: SshKey[];
}): Promise<BackupMeta> {
  const prefs: Record<string, string> = {};
  for (const p of BACKUP_PREFS) {
    const v = await Ssh.prefGet(p).catch(() => null);
    if (v != null) {
      prefs[p] = v;
    }
  }
  return { app: 'LuloSSH', version: 1, ...data, prefs };
}

export function parsePayload(json: string): BackupPayload {
  const p = JSON.parse(json);
  if (p?.meta?.app !== 'LuloSSH' || !Array.isArray(p.meta.hosts)) {
    throw new Error('El fichero no contiene una copia de LuloSSH válida');
  }
  return {
    exportedAt: Number(p.exportedAt) || 0,
    meta: {
      app: 'LuloSSH',
      version: 1,
      hosts: p.meta.hosts ?? [],
      identities: p.meta.identities ?? [],
      keys: p.meta.keys ?? [],
      prefs: p.meta.prefs ?? {},
    },
    secrets: p.secrets ?? {},
  };
}

/** Añade lo que no exista (por id); lo que ya existe se conserva tal cual. */
export function mergeById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
): { merged: T[]; added: number } {
  const have = new Set(existing.map(x => x.id));
  const fresh = incoming.filter(x => x?.id && !have.has(x.id));
  return { merged: [...existing, ...fresh], added: fresh.length };
}

export const backupFileName = (d = new Date()) =>
  `lulossh-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate(),
  ).padStart(2, '0')}.lulossh`;
