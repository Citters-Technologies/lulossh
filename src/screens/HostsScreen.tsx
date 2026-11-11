import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isIncomplete } from '../import/merge';
import { parseImport } from '../import/xshell';
import { Ssh } from '../native/SshModule';
import { buildTree, FolderNode, normPath, splitPath } from '../store/folders';
import { Host, hostLabel } from '../store/models';
import { Store } from '../store/useStore';
import { Button, colors, Field, Header, styles } from '../ui/kit';

const COLLAPSED_PREF = 'collapsedGroups';
const INDENT = 14;

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
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(
    null,
  );

  // Carpetas plegadas (por ruta), recordadas entre sesiones. No es sensible.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    Ssh.prefGet(COLLAPSED_PREF)
      .then(v => v && setCollapsed(new Set(JSON.parse(v))))
      .catch(() => {});
  }, []);
  const toggleFolder = (path: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (!next.delete(path)) {
        next.add(path);
      }
      Ssh.prefSet(COLLAPSED_PREF, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  // Al buscar se despliega todo, para no esconder resultados.
  const isCollapsed = (path: string) => !q.trim() && collapsed.has(path);

  const confirmUpdates = (
    updates: { name: string; changes: string[] }[],
  ): Promise<boolean> =>
    new Promise(resolve => {
      const list = updates
        .slice(0, 10)
        .map(u => `• ${u.name}: ${u.changes.join(', ')}`)
        .join('\n');
      const more = updates.length > 10 ? `\n… y ${updates.length - 10} más` : '';
      Alert.alert(
        'Completar hosts existentes',
        `${updates.length} hosts que ya tenías están incompletos y la importación trae lo que les falta:\n\n${list}${more}\n\n¿Actualizarlos?`,
        [
          { text: 'No', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Actualizar', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });

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
      const r = await store.importBatch(parsed, confirmUpdates);
      const lines = [
        `${r.hosts} hosts nuevos, ${r.keys} claves nuevas.`,
        r.updated ? `${r.updated} hosts completados.` : '',
        r.duplicates ? `${r.duplicates} hosts ya existían.` : '',
        r.incomplete
          ? `${r.incomplete} hosts siguen sin usuario o credenciales (⚠): al tocarlos se abre el editor. Importa sus claves desde Claves o vuelve a importar con los .pem.`
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

  const tree = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = store.hosts.filter(
      h =>
        !needle ||
        h.name.toLowerCase().includes(needle) ||
        hostLabel(h).toLowerCase().includes(needle) ||
        (h.group ?? '').toLowerCase().includes(needle),
    );
    // Dentro de cada carpeta, los usados más recientemente primero.
    return buildTree(list, (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  }, [store.hosts, q]);

  const saveRename = async () => {
    if (!renaming) {
      return;
    }
    const to = normPath(renaming.to) ?? '';
    try {
      await store.renameFolder(renaming.from, to);
      setRenaming(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? String(e));
    }
  };

  const renderHost = (h: Host, depth: number) => {
    const incomplete = isIncomplete(h, store.keys);
    return (
      <Pressable
        key={h.id}
        onPress={() => onConnect(h)}
        onLongPress={() => onEdit(h)}
        style={({ pressed }) => [
          styles.row,
          { marginLeft: depth * INDENT },
          pressed && local.dim,
        ]}
      >
        <Text style={styles.rowTitle}>
          {incomplete ? '⚠ ' : ''}
          {h.name || h.host}
        </Text>
        <Text style={styles.rowSub}>
          {hostLabel(h)} ·{' '}
          {incomplete
            ? 'faltan credenciales'
            : h.auth.type === 'password'
            ? 'contraseña'
            : 'clave'}
        </Text>
      </Pressable>
    );
  };

  const renderFolder = (f: FolderNode, depth: number): React.ReactNode => {
    const closed = isCollapsed(f.path);
    return (
      <View key={f.path}>
        <Pressable
          onPress={() => toggleFolder(f.path)}
          onLongPress={() => setRenaming({ from: f.path, to: f.path })}
          hitSlop={4}
          style={({ pressed }) => [
            local.folder,
            { marginLeft: depth * INDENT },
            pressed && local.dim,
          ]}
        >
          <Text style={local.chevron}>{closed ? '▸' : '▾'}</Text>
          <Text style={local.folderName} numberOfLines={1}>
            📁 {f.name}
          </Text>
          <Text style={local.count}>{f.count}</Text>
        </Pressable>
        {!closed && renderChildren(f, depth + 1)}
      </View>
    );
  };

  const renderChildren = (n: FolderNode, depth: number) => (
    <>
      {n.folders.map(f => renderFolder(f, depth))}
      {n.hosts.map(h => renderHost(h, depth))}
    </>
  );

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
            placeholder="nombre, usuario, host o carpeta"
          />
        )}
        {store.loaded && store.hosts.length === 0 && (
          <Text style={styles.empty}>
            Aún no hay hosts. Pulsa “+ Host” para añadir el primero.
          </Text>
        )}
        {renderChildren(tree, 0)}
        {store.hosts.length > 0 && (
          <Text style={styles.empty}>
            Mantén pulsado un host para editarlo, o una carpeta para
            renombrarla o moverla.
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

      <Modal
        visible={!!renaming}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={local.backdrop}>
          <View style={local.dialog}>
            <Text style={styles.rowTitle}>Renombrar o mover carpeta</Text>
            <Text style={styles.rowSub}>
              Usa “/” para anidar: Clientes/Acme. Se mueve con todo lo que
              contiene ({splitPath(renaming?.from).join(' › ')}).
            </Text>
            <Field
              label="Ruta"
              value={renaming?.to ?? ''}
              onChangeText={to => setRenaming(r => (r ? { ...r, to } : r))}
              autoFocus
            />
            <Button title="Guardar" onPress={saveRename} />
            <Button
              title="Cancelar"
              kind="secondary"
              onPress={() => setRenaming(null)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  folder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  chevron: { color: colors.muted, width: 14 },
  folderName: { flex: 1, color: colors.text, fontWeight: '600' },
  count: { color: colors.muted },
  dim: { opacity: 0.6 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
});
