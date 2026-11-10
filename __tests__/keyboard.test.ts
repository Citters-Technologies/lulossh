import { applyCtrl, resolveAction } from '../src/keyboard/model';

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
