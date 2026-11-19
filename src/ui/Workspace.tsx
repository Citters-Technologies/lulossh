import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Host } from '../store/models';
import { colors } from './kit';
import { Text } from './Text';
import { useKeyboardHeight } from './useKeyboardHeight';

/** Distribución de terminales en la tablet. */
export type PaneLayout = 'single' | 'cols' | 'rows' | 'grid';

export const PANE_LAYOUTS: { id: PaneLayout; glyph: string; label: string }[] =
  [
    { id: 'single', glyph: '▢', label: 'Una terminal' },
    { id: 'cols', glyph: '◫', label: 'Dos en columnas' },
    { id: 'rows', glyph: '⊟', label: 'Dos en filas' },
    { id: 'grid', glyph: '⊞', label: 'Cuatro en cuadrícula' },
  ];

export const MAX_PANES = 4;

export function paneCount(layout: PaneLayout): number {
  return layout === 'single' ? 1 : layout === 'grid' ? 4 : 2;
}

/** Sesión mostrada en un panel. */
export interface PaneSession {
  host: Host;
  sessionId: string;
  /** true: la sesión ya existe en segundo plano y se restaura. */
  resume: boolean;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GAP = 3;

function rects(layout: PaneLayout, w: number, h: number): Rect[] {
  const half = (n: number) => (n - GAP) / 2;
  switch (layout) {
    case 'single':
      return [{ left: 0, top: 0, width: w, height: h }];
    case 'cols':
      return [
        { left: 0, top: 0, width: half(w), height: h },
        { left: half(w) + GAP, top: 0, width: half(w), height: h },
      ];
    case 'rows':
      return [
        { left: 0, top: 0, width: w, height: half(h) },
        { left: 0, top: half(h) + GAP, width: w, height: half(h) },
      ];
    case 'grid':
      return [
        { left: 0, top: 0, width: half(w), height: half(h) },
        { left: half(w) + GAP, top: 0, width: half(w), height: half(h) },
        { left: 0, top: half(h) + GAP, width: half(w), height: half(h) },
        {
          left: half(w) + GAP,
          top: half(h) + GAP,
          width: half(w),
          height: half(h),
        },
      ];
  }
}

/**
 * Hasta 4 terminales en pantalla. Los paneles están siempre en la misma
 * posición del árbol (posicionados en absoluto), así que cambiar de
 * distribución no desmonta las terminales que siguen a la vista; las que no
 * caben se descargan y su sesión sigue viva para cuando vuelvan.
 */
export function Workspace({
  layout,
  panes,
  active,
  onActivate,
  renderPane,
}: {
  layout: PaneLayout;
  panes: (PaneSession | null)[];
  active: number;
  onActivate(i: number): void;
  renderPane(
    i: number,
    pane: PaneSession,
    isActive: boolean,
    visible: boolean,
  ): React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Con varias terminales, el hueco del teclado lo deja el conjunto (no cada
  // terminal, que encogería también las de arriba).
  const keyboardHeight = useKeyboardHeight();
  const count = paneCount(layout);
  const r = size.w ? rects(layout, size.w, size.h) : [];
  const multi = count > 1;
  return (
    <View
      style={[local.root, { paddingBottom: keyboardHeight }]}
      onLayout={e =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height - keyboardHeight,
        })
      }
    >
      {Array.from({ length: MAX_PANES }, (_, i) => {
        const visible = i < count && !!r[i];
        const pane = panes[i];
        const isActive = !multi || i === active;
        return (
          <View
            key={i}
            style={[
              local.pane,
              visible ? r[i] : local.hidden,
              multi && (isActive ? local.paneOn : local.paneOff),
            ]}
          >
            {pane ? (
              // Un panel que no cabe en la distribución no tiene terminal
              // cargada (ahorra memoria); su sesión sigue viva en nativo y
              // al volver se repinta desde el historial.
              visible ? (
                renderPane(i, pane, isActive, visible)
              ) : null
            ) : (
              <Pressable style={local.empty} onPress={() => onActivate(i)}>
                <Text style={local.emptyTitle}>Panel vacío</Text>
                <Text style={local.emptySub}>
                  {isActive
                    ? 'Elige un host en la lista o una sesión en las pestañas.'
                    : 'Tócalo para elegir qué mostrar aquí.'}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface2 },
  pane: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  paneOn: { borderColor: colors.brand },
  paneOff: { borderColor: 'transparent' },
  hidden: { display: 'none' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 6,
  },
  emptyTitle: { color: colors.strong, fontSize: 16, fontWeight: '700' },
  emptySub: { color: colors.muted, textAlign: 'center' },
});
