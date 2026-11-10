/**
 * Modelo de teclado de consola basado en datos (layouts -> capas -> teclas).
 * Diseño propio, inspirado en la idea de barras de teclas editables.
 */

export type Modifier = 'ctrl' | 'alt' | 'shift';

export type KeyAction =
  | {kind: 'key'; key: NamedKey}
  | {kind: 'text'; text: string}
  | {kind: 'modifier'; modifier: Modifier}
  | {kind: 'macro'; sequence: string} // texto o secuencias crudas, puede incluir \r
  | {kind: 'layer'; layer: string};

export type NamedKey =
  | 'esc'
  | 'tab'
  | 'enter'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'pageUp'
  | 'pageDown';

export interface KeyButton {
  id: string;
  label: string;
  action: KeyAction;
  /** Repetir al mantener pulsado (flechas, backspace). */
  repeat?: boolean;
}

export interface KeyLayer {
  name: string;
  rows: KeyButton[][];
}

export interface KeyboardLayout {
  id: string;
  name: string;
  layers: Record<string, KeyLayer>;
  defaultLayer: string;
}

const ESC = '\x1b';

const NAMED: Record<NamedKey, string> = {
  esc: ESC,
  tab: '\t',
  enter: '\r',
  backspace: '\x7f',
  delete: `${ESC}[3~`,
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  right: `${ESC}[C`,
  left: `${ESC}[D`,
  home: `${ESC}[H`,
  end: `${ESC}[F`,
  pageUp: `${ESC}[5~`,
  pageDown: `${ESC}[6~`,
};

/** Ctrl+<letra> => byte de control. Devuelve null si no aplica. */
export function applyCtrl(ch: string): string | null {
  if (ch.length !== 1) {
    return null;
  }
  const c = ch.toUpperCase().charCodeAt(0);
  if (c >= 0x40 && c <= 0x5f) {
    return String.fromCharCode(c - 0x40); // @A-Z[\]^_
  }
  if (ch === ' ') {
    return '\x00';
  }
  if (ch === '?') {
    return '\x7f';
  }
  return null;
}

export interface ModifierState {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * Convierte una acción a los bytes que se envían al PTY, aplicando los
 * modificadores pendientes (Ctrl/Alt "pegajosos" para un toque).
 */
export function resolveAction(
  action: KeyAction,
  mods: ModifierState,
): string | null {
  switch (action.kind) {
    case 'key': {
      if (action.key === 'tab' && mods.shift) {
        return `${ESC}[Z`; // Shift+Tab, p. ej. cambiar modo en Claude Code
      }
      const seq = NAMED[action.key];
      return mods.alt ? ESC + seq : seq;
    }
    case 'text': {
      let out = action.text;
      if (mods.ctrl) {
        out = applyCtrl(out) ?? out;
      }
      return mods.alt ? ESC + out : out;
    }
    case 'macro':
      return action.sequence;
    default:
      return null; // modifier / layer los gestiona la UI
  }
}

const k = (
  id: string,
  label: string,
  action: KeyAction,
  repeat = false,
): KeyButton => ({id, label, action, repeat});

export const DEFAULT_LAYOUT: KeyboardLayout = {
  id: 'default',
  name: 'Consola',
  defaultLayer: 'main',
  layers: {
    main: {
      name: 'Principal',
      rows: [
        [
          k('esc', 'Esc', {kind: 'key', key: 'esc'}),
          k('tab', 'Tab', {kind: 'key', key: 'tab'}),
          k('ctrl', 'Ctrl', {kind: 'modifier', modifier: 'ctrl'}),
          k('alt', 'Alt', {kind: 'modifier', modifier: 'alt'}),
          k('shift', 'Shift', {kind: 'modifier', modifier: 'shift'}),
          k('up', '↑', {kind: 'key', key: 'up'}, true),
          k('down', '↓', {kind: 'key', key: 'down'}, true),
          k('left', '←', {kind: 'key', key: 'left'}, true),
          k('right', '→', {kind: 'key', key: 'right'}, true),
          k('ai', 'IA', {kind: 'layer', layer: 'ai'}),
        ],
        [
          k('pipe', '|', {kind: 'text', text: '|'}),
          k('tilde', '~', {kind: 'text', text: '~'}),
          k('slash', '/', {kind: 'text', text: '/'}),
          k('dash', '-', {kind: 'text', text: '-'}),
          k('under', '_', {kind: 'text', text: '_'}),
          k('bslash', '\\', {kind: 'text', text: '\\'}),
          k('home', 'Home', {kind: 'key', key: 'home'}),
          k('end', 'End', {kind: 'key', key: 'end'}),
          k('pgup', 'PgUp', {kind: 'key', key: 'pageUp'}),
          k('pgdn', 'PgDn', {kind: 'key', key: 'pageDown'}),
        ],
      ],
    },
    /** Capa pensada para CLIs de IA (Claude Code y similares). */
    ai: {
      name: 'IA',
      rows: [
        [
          k('ai-back', '←', {kind: 'layer', layer: 'main'}),
          k('ai-esc', 'Esc', {kind: 'key', key: 'esc'}),
          k('ai-esc2', 'Esc Esc', {kind: 'macro', sequence: `${ESC}${ESC}`}),
          k('ai-stab', '⇧Tab', {kind: 'macro', sequence: `${ESC}[Z`}),
          k('ai-c', '^C', {kind: 'macro', sequence: '\x03'}),
          k('ai-d', '^D', {kind: 'macro', sequence: '\x04'}),
          k('ai-r', '^R', {kind: 'macro', sequence: '\x12'}),
          k('ai-enter', '⏎', {kind: 'key', key: 'enter'}),
        ],
        [
          k('ai-slash', '/', {kind: 'text', text: '/'}),
          k('ai-at', '@', {kind: 'text', text: '@'}),
          k('ai-hash', '#', {kind: 'text', text: '#'}),
          k('ai-bang', '!', {kind: 'text', text: '!'}),
          k('ai-yes', 'yes', {kind: 'macro', sequence: 'yes\r'}),
          k('ai-1', '1', {kind: 'macro', sequence: '1'}),
          k('ai-2', '2', {kind: 'macro', sequence: '2'}),
          k('ai-3', '3', {kind: 'macro', sequence: '3'}),
        ],
      ],
    },
  },
};
