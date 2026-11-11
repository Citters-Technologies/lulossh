import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Host, hostLabel } from '../store/models';
import { Store } from '../store/useStore';
import { Button, Field, Header, styles } from '../ui/kit';

export function HostsScreen({
  store,
  onConnect,
  onEdit,
  onKeys,
}: {
  store: Store;
  onConnect(h: Host): void;
  onEdit(h?: Host): void;
  onKeys(): void;
}) {
  const [q, setQ] = useState('');

  // Agrupados por "group"; dentro, los usados más recientemente primero.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = store.hosts
      .filter(
        h =>
          !needle ||
          h.name.toLowerCase().includes(needle) ||
          hostLabel(h).toLowerCase().includes(needle),
      )
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    const map = new Map<string, Host[]>();
    list.forEach(h => {
      const g = h.group?.trim() || 'Sin grupo';
      map.set(g, [...(map.get(g) ?? []), h]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [store.hosts, q]);

  return (
    <SafeAreaView style={styles.screen}>
      <Header
        title="LuloSSH"
        left={{ label: 'Claves', onPress: onKeys }}
        right={{ label: '+ Host', onPress: () => onEdit() }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {store.error && (
          <View>
            <Text style={styles.error}>{store.error}</Text>
            <Button title="Desbloquear" onPress={store.reload} />
          </View>
        )}
        {store.hosts.length > 5 && (
          <Field
            label="Buscar"
            value={q}
            onChangeText={setQ}
            placeholder="nombre, usuario o host"
          />
        )}
        {store.loaded && store.hosts.length === 0 && (
          <Text style={styles.empty}>
            Aún no hay hosts. Pulsa “+ Host” para añadir el primero.
          </Text>
        )}
        {groups.map(([group, hosts]) => (
          <View key={group}>
            {groups.length > 1 && <Text style={styles.section}>{group}</Text>}
            {hosts.map(h => (
              <Pressable
                key={h.id}
                onPress={() => onConnect(h)}
                onLongPress={() => onEdit(h)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.rowTitle}>{h.name || h.host}</Text>
                <Text style={styles.rowSub}>
                  {hostLabel(h)} ·{' '}
                  {h.auth.type === 'password' ? 'contraseña' : 'clave'}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
        {store.hosts.length > 0 && (
          <Text style={styles.empty}>
            Mantén pulsado un host para editarlo.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
