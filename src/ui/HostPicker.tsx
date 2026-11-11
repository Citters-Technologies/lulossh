import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { splitPath } from '../store/folders';
import { Host, hostLabel } from '../store/models';
import { byName, compareText } from '../store/ranking';
import { Button, colors, Header, styles } from './kit';

/**
 * Selección múltiple de hosts, pensada para el móvil: buscador, filtro de
 * "solo incompletos" y marcar/desmarcar carpetas enteras de un toque.
 */
export function HostPicker({
  visible,
  title,
  hosts,
  initial,
  isIncomplete,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  hosts: Host[];
  initial?: string[];
  isIncomplete(h: Host): boolean;
  confirmLabel: string;
  /** Botón de confirmar en rojo (acciones destructivas). */
  danger?: boolean;
  onCancel(): void;
  onConfirm(ids: string[]): void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [q, setQ] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  // Al abrir, partir de la selección inicial.
  const initialKey = (initial ?? []).join(',');
  useEffect(() => {
    if (visible) {
      setSel(new Set(initialKey ? initialKey.split(',') : []));
      setQ('');
    }
  }, [visible, initialKey]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = hosts
      .filter(h => !onlyIncomplete || isIncomplete(h))
      .filter(
        h =>
          !needle ||
          h.name.toLowerCase().includes(needle) ||
          hostLabel(h).toLowerCase().includes(needle) ||
          (h.group ?? '').toLowerCase().includes(needle),
      )
      .sort(byName);
    const map = new Map<string, Host[]>();
    list.forEach(h => {
      const g = splitPath(h.group).join(' › ') || 'Sin carpeta';
      map.set(g, [...(map.get(g) ?? []), h]);
    });
    return [...map.entries()].sort(([a], [b]) => compareText(a, b));
  }, [hosts, q, onlyIncomplete, isIncomplete]);

  const toggle = (ids: string[], on: boolean) =>
    setSel(prev => {
      const next = new Set(prev);
      ids.forEach(id => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const visibleIds = groups.flatMap(([, hs]) => hs.map(h => h.id));
  const allOn = visibleIds.length > 0 && visibleIds.every(id => sel.has(id));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.screen}>
        <Header title={title} left={{ label: 'Cancelar', onPress: onCancel }} />
        <View style={local.top}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Buscar"
            placeholderTextColor="#5b6b7c"
            autoCapitalize="none"
            autoCorrect={false}
            style={local.search}
          />
          <View style={local.filters}>
            <Chip
              label="Solo incompletos ⚠"
              on={onlyIncomplete}
              onPress={() => setOnlyIncomplete(v => !v)}
            />
            <Chip
              label={allOn ? 'Desmarcar visibles' : 'Marcar visibles'}
              on={allOn}
              onPress={() => toggle(visibleIds, !allOn)}
            />
          </View>
        </View>
        <ScrollView contentContainerStyle={local.list}>
          {groups.map(([g, hs]) => {
            const ids = hs.map(h => h.id);
            const gOn = ids.every(id => sel.has(id));
            return (
              <View key={g}>
                <Pressable
                  onPress={() => toggle(ids, !gOn)}
                  style={local.groupRow}
                >
                  <Text style={local.check}>{gOn ? '☑' : '☐'}</Text>
                  <Text style={local.groupName}>📁 {g}</Text>
                  <Text style={local.count}>{hs.length}</Text>
                </Pressable>
                {hs.map(h => {
                  const on = sel.has(h.id);
                  return (
                    <Pressable
                      key={h.id}
                      onPress={() => toggle([h.id], !on)}
                      style={[local.hostRow, on && local.hostOn]}
                    >
                      <Text style={local.check}>{on ? '☑' : '☐'}</Text>
                      <View style={local.flex}>
                        <Text style={local.hostName} numberOfLines={1}>
                          {isIncomplete(h) ? '⚠ ' : ''}
                          {h.name || h.host}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {hostLabel(h)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
          {groups.length === 0 && (
            <Text style={styles.empty}>No hay hosts que coincidan.</Text>
          )}
        </ScrollView>
        <View style={local.bottom}>
          <Button
            title={`${confirmLabel} (${sel.size})`}
            kind={danger ? 'danger' : 'primary'}
            disabled={danger && sel.size === 0}
            onPress={() => onConfirm([...sel])}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress(): void;
}) {
  return (
    <Pressable onPress={onPress} style={[local.chip, on && local.chipOn]}>
      <Text style={local.chipText}>{label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600' },
  list: { padding: 16, paddingBottom: 32 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  groupName: { flex: 1, color: colors.text, fontWeight: '700' },
  count: { color: colors.muted },
  check: { color: colors.accent, fontSize: 20, width: 24 },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    marginLeft: 12,
  },
  hostOn: { backgroundColor: '#1d3557' },
  hostName: { color: '#fff', fontWeight: '600' },
  flex: { flex: 1 },
  bottom: { padding: 16 },
});
