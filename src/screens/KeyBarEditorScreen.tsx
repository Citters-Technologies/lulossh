import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CATALOG,
  CatalogKey,
  LAYOUT_PREF,
  parseEscapes,
  parseLayout,
  showEscapes,
  toButton,
  uniqueId,
} from '../keyboard/catalog';
import { KeyBar } from '../keyboard/KeyBar';
import { DEFAULT_LAYOUT, KeyboardLayout, KeyButton } from '../keyboard/model';
import { Ssh } from '../native/SshModule';
import { Button, colors, Field, Header, Segmented, styles } from '../ui/kit';

const MAX_ROWS = 3;
const NO_MODS = { ctrl: false, alt: false, shift: false };

type Sel = { row: number; idx: number } | null;
type Draft = { label: string; text: string; enter: boolean; editing?: boolean };

const clone = (l: KeyboardLayout): KeyboardLayout => JSON.parse(JSON.stringify(l));

export function KeyBarEditorScreen({ onBack }: { onBack(): void }) {
  const [layout, setLayout] = useState<KeyboardLayout>(DEFAULT_LAYOUT);
  const [layerName, setLayerName] = useState(DEFAULT_LAYOUT.defaultLayer);
  const [sel, setSel] = useState<Sel>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    Ssh.prefGet(LAYOUT_PREF)
      .then(v => setLayout(clone(parseLayout(v))))
      .catch(() => {});
  }, []);

  const rows = layout.layers[layerName].rows;
  const selected = sel ? rows[sel.row]?.[sel.idx] : undefined;

  const update = (fn: (rs: KeyButton[][]) => void, nextSel?: Sel) => {
    const next = clone(layout);
    fn(next.layers[layerName].rows);
    setLayout(next);
    setDirty(true);
    if (nextSel !== undefined) {
      setSel(nextSel);
    }
  };

  const move = (dx: number) =>
    sel &&
    update(rs => {
      const r = rs[sel.row];
      const j = sel.idx + dx;
      if (j < 0 || j >= r.length) {
        return;
      }
      [r[sel.idx], r[j]] = [r[j], r[sel.idx]];
    }, { row: sel.row, idx: Math.max(0, Math.min(rows[sel.row].length - 1, sel.idx + dx)) });

  const moveRow = (dy: number) => {
    if (!sel) {
      return;
    }
    const to = sel.row + dy;
    if (to < 0 || to >= rows.length) {
      return;
    }
    const idx = Math.min(sel.idx, rows[to].length);
    update(rs => {
      const [b] = rs[sel.row].splice(sel.idx, 1);
      rs[to].splice(idx, 0, b);
    }, { row: to, idx });
  };

  const remove = () =>
    sel &&
    update(rs => {
      rs[sel.row].splice(sel.idx, 1);
    }, null);

  const insert = (btn: KeyButton) => {
    const row = sel ? sel.row : rows.length - 1;
    const idx = sel ? sel.idx + 1 : rows[row].length;
    update(rs => {
      rs[row].splice(idx, 0, btn);
    }, { row, idx });
  };

  const addFromCatalog = (c: CatalogKey) => {
    setPicking(false);
    insert(toButton(layout, c));
  };

  const saveDraft = () => {
    if (!draft) {
      return;
    }
    const label = draft.label.trim();
    if (!label) {
      Alert.alert('Falta la etiqueta', 'Escribe el texto que se verá en la tecla.');
      return;
    }
    const seq = parseEscapes(draft.text) + (draft.enter ? '\r' : '');
    if (draft.editing && sel && selected) {
      update(rs => {
        const b = rs[sel.row][sel.idx];
        b.label = label;
        if (b.action.kind === 'macro' || b.action.kind === 'text') {
          b.action = { kind: 'macro', sequence: seq };
        }
      });
    } else {
      if (!seq) {
        Alert.alert('Falta el texto', 'Escribe lo que enviará la tecla.');
        return;
      }
      insert({
        id: uniqueId(layout, 'custom'),
        label,
        action: { kind: 'macro', sequence: seq },
      });
    }
    setDraft(null);
  };

  const editSelected = () => {
    if (!selected) {
      return;
    }
    const a = selected.action;
    const seq = a.kind === 'macro' ? a.sequence : a.kind === 'text' ? a.text : '';
    const enter = seq.endsWith('\r');
    setDraft({
      label: selected.label,
      text: showEscapes(enter ? seq.slice(0, -1) : seq),
      enter,
      editing: true,
    });
  };

  const save = async () => {
    const next = clone(layout);
    // Filas vacías fuera; cada capa secundaria necesita una tecla de vuelta.
    Object.entries(next.layers).forEach(([name, l]) => {
      l.rows = l.rows.filter(r => r.length);
      if (!l.rows.length) {
        l.rows = [[]];
      }
      const hasBack = l.rows
        .flat()
        .some(b => b.action.kind === 'layer' && b.action.layer !== name);
      if (name !== next.defaultLayer && !hasBack) {
        l.rows[0].unshift({
          id: uniqueId(next, 'abc'),
          label: 'ABC',
          action: { kind: 'layer', layer: next.defaultLayer },
        });
      }
    });
    try {
      await Ssh.prefSet(LAYOUT_PREF, JSON.stringify(next));
      setLayout(next);
      setDirty(false);
      onBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? String(e));
    }
  };

  const reset = () =>
    Alert.alert('Restablecer botonera', '¿Volver a la botonera de serie?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Restablecer',
        style: 'destructive',
        onPress: () => {
          setLayout(clone(DEFAULT_LAYOUT));
          setSel(null);
          setDirty(true);
        },
      },
    ]);

  const back = () =>
    dirty
      ? Alert.alert('Cambios sin guardar', '¿Salir sin guardar?', [
          { text: 'Seguir editando', style: 'cancel' },
          { text: 'Salir', style: 'destructive', onPress: onBack },
        ])
      : onBack();

  const canEdit =
    selected &&
    (selected.action.kind === 'macro' || selected.action.kind === 'text');

  return (
    <SafeAreaView style={styles.screen}>
      <Header
        title="Botonera"
        left={{ label: '‹ Ajustes', onPress: back }}
        right={{ label: 'Guardar', onPress: save }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <Segmented
          value={layerName}
          onChange={l => {
            setLayerName(l);
            setSel(null);
          }}
          options={Object.entries(layout.layers).map(([value, l]) => ({
            value,
            label: l.name,
          }))}
        />

        <Text style={styles.section}>Vista previa</Text>
        <View style={local.preview}>
          <KeyBar
            key={layerName + JSON.stringify(rows.map(r => r.length))}
            layout={{ ...layout, defaultLayer: layerName }}
            mods={NO_MODS}
            onToggleModifier={() => {}}
            onSend={() => {}}
          />
        </View>

        <Text style={styles.section}>Toca una tecla para moverla o quitarla</Text>
        {rows.map((row, r) => (
          <View key={r} style={local.editRow}>
            <Text style={local.rowLabel}>{r + 1}</Text>
            <View style={local.chips}>
              {row.map((b, i) => {
                const on = sel?.row === r && sel.idx === i;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setSel(on ? null : { row: r, idx: i })}
                    style={[local.chip, on && local.chipOn]}
                  >
                    <Text style={local.chipText}>{b.label}</Text>
                  </Pressable>
                );
              })}
              {row.length === 0 && <Text style={local.emptyRow}>(fila vacía)</Text>}
            </View>
          </View>
        ))}

        {selected && (
          <View style={local.tools}>
            <Tool label="◀" onPress={() => move(-1)} />
            <Tool label="▶" onPress={() => move(1)} />
            <Tool label="▲ fila" onPress={() => moveRow(-1)} />
            <Tool label="▼ fila" onPress={() => moveRow(1)} />
            {canEdit && <Tool label="✎" onPress={editSelected} />}
            <Tool label="🗑" danger onPress={remove} />
          </View>
        )}

        <Button title="＋ Añadir tecla" onPress={() => setPicking(true)} />
        <Button
          title="＋ Tecla personalizada (texto o comando)"
          kind="secondary"
          onPress={() => setDraft({ label: '', text: '', enter: true })}
        />
        {rows.length < MAX_ROWS && (
          <Button
            title="＋ Añadir fila"
            kind="secondary"
            onPress={() => update(rs => void rs.push([]), { row: rows.length, idx: -1 })}
          />
        )}
        <Button title="Restablecer botonera de serie" kind="danger" onPress={reset} />
        <Text style={local.tip}>
          Las teclas nuevas se añaden detrás de la seleccionada (o al final).
          Cada capa secundaria necesita una tecla para volver: si falta, se
          añade “ABC” al guardar.
        </Text>
      </ScrollView>

      <Modal
        visible={picking}
        animationType="slide"
        onRequestClose={() => setPicking(false)}
      >
        <SafeAreaView style={styles.screen}>
          <Header
            title="Añadir tecla"
            left={{ label: 'Cerrar', onPress: () => setPicking(false) }}
          />
          <ScrollView contentContainerStyle={styles.body}>
            {CATALOG.map(sec => (
              <View key={sec.title}>
                <Text style={styles.section}>{sec.title}</Text>
                <View style={local.chips}>
                  {sec.keys.map(c => (
                    <Pressable
                      key={c.base + c.label}
                      onPress={() => addFromCatalog(c)}
                      style={({ pressed }) => [local.chip, pressed && local.chipOn]}
                    >
                      <Text style={local.chipText}>{c.label}</Text>
                      {c.hint && <Text style={local.chipHint}>{c.hint}</Text>}
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={!!draft}
        transparent
        animationType="fade"
        onRequestClose={() => setDraft(null)}
      >
        <View style={local.backdrop}>
          <View style={local.dialog}>
            <Text style={styles.rowTitle}>
              {draft?.editing ? 'Editar tecla' : 'Tecla personalizada'}
            </Text>
            <Field
              label="Etiqueta (lo que se ve)"
              value={draft?.label ?? ''}
              onChangeText={label => setDraft(d => (d ? { ...d, label } : d))}
              placeholder="⚡su, logs, 🐳ps…"
              autoFocus
            />
            {(!draft?.editing || canEdit) && (
              <>
                <Field
                  label="Texto que envía"
                  value={draft?.text ?? ''}
                  onChangeText={text => setDraft(d => (d ? { ...d, text } : d))}
                  placeholder="docker ps -a"
                />
                <View style={local.switchRow}>
                  <Text style={styles.rowSub}>Pulsar Enter al final</Text>
                  <Switch
                    value={draft?.enter ?? false}
                    onValueChange={enter => setDraft(d => (d ? { ...d, enter } : d))}
                  />
                </View>
                <Text style={local.tip}>
                  Secuencias: \e = Esc, \t = Tab, \r = Enter, \x03 = Ctrl+C.
                </Text>
              </>
            )}
            <Button title="Guardar tecla" onPress={saveDraft} />
            <Button title="Cancelar" kind="secondary" onPress={() => setDraft(null)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Tool({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress(): void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        local.tool,
        danger && local.toolDanger,
        pressed && local.chipOn,
      ]}
    >
      <Text style={local.chipText}>{label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  preview: { borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  editRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  rowLabel: { color: colors.muted, width: 14, paddingTop: 8 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipOn: { borderColor: colors.accent, backgroundColor: '#1d3557' },
  chipText: { color: colors.text, fontWeight: '600' },
  chipHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  emptyRow: { color: colors.muted, paddingTop: 8 },
  tools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 8,
  },
  tool: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toolDanger: { backgroundColor: '#3b1d1d' },
  tip: { color: colors.muted, fontSize: 12, marginTop: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
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
    gap: 6,
  },
});
