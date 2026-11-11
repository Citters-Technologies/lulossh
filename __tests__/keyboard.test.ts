import {
  applyCtrl,
  DEFAULT_LAYOUT,
  resolveAction,
} from '../src/keyboard/model';

test('las filas de cada capa tienen el mismo nº de teclas (columnas alineadas)', () => {
  Object.values(DEFAULT_LAYOUT.layers).forEach(layer => {
    const widths = layer.rows.map(r => r.length);
    expect(new Set(widths).size).toBe(1);
  });
});

test('flechas en T invertida: ↑ justo encima de ↓', () => {
  const [top, bottom] = DEFAULT_LAYOUT.layers.main.rows;
  const up = top.findIndex(b => b.id === 'up');
  expect(bottom[up].id).toBe('down');
  expect(bottom[up - 1].id).toBe('left');
  expect(bottom[up + 1].id).toBe('right');
});

test('ids de tecla únicos', () => {
  const ids = Object.values(DEFAULT_LAYOUT.layers).flatMap(l =>
    l.rows.flat().map(b => b.id),
  );
  expect(new Set(ids).size).toBe(ids.length);
});

const none = { ctrl: false, alt: false, shift: false };

test('Ctrl+C produce ETX', () => {
  expect(applyCtrl('c')).toBe('\x03');
  expect(
    resolveAction({ kind: 'text', text: 'c' }, { ...none, ctrl: true }),
  ).toBe('\x03');
});

test('Alt antepone ESC', () => {
  expect(
    resolveAction({ kind: 'text', text: 'b' }, { ...none, alt: true }),
  ).toBe('\x1bb');
});

test('Shift+Tab envía CSI Z', () => {
  expect(
    resolveAction({ kind: 'key', key: 'tab' }, { ...none, shift: true }),
  ).toBe('\x1b[Z');
});

test('flechas', () => {
  expect(resolveAction({ kind: 'key', key: 'up' }, none)).toBe('\x1b[A');
});
