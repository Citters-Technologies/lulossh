import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { allFolderPaths, normPath, splitPath } from '../store/folders';
import { Host, HostAuth, validateHost } from '../store/models';
import { Store } from '../store/useStore';
import { Button, colors, Field, Header, Segmented, styles } from '../ui/kit';

const local = StyleSheet.create({
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.text },
});

export function HostEditScreen({
  store,
  host,
  onDone,
  onKeys,
}: {
  store: Store;
  host?: Host;
  onDone(): void;
  onKeys(): void;
}) {
  const [name, setName] = useState(host?.name ?? '');
  const [address, setAddress] = useState(host?.host ?? '');
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [username, setUsername] = useState(host?.username ?? '');
  const [group, setGroup] = useState(host?.group ?? '');
  const [authType, setAuthType] = useState<HostAuth['type']>(
    host?.auth.type ?? (store.keys.length ? 'privateKey' : 'password'),
  );
  const [password, setPassword] = useState(
    host?.auth.type === 'password' ? host.auth.password : '',
  );
  const [keyId, setKeyId] = useState(
    host?.auth.type === 'privateKey'
      ? host.auth.keyId
      : store.keys[0]?.id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folders = useMemo(() => allFolderPaths(store.hosts), [store.hosts]);

  const save = async () => {
    const draft: Omit<Host, 'id'> = {
      ...host,
      name: name.trim() || address.trim(),
      host: address.trim(),
      port: Number(port),
      username: username.trim(),
      group: normPath(group),
      auth:
        authType === 'password'
          ? { type: 'password', password }
          : { type: 'privateKey', keyId },
    };
    // Si cambia el destino, la huella guardada ya no aplica.
    if (host && (host.host !== draft.host || host.port !== draft.port)) {
      draft.fingerprint = undefined;
    }
    const err = validateHost(draft);
    setError(err);
    if (err) {
      return;
    }
    setBusy(true);
    try {
      await store.upsertHost({ ...draft, id: host?.id });
      onDone();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    host &&
    Alert.alert('Borrar host', `¿Borrar “${host.name}”?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          await store.deleteHost(host.id);
          onDone();
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <Header
        title={host ? 'Editar host' : 'Nuevo host'}
        left={{ label: 'Cancelar', onPress: onDone }}
        right={{ label: 'Guardar', onPress: save }}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {error && <Text style={styles.error}>{error}</Text>}
        <Field
          label="Nombre"
          value={name}
          onChangeText={setName}
          placeholder="web-prod"
        />
        <Field
          label="Host"
          value={address}
          onChangeText={setAddress}
          placeholder="192.168.1.10 o servidor.ejemplo.com"
          keyboardType="url"
        />
        <Field
          label="Puerto"
          value={port}
          onChangeText={setPort}
          keyboardType="number-pad"
        />
        <Field label="Usuario" value={username} onChangeText={setUsername} />
        <Field
          label="Carpeta (opcional, “/” para anidar)"
          value={group}
          onChangeText={setGroup}
          placeholder="Clientes/Acme"
        />
        {folders.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={local.chips}
          >
            {['', ...folders].map(f => {
              const active = (normPath(group) ?? '') === f;
              return (
                <Pressable
                  key={f || '-'}
                  onPress={() => setGroup(f)}
                  style={[local.chip, active && local.chipActive]}
                >
                  <Text style={local.chipText}>
                    {f ? splitPath(f).join(' › ') : 'Sin carpeta'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <Text style={styles.section}>Autenticación</Text>
        <Segmented<HostAuth['type']>
          value={authType}
          onChange={setAuthType}
          options={[
            { value: 'privateKey', label: 'Clave' },
            { value: 'password', label: 'Contraseña' },
          ]}
        />
        {authType === 'password' ? (
          <Field
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        ) : store.keys.length === 0 ? (
          <Button
            title="No hay claves: crear o importar una"
            kind="secondary"
            onPress={onKeys}
          />
        ) : (
          store.keys.map(k => (
            <Pressable
              key={k.id}
              onPress={() => setKeyId(k.id)}
              style={[
                styles.row,
                k.id === keyId && { borderWidth: 2, borderColor: '#3b82f6' },
              ]}
            >
              <Text style={styles.rowTitle}>{k.name}</Text>
              <Text style={styles.rowSub}>{k.type}</Text>
            </Pressable>
          ))
        )}

        <Button title="Guardar" onPress={save} disabled={busy} />
        {host && <Button title="Borrar host" kind="danger" onPress={remove} />}
      </ScrollView>
    </SafeAreaView>
  );
}
