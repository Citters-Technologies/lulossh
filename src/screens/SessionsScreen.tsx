import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LiveSession } from '../native/SshModule';
import { Button, colors, styles } from '../ui/kit';

const since = (t: number) => {
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) {
    return 'hace un momento';
  }
  if (min < 60) {
    return `hace ${min} min`;
  }
  const h = Math.floor(min / 60);
  return `hace ${h} h ${min % 60} min`;
};

/** Gestión de las conexiones abiertas (siguen vivas en segundo plano). */
export function SessionsScreen({
  live,
  onResume,
  onDisconnect,
  onRefresh,
}: {
  live: LiveSession[];
  onResume(s: LiveSession): void;
  onDisconnect(s: LiveSession): Promise<unknown> | void;
  onRefresh(): void;
}) {
  const disconnectAll = () =>
    Alert.alert(
      'Desconectar todas',
      `¿Cerrar las ${live.length} sesiones abiertas?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar todas',
          style: 'destructive',
          onPress: async () => {
            for (const s of live) {
              await onDisconnect(s);
            }
            onRefresh();
          },
        },
      ],
    );

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {live.length === 0 ? (
        <View style={local.empty}>
          <Text style={local.emptyIcon}>🔌</Text>
          <Text style={local.emptyTitle}>Sin sesiones abiertas</Text>
          <Text style={styles.rowSub}>
            Las conexiones siguen vivas en segundo plano al salir de la
            terminal; aparecerán aquí y en la notificación.
          </Text>
        </View>
      ) : (
        <>
          {live.map(s => (
            <View key={s.sessionId} style={local.card}>
              <Pressable
                onPress={() => onResume(s)}
                style={({ pressed }) => [local.main, pressed && local.dim]}
              >
                <View style={local.dot} />
                <View style={local.flex}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {s.title}
                  </Text>
                  <Text style={styles.rowSub}>
                    Abierta {since(s.startedAt)}
                  </Text>
                </View>
                <Text style={local.open}>Abrir ›</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert('Desconectar', `¿Cerrar ${s.title}?`, [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Desconectar',
                      style: 'destructive',
                      onPress: async () => {
                        await onDisconnect(s);
                        onRefresh();
                      },
                    },
                  ])
                }
                style={local.close}
              >
                <Text style={local.closeText}>Desconectar</Text>
              </Pressable>
            </View>
          ))}
          {live.length > 1 && (
            <Button
              title="Desconectar todas"
              kind="danger"
              onPress={disconnectAll}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  flex: { flex: 1 },
  open: { color: colors.accent, fontWeight: '700' },
  close: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surface2,
    paddingVertical: 10,
    alignItems: 'center',
  },
  closeText: { color: colors.dangerText, fontWeight: '600' },
  dim: { opacity: 0.6 },
  empty: { alignItems: 'center', marginTop: 48, gap: 6, paddingHorizontal: 16 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { color: colors.strong, fontSize: 18, fontWeight: '700' },
});
