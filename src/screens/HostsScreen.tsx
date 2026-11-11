import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseImport } from '../import/xshell';
import { Ssh } from '../native/SshModule';
import { Host, hostLabel } from '../store/models';
import { Store } from '../store/useStore';
import { Button, Field, Header, styles } from '../ui/kit';

const COLLAPSED_PREF = 'collapsedGroups';

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
  const [busy, setBusy] = useState(false);

  // Grupos plegados, recordados entre sesiones (no es dato sensible).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    Ssh.prefGet(COLLAPSED_PREF)
      .then(v => v && setCollapsed(new Set(JSON.parse(v))))
      .catch(() => {});
  }, []);
  const toggleGroup = (g: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (!next.delete(g)) {
        next.add(g);
      }
      Ssh.prefSet(COLLAPSED_PREF, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  // Al buscar se muestra todo, para no esconder resultados.
  const isCollapsed = (g: string) => !q.trim() && collapsed.has(g);

  const importXshell = async () => {
    try {
      const entries = await Ssh.pickImportFiles();
      if (!entries.length) {
        return; // cancelado
      }
      setBusy(true);
      const parsed = parseImport(entries);
      if (!parsed.hosts.length && !parsed.keys.length) {
        Alert.alert(
          'Nada que importar',
          'Elige el .xts exportado desde Xshell (Archivo → Exportar), un .zip ' +
            'de la carpeta Sessions, ficheros .xsh o claves privadas .pem.',
        );
        return;
      }
      const r = await store.importBatch(parsed);
      const lines = [
        `${r.hosts} hosts nuevos, ${r.keys} claves nuevas.`,
        r.duplicates ? `${r.duplicates} hosts ya existían.` : '',
        r.incomplete
          ? `${r.incomplete} hosts sin usuario o credenciales: al tocarlos se abrirá el editor.`
          : '',
        ...r.notes.slice(0, 12),
        r.notes.length > 12 ? `… y ${r.notes.length - 12} avisos más` : '',
      ].filter(Boolean);
      Alert.alert('Importación de Xshell', lines.join('\n'));
    } catch (e: any) {
      Alert.alert('Error al importar', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

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
            {groups.length > 1 && (
              <Pressable
                onPress={() => toggleGroup(group)}
                hitSlop={6}
                style={local.sectionRow}
              >
                <Text style={[styles.section, local.chevron]}>
                  {isCollapsed(group) ? '▸' : '▾'}
                </Text>
                <Text style={[styles.section, local.sectionTitle]}>
                  {group}
                </Text>
                <Text style={[styles.section, local.count]}>
                  {hosts.length}
                </Text>
              </Pressable>
            )}
            {!(groups.length > 1 && isCollapsed(group)) &&
              hosts.map(h => (
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
        {store.loaded && (
          <Button
            title={busy ? 'Importando…' : 'Importar de Xshell'}
            kind="secondary"
            disabled={busy}
            onPress={importXshell}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chevron: { width: 14 },
  sectionTitle: { flex: 1 },
  count: { opacity: 0.6 },
});
