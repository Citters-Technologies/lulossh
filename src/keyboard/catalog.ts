/**
 * Catálogo de teclas para el editor de la botonera, y utilidades para
 * guardar/cargar el layout del usuario.
 */
import { DEFAULT_LAYOUT, KeyAction, KeyButton, KeyboardLayout } from './model';

export interface CatalogKey {
  base: string; // prefijo del id
  label: string;
  action: KeyAction;
  repeat?: boolean;
  hint?: string;
}

const key = (
  base: string,
  label: string,
  action: KeyAction,
  repeat = false,
  hint?: string,
): CatalogKey => ({ base, label, action, repeat, hint });

const text = (t: string) => key(`t${t.charCodeAt(0)}`, t, { kind: 'text', text: t });
const macro = (base: string, label: string, sequence: string, hint?: string) =>
  key(base, label, { kind: 'macro', sequence }, false, hint);

export const CATALOG: { title: string; keys: CatalogKey[] }[] = [
  {
    title: 'Navegación',
    keys: [
      key('up', '↑', { kind: 'key', key: 'up' }, true),
      key('down', '↓', { kind: 'key', key: 'down' }, true),
      key('left', '←', { kind: 'key', key: 'left' }, true),
      key('right', '→', { kind: 'key', key: 'right' }, true),
      key('home', 'Home', { kind: 'key', key: 'home' }),
      key('end', 'End', { kind: 'key', key: 'end' }),
      key('pgup', 'PgUp', { kind: 'key', key: 'pageUp' }, true),
      key('pgdn', 'PgDn', { kind: 'key', key: 'pageDown' }, true),
    ],
  },
  {
    title: 'Control',
    keys: [
      key('esc', 'Esc', { kind: 'key', key: 'esc' }),
      key('tab', 'Tab', { kind: 'key', key: 'tab' }),
      key('enter', '⏎', { kind: 'key', key: 'enter' }),
      key('bksp', '⌫', { kind: 'key', key: 'backspace' }, true),
      key('del', 'Del', { kind: 'key', key: 'delete' }, true),
      key('ctrl', 'Ctrl', { kind: 'modifier', modifier: 'ctrl' }),
      key('alt', 'Alt', { kind: 'modifier', modifier: 'alt' }),
      key('shift', 'Shift', { kind: 'modifier', modifier: 'shift' }),
    ],
  },
  {
    title: 'Atajos',
    keys: [
      macro('su', '⚡su', 'sudo su\r', 'sudo su + Enter'),
      macro('sudo', 'sudo', 'sudo ', '“sudo ” sin Enter'),
      macro('ctrlc', '^C', '\x03', 'Interrumpir'),
      macro('ctrld', '^D', '\x04', 'Fin de entrada / salir'),
      macro('ctrlz', '^Z', '\x1a', 'Suspender'),
      macro('ctrll', '^L', '\x0c', 'Limpiar pantalla'),
      macro('ctrlr', '^R', '\x12', 'Buscar en el historial'),
      macro('ctrla', '^A', '\x01', 'Inicio de línea / prefijo screen'),
      macro('ctrlb', '^B', '\x02', 'Prefijo de tmux'),
      macro('stab', '⇧Tab', '\x1b[Z', 'Cambiar modo en Claude Code'),
      macro('escesc', 'Esc Esc', '\x1b\x1b', 'Volver atrás en Claude Code'),
      macro('yes', 'yes', 'yes\r'),
      macro('exit', 'exit', 'exit\r'),
    ],
  },
  {
    title: 'Capas',
    keys: [
      key('ai', 'IA', { kind: 'layer', layer: 'ai' }, false, 'Abre la capa de IA'),
      key('abc', 'ABC', { kind: 'layer', layer: 'main' }, false, 'Vuelve a la principal'),
    ],
  },
  {
    title: 'Símbolos',
    keys: '/-|~\\*&$;:"\'`<>{}[]()#!@%^=+_?'.split('').map(text),
  },
];

/** Interpreta \r \n \t \e \\ y \xHH en el texto de una tecla personalizada. */
export function parseEscapes(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[rnte\\])/g, (_m, e: string) => {
    switch (e[0]) {
      case 'r':
        return '\r';
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'e':
        return '\x1b';
      case '\\':
        return '\\';
      default:
        return String.fromCharCode(parseInt(e.slice(1), 16));
    }
  });
}

/** Inverso aproximado de parseEscapes, para editar una macro existente. */
export function showEscapes(s: string): string {
  return s.replace(/[\\\r\n\t\x1b]|[\x00-\x1f]/g, ch => {
    switch (ch) {
      case '\\':
        return '\\\\';
      case '\r':
        return '\\r';
      case '\n':
        return '\\n';
      case '\t':
        return '\\t';
      case '\x1b':
        return '\\e';
      default:
        return '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
    }
  });
}

/** Id único para una tecla nueva. */
export function uniqueId(layout: KeyboardLayout, base: string): string {
  const used = new Set(
    Object.values(layout.layers).flatMap(l => l.rows.flat().map(b => b.id)),
  );
  if (!used.has(base)) {
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) {
    n++;
  }
  return `${base}-${n}`;
}

export function toButton(layout: KeyboardLayout, c: CatalogKey): KeyButton {
  return {
    id: uniqueId(layout, c.base),
    label: c.label,
    action: c.action,
    repeat: c.repeat,
  };
}

const isAction = (a: any): a is KeyAction =>
  a &&
  ((a.kind === 'key' && typeof a.key === 'string') ||
    (a.kind === 'text' && typeof a.text === 'string') ||
    (a.kind === 'macro' && typeof a.sequence === 'string') ||
    (a.kind === 'modifier' && ['ctrl', 'alt', 'shift'].includes(a.modifier)) ||
    (a.kind === 'layer' && typeof a.layer === 'string'));

/** Valida un layout guardado; si está corrupto, vuelve al de serie. */
export function parseLayout(json: string | null): KeyboardLayout {
  if (!json) {
    return DEFAULT_LAYOUT;
  }
  try {
    const l = JSON.parse(json);
    const ok =
      l &&
      typeof l.defaultLayer === 'string' &&
      l.layers?.[l.defaultLayer] &&
      Object.values(l.layers).every(
        (layer: any) =>
          Array.isArray(layer.rows) &&
          layer.rows.every(
            (r: any) =>
              Array.isArray(r) &&
              r.every(
                (b: any) =>
                  typeof b.id === 'string' &&
                  typeof b.label === 'string' &&
                  isAction(b.action),
              ),
          ),
      );
    return ok ? (l as KeyboardLayout) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export const LAYOUT_PREF = 'keyboardLayout';
