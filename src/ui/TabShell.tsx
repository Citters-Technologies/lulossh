import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from './kit';

export type Tab = 'hosts' | 'sessions' | 'identities' | 'keys';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'hosts', label: 'Hosts', icon: '🖥' },
  { id: 'sessions', label: 'Sesiones', icon: '⚡' },
  { id: 'identities', label: 'Identidades', icon: '👤' },
  { id: 'keys', label: 'Claves', icon: '🔑' },
];

const indexOf = (t: Tab) => TABS.findIndex(x => x.id === t);

/** Cabecera de la app + menú de pestañas superior + páginas deslizables. */
export function TabShell({
  tab,
  onTab,
  onPeek,
  sessionsCount,
  action,
  onSettings,
  panes,
}: {
  tab: Tab;
  onTab(t: Tab): void;
  /** Se va a ver la pestaña `t` al arrastrar: montarla si aún no lo está. */
  onPeek?(t: Tab): void;
  sessionsCount: number;
  /** Acción principal de la pestaña (＋ Host, ＋ Identidad…). */
  action?: { label: string; onPress(): void };
  onSettings(): void;
  /** Contenido de cada pestaña (null si aún no se ha montado). */
  panes: Partial<Record<Tab, React.ReactNode>>;
}) {
  // Las pestañas van en fila y la fila sigue al dedo. Solo se reclama el
  // gesto si es claramente horizontal, para no robar el scroll de las listas.
  const [width, setWidth] = useState(Dimensions.get('window').width);
  const x = useRef(new Animated.Value(-indexOf(tab) * width)).current;
  const cur = useRef({ tab, onTab, onPeek, width });
  cur.current = { tab, onTab, onPeek, width };

  const snapTo = (i: number) =>
    Animated.spring(x, {
      toValue: -i * cur.current.width,
      useNativeDriver: true,
      speed: 20,
      bounciness: 0,
    }).start();

  // Cambio de pestaña (por toque o al soltar): deslizar hasta ella.
  useEffect(() => {
    snapTo(indexOf(tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, width]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderGrant: () => {
          x.stopAnimation();
          const i = indexOf(cur.current.tab);
          for (const n of [TABS[i - 1], TABS[i + 1]]) {
            if (n) {
              cur.current.onPeek?.(n.id);
            }
          }
        },
        onPanResponderMove: (_e, g) => {
          const i = indexOf(cur.current.tab);
          const edge =
            (g.dx > 0 && i === 0) || (g.dx < 0 && i === TABS.length - 1);
          // En los extremos, resistencia (se mueve un tercio).
          x.setValue(-i * cur.current.width + (edge ? g.dx / 3 : g.dx));
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          const w = cur.current.width;
          const i = indexOf(cur.current.tab);
          const dir =
            g.dx < -w / 4 || g.vx < -0.4
              ? 1
              : g.dx > w / 4 || g.vx > 0.4
              ? -1
              : 0;
          const next = TABS[i + dir];
          if (dir && next) {
            cur.current.onTab(next.id); // el efecto anima hasta ella
          } else {
            snapTo(i);
          }
        },
        onPanResponderTerminate: () => snapTo(indexOf(cur.current.tab)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <SafeAreaView style={local.root} edges={['top', 'left', 'right']}>
      <View style={local.header}>
        <Text style={local.brand}>
          Lulo<Text style={local.brandAccent}>SSH</Text>
        </Text>
        {action && (
          <Pressable
            onPress={action.onPress}
            hitSlop={8}
            style={[local.headerBtn, local.primary]}
          >
            <Text style={[local.headerBtnText, local.primaryText]}>
              {action.label}
            </Text>
          </Pressable>
        )}
        {/* Siempre el último: no se mueve al cambiar de pestaña. */}
        <Pressable
          onPress={onSettings}
          hitSlop={8}
          style={[local.headerBtn, local.gear]}
          accessibilityLabel="Ajustes"
        >
          <Text style={local.gearText}>⚙️</Text>
        </Pressable>
      </View>
      <View style={local.tabs}>
        {TABS.map(t => {
          const on = t.id === tab;
          return (
            <Pressable
              key={t.id}
              onPress={() => onTab(t.id)}
              style={[local.tab, on && local.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={local.tabIcon}>{t.icon}</Text>
              <Text
                style={[local.tabLabel, on && local.tabLabelOn]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t.label}
              </Text>
              {t.id === 'sessions' && sessionsCount > 0 && (
                <View style={local.badge}>
                  <Text style={local.badgeText}>{sessionsCount}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View
        style={local.body}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
        {...swipe.panHandlers}
      >
        <Animated.View
          style={[
            local.row,
            { width: width * TABS.length, transform: [{ translateX: x }] },
          ]}
        >
          {TABS.map(t => (
            <View key={t.id} style={{ width }}>
              {panes[t.id] ?? null}
            </View>
          ))}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  brand: { flex: 1, color: '#fff', fontSize: 22, fontWeight: '800' },
  brandAccent: { color: '#9be22d' },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  headerBtnText: { color: colors.text, fontWeight: '600' },
  primary: { backgroundColor: colors.accent },
  gear: {
    width: 40,
    height: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  gearText: { fontSize: 20 },
  primaryText: { color: '#fff' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 10,
  },
  tabOn: { backgroundColor: colors.surface2 },
  tabIcon: { fontSize: 16 },
  tabLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  tabLabelOn: { color: '#fff' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#04210f', fontSize: 11, fontWeight: '800' },
  body: { flex: 1, overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row' },
});
