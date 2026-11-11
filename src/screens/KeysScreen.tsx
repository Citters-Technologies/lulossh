import React, { useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SshKey } from '../store/models';
import { Store } from '../store/useStore';
import { Button, Field, Header, Segmented, styles } from '../ui/kit';

type Mode = 'list' | 'generate' | 'import';

export function KeysScreen({
  store,
  onBack,
}: {
  store: Store;
  onBack(): void;
}) {
  const [mode, setMode] = useState<Mode>('list');
  const [name, setName] = useState('');
  const [pem, setPem] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode('list');
    setName('');
    setPem('');
    setPassphrase('');
    setError(null);
  };

  const run = async (op: () => Promise<SshKey>) => {
    setBusy(true);
    setError(null);
    try {
      const key = await op();
      reset();
      sharePublic(key);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const sharePublic = (k: SshKey) =>
    Share.share({ title: `Clave pública ${k.name}`, message: k.publicKey });

  const remove = (k: SshKey) =>
    Alert.alert(
      'Borrar clave',
      `¿Borrar “${k.name}”? La clave privada se eliminará del dispositivo y no se puede recuperar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () =>
            store
              .deleteKey(k.id)
              .catch(e => Alert.alert('No se puede borrar', e.message)),
        },
      ],
    );

  return (
    <SafeAreaView style={styles.screen}>
      <Header
        title="Claves"
        left={{ label: '‹ Hosts', onPress: mode === 'list' ? onBack : reset }}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Segmented
          value={mode}
          onChange={m => {
            setError(null);
            setMode(m);
          }}
          options={[
            { value: 'list', label: 'Mis claves' },
            { value: 'generate', label: 'Generar' },
            { value: 'import', label: 'Importar' },
          ]}
        />
        {error && <Text style={styles.error}>{error}</Text>}

        {mode === 'list' && (
          <>
            {store.keys.length === 0 && (
              <Text style={styles.empty}>
                No hay claves. Genera una ed25519 o importa la tuya.
              </Text>
            )}
            {store.keys.map(k => (
              <View key={k.id} style={styles.row}>
                <Text style={styles.rowTitle}>{k.name}</Text>
                <Text style={styles.rowSub}>{k.type}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {k.publicKey}
                </Text>
                <Button
                  title="Compartir clave pública"
                  kind="secondary"
                  onPress={() => sharePublic(k)}
                />
                <Button
                  title="Borrar"
                  kind="danger"
                  onPress={() => remove(k)}
                />
              </View>
            ))}
          </>
        )}

        {mode === 'generate' && (
          <>
            <Field
              label="Nombre / comentario"
              value={name}
              onChangeText={setName}
              placeholder="movil-david"
            />
            <Text style={styles.rowSub}>
              Se genera una clave ed25519. La privada nunca sale del dispositivo
              sin cifrar; después podrás compartir la pública para añadirla a
              ~/.ssh/authorized_keys.
            </Text>
            <Button
              title="Generar ed25519"
              disabled={busy || !name.trim()}
              onPress={() => run(() => store.generateKey(name.trim()))}
            />
          </>
        )}

        {mode === 'import' && (
          <>
            <Field label="Nombre" value={name} onChangeText={setName} />
            <Field
              label="Clave privada (OpenSSH o PEM)"
              value={pem}
              onChangeText={setPem}
              multiline
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
            <Field
              label="Passphrase (si tiene)"
              value={passphrase}
              onChangeText={setPassphrase}
              secureTextEntry
            />
            <Button
              title="Importar"
              disabled={busy || !name.trim() || !pem.includes('PRIVATE KEY')}
              onPress={() =>
                run(() => store.importKey(name.trim(), pem, passphrase))
              }
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
