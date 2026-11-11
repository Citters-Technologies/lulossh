import {
  CATALOG,
  parseEscapes,
  parseLayout,
  showEscapes,
  toButton,
} from '../src/keyboard/catalog';
import { DEFAULT_LAYOUT } from '../src/keyboard/model';

test('la botonera de serie trae sudo su y ya no PgUp/PgDn', () => {
  const ids = DEFAULT_LAYOUT.layers.main.rows.flat().map(b => b.id);
  expect(ids).toContain('su');
  expect(ids).not.toContain('pgup');
  expect(ids).not.toContain('pgdn');
  const su = DEFAULT_LAYOUT.layers.main.rows.flat().find(b => b.id === 'su');
  expect(su?.action).toEqual({ kind: 'macro', sequence: 'sudo su\r' });
});

test('escapes de teclas personalizadas, ida y vuelta', () => {
  expect(parseEscapes('sudo su\\r')).toBe('sudo su\r');
  expect(parseEscapes('\\e[A\\x03\\\\')).toBe('\x1b[A\x03\\');
  const raw = 'git status\r\x1b\x03\\';
  expect(parseEscapes(showEscapes(raw))).toBe(raw);
});

test('ids únicos al añadir teclas repetidas', () => {
  const su = CATALOG.flatMap(s => s.keys).find(k => k.base === 'su')!;
  expect(toButton(DEFAULT_LAYOUT, su).id).toBe('su-2');
});

test('un layout guardado corrupto vuelve al de serie', () => {
  expect(parseLayout(null)).toBe(DEFAULT_LAYOUT);
  expect(parseLayout('{nope')).toBe(DEFAULT_LAYOUT);
  expect(
    parseLayout(JSON.stringify({ defaultLayer: 'main', layers: { main: { rows: [[{ id: 'x' }]] } } })),
  ).toBe(DEFAULT_LAYOUT);
  const good = JSON.stringify(DEFAULT_LAYOUT);
  expect(parseLayout(good)).toEqual(DEFAULT_LAYOUT);
});
