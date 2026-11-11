import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isIncomplete } from '../import/merge';
import { parseImport } from '../import/xshell';
import { LiveSession, Ssh } from '../native/SshModule';
import { buildTree, FolderNode, normPath, splitPath } from '../store/folders';
import { Host, hostLabel } from '../store/models';
import { byName, colorFor, favorites, frequent } from '../store/ranking';
import { Store } from '../store/useStore';
import { Button, colors, Field, styles } from '../ui/kit';

const COLLAPSED_PREF = 'collapsedGroups';
const INDENT = 16;

export function HostsScreen({
  store,
  live,
  onResume,
  onDisconnect,
  onConnect,
  onEdit,
  onKeys,
}: {
  store: Store;
  /** Sesiones abiertas en segundo plano. */
  live: LiveSession[];
  onResume(s: LiveSession): void;
  onDisconnect(s: LiveSession): void;
  onConnect(h: Host): void;
  onEdit(h?: Host): void;
  onKeys(): void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(
    null,
  );
  const searching = q.trim().length > 0;

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
  const isCollapsed = (path: string) => !searching && collapsed.has(path);

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return store.hosts.filter(
      h =>
        !needle ||
        h.name.toLowerCase().includes(needle) ||
        hostLabel(h).toLowerCase().includes(needle) ||
        (h.group ?? '').toLowerCase().includes(needle),
    );
  }, [store.hosts, q]);
  const tree = useMemo(() => buildTree(filtered, byName), [filtered]);
  const favs = useMemo(() => favorites(store.hosts), [store.hosts]);
  const freq = useMemo(() => frequent(store.hosts), [store.hosts]);
  const liveHosts = useMemo(
    () => new Set(live.map(s => s.hostId).filter(Boolean)),
    [live],
  );

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

  const toggleFavorite = (h: Host) =>
    store.patchHost(h.id, { favorite: !h.favorite }).catch(() => {});

  const renderHost = (h: Host, depth = 0, keyPrefix = '') => (
    <HostRow
      key={keyPrefix + h.id}
      host={h}
      depth={depth}
      incomplete={isIncomplete(h, store.keys)}
      live={liveHosts.has(h.id)}
      onPress={() => onConnect(h)}
      onLongPress={() => onEdit(h)}
      onStar={() => toggleFavorite(h)}
    />
  );

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
          <Text style={local.folderIcon}>{closed ? '📁' : '📂'}</Text>
          <Text style={local.folderName} numberOfLines={1}>
            {f.name}
          </Text>
          <View style={local.badge}>
            <Text style={local.badgeText}>{f.count}</Text>
          </View>
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
      <View style={local.header}>
        <Text style={local.brand}>
          Lulo<Text style={local.brandAccent}>SSH</Text>
        </Text>
        <Pressable onPress={onKeys} hitSlop={8} style={local.headerBtn}>
          <Text style={local.headerBtnText}>🔑 Claves</Text>
        </Pressable>
        <Pressable
          onPress={() => onEdit()}
          hitSlop={8}
          style={[local.headerBtn, local.headerBtnPrimary]}
        >
          <Text style={[local.headerBtnText, local.headerBtnPrimaryText]}>
            ＋ Host
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={local.body}
        keyboardShouldPersistTaps="handled"
      >
        {store.error && (
          <View>
            <Text style={styles.error}>{store.error}</Text>
            <Button title="Desbloquear" onPress={store.reload} />
          </View>
        )}

        {store.hosts.length > 5 && (
          <View style={local.search}>
            <Text style={local.searchIcon}>⌕</Text>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar por nombre, usuario, host o carpeta"
              placeholderTextColor="#5b6b7c"
              autoCapitalize="none"
              autoCorrect={false}
              style={local.searchInput}
            />
            {searching && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <Text style={local.searchClear}>✕</Text>
              </Pressable>
            )}
          </View>
        )}

        {store.loaded && store.hosts.length === 0 && (
          <View style={local.emptyBox}>
            <Text style={local.emptyIcon}>🍊</Text>
            <Text style={local.emptyTitle}>Aún no hay hosts</Text>
            <Text style={styles.rowSub}>
              Pulsa “＋ Host” para añadir el primero o importa tus sesiones de
              Xshell.
            </Text>
          </View>
        )}

        {live.length > 0 && !searching && (
          <Section title="Sesiones abiertas" icon="●" iconColor="#22c55e">
            {live.map(s => (
              <View key={s.sessionId} style={[local.card, local.liveCard]}>
                <Pressable
                  onPress={() => onResume(s)}
                  style={({ pressed }) => [local.liveMain, pressed && local.dim]}
                >
                  <Text style={local.hostName} numberOfLines={1}>
                    {s.title}
                  </Text>
                  <Text style={local.hostSub}>
                    abierta a las{' '}
                    {new Date(s.startedAt).toLocaleTimeString().slice(0, 5)} ·
                    toca para volver
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Alert.alert('Desconectar', `¿Cerrar ${s.title}?`, [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Desconectar',
                        style: 'destructive',
                        onPress: () => onDisconnect(s),
                      },
                    ])
                  }
                  hitSlop={10}
                  accessibilityLabel={`Desconectar ${s.title}`}
                >
                  <Text style={local.liveClose}>✕</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        )}

        {favs.length > 0 && !searching && (
          <Section title="Favoritos" icon="★" iconColor="#f5b301">
            {favs.map(h => renderHost(h, 0, 'fav-'))}
          </Section>
        )}

        {freq.length > 0 && !searching && (
          <Section title="Usados con frecuencia" icon="↻" iconColor="#7fb0ff">
            {freq.map(h => renderHost(h, 0, 'freq-'))}
          </Section>
        )}

        {store.hosts.length > 0 && (
          <Section
            title={searching ? `Resultados (${filtered.length})` : 'Todos'}
            icon="≡"
            iconColor={colors.muted}
          >
            {renderChildren(tree, 0)}
            {searching && filtered.length === 0 && (
              <Text style={local.hint}>Sin resultados para “{q.trim()}”.</Text>
            )}
          </Section>
        )}

        {store.hosts.length > 0 && (
          <Text style={local.hint}>
            ★ marca favoritos · mantén pulsado un host para editarlo, o una
            carpeta para renombrarla o moverla
          </Text>
        )}

        {store.loaded && (
          <Pressable
            onPress={importXshell}
            disabled={busy}
            style={({ pressed }) => [
              local.importBtn,
              (pressed || busy) && local.dim,
            ]}
          >
            <Text style={local.importText}>
              {busy ? 'Importando…' : '⇪  Importar de Xshell'}
            </Text>
          </Pressable>
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

function Section({
  title,
  icon,
  iconColor,
  children,
}: {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={local.section}>
      <View style={local.sectionHead}>
        <Text style={[local.sectionIcon, { color: iconColor }]}>{icon}</Text>
        <Text style={local.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function HostRow({
  host: h,
  depth,
  incomplete,
  live,
  onPress,
  onLongPress,
  onStar,
}: {
  host: Host;
  depth: number;
  incomplete: boolean;
  live: boolean;
  onPress(): void;
  onLongPress(): void;
  onStar(): void;
}) {
  const label = h.name || h.host;
  const tint = colorFor(normPath(h.group) ?? label);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        local.card,
        local.hostCard,
        { marginLeft: depth * INDENT },
        pressed && local.pressed,
      ]}
    >
      <View style={[local.avatar, { backgroundColor: tint + '33' }]}>
        <Text style={[local.avatarText, { color: tint }]}>
          {label.slice(0, 1).toUpperCase()}
        </Text>
        {live && <View style={local.liveDot} />}
      </View>
      <View style={local.hostText}>
        <Text style={local.hostName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={local.hostSub} numberOfLines={1}>
          {incomplete ? (
            <Text style={local.warn}>⚠ faltan credenciales · </Text>
          ) : (
            <Text>{h.auth.type === 'password' ? '🔒 ' : '🔑 '}</Text>
          )}
          {hostLabel(h)}
        </Text>
      </View>
      <Pressable
        onPress={onStar}
        hitSlop={12}
        accessibilityLabel={h.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
      >
        <Text style={[local.star, h.favorite && local.starOn]}>
          {h.favorite ? '★' : '☆'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const local = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  brand: { flex: 1, color: '#fff', fontSize: 22, fontWeight: '800' },
  brandAccent: { color: '#9be22d' },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  headerBtnPrimary: { backgroundColor: colors.accent },
  headerBtnText: { color: colors.text, fontWeight: '600' },
  headerBtnPrimaryText: { color: '#fff' },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  searchIcon: { color: colors.muted, fontSize: 18, marginRight: 6 },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 10 },
  searchClear: { color: colors.muted, fontSize: 16, paddingLeft: 8 },
  section: { marginTop: 14 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionIcon: { fontSize: 13, width: 16, textAlign: 'center' },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginBottom: 8,
  },
  hostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pressed: { backgroundColor: colors.surface2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800' },
  liveDot: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  hostText: { flex: 1 },
  hostName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hostSub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  warn: { color: '#f59e0b' },
  star: { color: '#5b6b7c', fontSize: 22, paddingHorizontal: 4 },
  starOn: { color: '#f5b301' },
  folder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  chevron: { color: colors.muted, width: 12, fontSize: 16, textAlign: 'center' },
  folderIcon: { fontSize: 16 },
  folderName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  badge: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    alignItems: 'center',
  },
  badgeText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
  },
  liveMain: { flex: 1 },
  liveClose: { color: colors.muted, fontSize: 18, paddingHorizontal: 4 },
  hint: {
    color: '#5b6b7c',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  emptyBox: { alignItems: 'center', marginTop: 48, gap: 6 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  importBtn: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surface2,
    borderStyle: 'dashed',
    padding: 14,
    alignItems: 'center',
  },
  importText: { color: colors.muted, fontWeight: '600' },
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
