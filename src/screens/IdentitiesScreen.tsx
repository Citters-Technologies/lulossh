import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { HostAuth, Identity } from '../store/models';
import { Store } from '../store/useStore';
import { HostPicker } from '../ui/HostPicker';
import { Button, colors, Field, Segmented, styles } from '../ui/kit';

type Draft = Omit<Identity, 'id'> & { id?: string };

const EMPTY: Draft = {
  name: '',
  username: '',
  auth: { type: 'privateKey', keyId: '' },
};

/**
 * Identidades: usuario + contraseña o clave, reutilizables en muchos hosts.
 * Cambiar la identidad cambia de golpe todos los hosts que la usan.
 */
export function IdentitiesScreen({
  store,
  onKeys,
}: {
  store: Store;
  onKeys(): void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assigning, setAssigning] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usedBy = (id: string) =>
    store.hosts.filter(h => h.identityId === id).length;

  const startNew = () =>
    setDraft({
      ...EMPTY,
      auth: store.keys[0]
        ? { type: 'privateKey', keyId: store.keys[0].id }
        : { type: 'password', password: '' },
    });

  const save = async () => {
    if (!draft) {
      return;
    }
    const d = {
      ...draft,
      name: draft.name.trim(),
      username: draft.username.trim(),
    };
    if (!d.username) {
      setError('Falta el usuario');
      return;
    }
    if (d.auth.type === 'privateKey' && !d.auth.keyId) {
      setError('Elige una clave');
      return;
    }
    if (d.auth.type === 'password' && !d.auth.password) {
      setError('Falta la contraseña');
      return;
    }
    try {
      const saved = await store.upsertIdentity({
        ...d,
        name: d.name || d.username,
      });
      const isNew = !draft.id;
      setDraft(null);
      setError(null);
      if (isNew && store.hosts.length) {
        setAssigning(saved); // recién creada: ofrecer asignarla ya
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const remove = (i: Identity) =>
    Alert.alert(
      'Borrar identidad',
      `¿Borrar “${i.name}”?` +
        (usedBy(i.id)
          ? ` ${usedBy(
              i.id,
            )} hosts dejarán de usarla (vuelven a sus propios datos).`
          : ''),
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () => store.deleteIdentity(i.id).catch(() => {}),
        },
      ],
    );

  const setAuthType = (t: HostAuth['type']) =>
    setDraft(d =>
      d
        ? {
            ...d,
            auth:
              t === 'password'
                ? { type: 'password', password: '' }
                : { type: 'privateKey', keyId: store.keys[0]?.id ?? '' },
          }
        : d,
    );

  if (draft) {
    return (
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.rowTitle}>
          {draft.id ? 'Editar identidad' : 'Nueva identidad'}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <Field
          label="Nombre"
          value={draft.name}
          onChangeText={name => setDraft({ ...draft, name })}
          placeholder="root producción, deploy, ubuntu…"
        />
        <Field
          label="Usuario"
          value={draft.username}
          onChangeText={username => setDraft({ ...draft, username })}
          placeholder="root"
        />
        <Segmented<HostAuth['type']>
          value={draft.auth.type}
          onChange={setAuthType}
          options={[
            { value: 'privateKey', label: 'Clave' },
            { value: 'password', label: 'Contraseña' },
          ]}
        />
        {draft.auth.type === 'password' ? (
          <Field
            label="Contraseña"
            value={draft.auth.password}
            onChangeText={password =>
              setDraft({ ...draft, auth: { type: 'password', password } })
            }
            secureTextEntry
          />
        ) : store.keys.length === 0 ? (
          <Button
            title="No hay claves: crear o importar una"
            kind="secondary"
            onPress={onKeys}
          />
        ) : (
          store.keys.map(k => {
            const on =
              draft.auth.type === 'privateKey' && draft.auth.keyId === k.id;
            return (
              <Pressable
                key={k.id}
                onPress={() =>
                  setDraft({
                    ...draft,
                    auth: { type: 'privateKey', keyId: k.id },
                  })
                }
                style={[styles.row, on && local.selected]}
              >
                <Text style={styles.rowTitle}>🔑 {k.name}</Text>
                <Text style={styles.rowSub}>{k.type}</Text>
              </Pressable>
            );
          })
        )}
        <Button title="Guardar" onPress={save} />
        <Button
          title="Cancelar"
          kind="secondary"
          onPress={() => {
            setDraft(null);
            setError(null);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={local.intro}>
          Una identidad es un usuario con su contraseña o clave. Asígnala a
          muchos hosts a la vez; si la cambias, cambian todos.
        </Text>
        {store.identities.length === 0 && (
          <Text style={styles.empty}>Aún no hay identidades.</Text>
        )}
        {store.identities.map(i => (
          <View key={i.id} style={local.card}>
            <Pressable
              onPress={() => setDraft({ ...i })}
              style={({ pressed }) => [local.cardMain, pressed && local.dim]}
            >
              <View style={local.avatar}>
                <Text style={local.avatarText}>👤</Text>
              </View>
              <View style={local.flex}>
                <Text style={styles.rowTitle}>{i.name}</Text>
                <Text style={styles.rowSub}>
                  {i.username} ·{' '}
                  {i.auth.type === 'password'
                    ? '🔒 contraseña'
                    : `🔑 ${
                        store.keys.find(
                          k =>
                            i.auth.type === 'privateKey' &&
                            k.id === i.auth.keyId,
                        )?.name ?? 'clave borrada'
                      }`}
                </Text>
                <Text style={styles.rowSub}>
                  {usedBy(i.id)
                    ? `Usada por ${usedBy(i.id)} hosts`
                    : 'Sin hosts asignados'}
                </Text>
              </View>
            </Pressable>
            <View style={local.actions}>
              <Pressable onPress={() => setAssigning(i)} style={local.action}>
                <Text style={local.actionText}>Asignar a hosts</Text>
              </Pressable>
              <Pressable
                onPress={() => remove(i)}
                style={[local.action, local.actionDanger]}
              >
                <Text style={local.actionText}>Borrar</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Button title="＋ Nueva identidad" onPress={startNew} />
      </ScrollView>

      <HostPicker
        visible={!!assigning}
        title={assigning ? `Usar “${assigning.name}”` : ''}
        hosts={store.hosts}
        initial={
          assigning
            ? store.hosts
                .filter(h => h.identityId === assigning.id)
                .map(h => h.id)
            : []
        }
        isIncomplete={store.isIncomplete}
        confirmLabel="Aplicar"
        onCancel={() => setAssigning(null)}
        onConfirm={async ids => {
          if (!assigning) {
            return;
          }
          const id = assigning.id;
          const before = store.hosts
            .filter(h => h.identityId === id)
            .map(h => h.id);
          const removed = before.filter(x => !ids.includes(x));
          setAssigning(null);
          // Marcados: usan la identidad; desmarcados que la usaban: la sueltan.
          await store.setIdentityHosts(id, ids).catch(() => {});
          if (removed.length) {
            Alert.alert(
              'Identidad',
              `${removed.length} hosts dejarán de usar “${assigning.name}”.`,
            );
          }
        }}
      />
    </>
  );
}

const local = StyleSheet.create({
  intro: { color: colors.muted, marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardMain: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#a855f733',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  action: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionDanger: { backgroundColor: colors.dangerBg },
  actionText: { color: colors.text, fontWeight: '600' },
  selected: { borderWidth: 2, borderColor: colors.accent },
  dim: { opacity: 0.6 },
});
