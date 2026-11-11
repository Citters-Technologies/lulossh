/**
 * Importación desde Xshell (NetSarang).
 *
 * - Sesiones: ficheros .xsh (INI, normalmente UTF-16LE), sueltos o dentro de
 *   un .xts (export de Xshell) / .zip de la carpeta Sessions. Las carpetas
 *   se convierten en grupos.
 * - Claves: Xshell las guarda en un formato propio; hay que exportarlas desde
 *   su gestor de claves (formato PEM/OpenSSH). Se asocian por nombre con el
 *   campo UserKey de cada sesión.
 * - Las contraseñas no se importan: Xshell las cifra con datos de la cuenta
 *   de Windows.
 */

import type { ImportEntry } from '../native/SshModule';

export interface ImportedHost {
  name: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  /** Nombre de la clave en Xshell (UserKey), si la sesión usa clave. */
  keyName?: string;
}

export interface ImportedKey {
  name: string;
  pem: string;
}

export interface ImportResult {
  hosts: ImportedHost[];
  keys: ImportedKey[];
  /** Ficheros ignorados y por qué (para el resumen). */
  skipped: string[];
}

type Ini = Record<string, Record<string, string>>;

export function parseIni(text: string): Ini {
  const out: Ini = {};
  let section = '';
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim().toUpperCase();
      out[section] = out[section] ?? {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) {
      (out[section] = out[section] ?? {})[line.slice(0, eq).trim()] = line
        .slice(eq + 1)
        .trim();
    }
  }
  return out;
}

const baseName = (path: string) => path.split('/').pop() ?? path;
const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

/** Carpetas de la ruta como grupo, sin el prefijo hasta "Sessions/". */
export function groupFromPath(path: string): string | undefined {
  let parts = path.split('/').filter(Boolean);
  const s = parts.findIndex(p => p.toLowerCase() === 'sessions');
  if (s >= 0) {
    parts = parts.slice(s + 1);
  }
  const dirs = parts.slice(0, -1);
  return dirs.length ? dirs.join('/') : undefined;
}

/** Sesión .xsh -> host, o un motivo para ignorarla. */
export function parseXsh(path: string, text: string): ImportedHost | string {
  const ini = parseIni(text);
  const conn = ini.CONNECTION ?? {};
  const auth = ini['CONNECTION:AUTHENTICATION'] ?? {};
  const protocol = (conn.Protocol ?? 'SSH').toUpperCase();
  if (protocol !== 'SSH') {
    return `protocolo ${protocol} no soportado`;
  }
  const host = (conn.Host ?? '').trim();
  if (!host) {
    return 'sin host';
  }
  const port = parseInt(conn.Port ?? '22', 10);
  // Method: 0 contraseña, 1 clave pública, 2 keyboard-interactive…
  const keyName = (auth.UserKey ?? '').trim();
  const usesKey =
    keyName !== '' && (auth.Method === undefined || auth.Method === '1');
  return {
    name: stripExt(baseName(path)),
    group: groupFromPath(path),
    host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 22,
    username: (auth.UserName ?? '').trim(),
    keyName: usesKey ? keyName : undefined,
  };
}

const PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|^PuTTY-User-Key-File-\d+:/m;

/** Texto de una clave privada OpenSSH, PEM o PuTTY (.ppk). */
export const isPrivateKeyText = (text: string) => PRIVATE_KEY.test(text);

export function parseImport(entries: ImportEntry[]): ImportResult {
  const result: ImportResult = { hosts: [], keys: [], skipped: [] };
  for (const e of entries) {
    const name = baseName(e.path);
    if (/\.xsh$/i.test(name)) {
      const h = parseXsh(e.path, e.text);
      if (typeof h === 'string') {
        result.skipped.push(`${name}: ${h}`);
      } else {
        result.hosts.push(h);
      }
    } else if (PRIVATE_KEY.test(e.text)) {
      result.keys.push({ name: stripExt(name), pem: e.text });
    } else if (!/\.(pub|ini|xfp|xcs|xkm|xtm)$/i.test(name)) {
      result.skipped.push(`${name}: formato no reconocido`);
    }
  }
  return result;
}
