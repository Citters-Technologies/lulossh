import type { Host } from './models';

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Orden alfabético natural: "web2" antes que "web10", sin distinguir acentos. */
export const byName = (a: Host, b: Host) =>
  collator.compare(a.name || a.host, b.name || b.host);

export const compareText = (a: string, b: string) => collator.compare(a, b);

export const favorites = (hosts: Host[]) =>
  hosts.filter(h => h.favorite).sort(byName);

/**
 * Los más usados que no son favoritos (para no repetirlos), por nº de
 * conexiones y, a igualdad, el más reciente.
 */
export const frequent = (hosts: Host[], limit = 5) =>
  hosts
    .filter(h => !h.favorite && (h.useCount ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.useCount ?? 0) - (a.useCount ?? 0) ||
        (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
    )
    .slice(0, limit);

/** Color estable por texto (avatar de cada host). */
const PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#ef4444',
  '#84cc16',
];
export function colorFor(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
