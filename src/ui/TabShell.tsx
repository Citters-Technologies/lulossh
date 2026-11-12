import React, { useMemo, useRef } from 'react';
import {
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

/** Cabecera de la app + menú de pestañas superior. */
export function TabShell({
  tab,
  onTab,
  sessionsCount,
  action,
  onSettings,
  children,
}: {
  tab: Tab;
  onTab(t: Tab): void;
  sessionsCount: number;
  /** Acción principal de la pestaña (＋ Host, ＋ Identidad…). */
  action?: { label: string; onPress(): void };
  onSettings(): void;
  children: React.ReactNode;
}) {
  // Deslizar a izquierda/derecha cambia de pestaña. Solo se reclama el gesto
  // si es claramente horizontal, para no robar el desplazamiento de listas.
  const cur = useRef({ tab, onTab });
  cur.current = { tab, onTab };
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_e, g) => {
          const dir =
            g.dx < -60 || g.vx < -0.5 ? 1 : g.dx > 60 || g.vx > 0.5 ? -1 : 0;
          if (!dir) {
            return;
          }
          const i = TABS.findIndex(t => t.id === cur.current.tab);
          const next = TABS[i + dir];
          if (next) {
            cur.current.onTab(next.id);
          }
        },
      }),
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
      <View style={local.body} {...swipe.panHandlers}>
        {children}
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
  tabLabel: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2 },
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
  body: { flex: 1 },
});
