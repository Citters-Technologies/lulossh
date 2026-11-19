import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiveSession } from '../native/SshModule';
import { colors } from './kit';
import { Text } from './Text';

/**
 * Diseño de dos paneles (lista a la izquierda, terminal a la derecha) solo en
 * tablets: pantalla ancha y lado corto de tablet, para que un móvil en
 * horizontal siga con una sola columna.
 */
export function useSplitLayout(): boolean {
  const { width, height } = useWindowDimensions();
  return width >= 820 && Math.min(width, height) >= 600;
}

/** Ancho del panel izquierdo (hosts, sesiones, identidades, claves). */
export const SIDE_WIDTH = 380;

/** Pestañas con las sesiones abiertas, encima de la terminal. */
export function SessionTabs({
  live,
  current,
  currentTitle,
  onOpen,
  sideHidden,
  onToggleSide,
}: {
  live: LiveSession[];
  current: string;
  /** Título de la sesión actual si aún no aparece en `live` (conectando). */
  currentTitle: string;
  onOpen(s: LiveSession): void;
  /** Panel lateral oculto: la terminal ocupa toda la pantalla. */
  sideHidden: boolean;
  onToggleSide(): void;
}) {
  const tabs = live.some(s => s.sessionId === current)
    ? live
    : [
        ...live,
        { sessionId: current, hostId: null, title: currentTitle, startedAt: 0 },
      ];
  return (
    <SafeAreaView
      edges={sideHidden ? ['top', 'left', 'right'] : ['top', 'right']}
      style={[local.bar, local.barRow]}
    >
      <Pressable
        onPress={onToggleSide}
        hitSlop={8}
        style={({ pressed }) => [local.sideBtn, pressed && local.pressed]}
        accessibilityLabel={
          sideHidden ? 'Mostrar la lista' : 'Ocultar la lista'
        }
      >
        <Text style={local.sideBtnText}>{sideHidden ? '☰' : '⟨'}</Text>
      </Pressable>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={local.row}
      >
        {tabs.map(s => {
          const on = s.sessionId === current;
          return (
            <Pressable
              key={s.sessionId}
              onPress={() => !on && onOpen(s)}
              style={({ pressed }) => [
                local.tab,
                on && local.tabOn,
                pressed && local.pressed,
              ]}
            >
              <View style={[local.dot, on && local.dotOn]} />
              <Text
                style={[local.tabText, on && local.tabTextOn]}
                numberOfLines={1}
              >
                {s.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Panel derecho sin sesión abierta. */
export function EmptyPane({ sessions }: { sessions: number }) {
  return (
    <SafeAreaView edges={['top', 'right', 'bottom']} style={local.empty}>
      <Image
        source={require('../../assets/logo/lulossh-icon.png')}
        style={local.logo}
      />
      <Text style={local.emptyTitle}>Elige un host para conectar</Text>
      <Text style={local.emptySub}>
        {sessions
          ? `Tienes ${
              sessions === 1
                ? '1 sesión abierta'
                : `${sessions} sesiones abiertas`
            }: ábrela desde Sesiones o desde la lista.`
          : 'La terminal se abrirá aquí, junto a la lista.'}
      </Text>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surface2,
  },
  barRow: { flexDirection: 'row', alignItems: 'center' },
  row: { paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  sideBtn: {
    marginLeft: 8,
    width: 36,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  sideBtnText: { color: colors.strong, fontSize: 18, fontWeight: '700' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 240,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  tabOn: { backgroundColor: colors.surface2 },
  pressed: { opacity: 0.7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
  dotOn: { backgroundColor: colors.brand },
  tabText: { color: colors.muted, fontSize: 14, flexShrink: 1 },
  tabTextOn: { color: colors.strong, fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
    backgroundColor: colors.bg,
  },
  logo: { width: 88, height: 88, marginBottom: 8, opacity: 0.9 },
  emptyTitle: { color: colors.strong, fontSize: 20, fontWeight: '700' },
  emptySub: { color: colors.muted, textAlign: 'center', maxWidth: 420 },
});
