import React, { useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isPrivateKeyText } from '../import/xshell';
import { Ssh } from '../native/SshModule';
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
      const waiting = store.hostsWaitingForKey(key);
      if (waiting.length) {
        Alert.alert(
          'Asignar clave',
          `${waiting.length} hosts importados esperaban la clave “${key.name}”:\n` +
            waiting
              .slice(0, 8)
              .map(h => `• ${h.name}`)
              .join('\n') +
            '\n\n¿Asignársela?',
          [
            { text: 'No', style: 'cancel' },
            {
              text: 'Asignar',
              onPress: () =>
                store
                  .assignKey(
                    key.id,
                    waiting.map(h => h.id),
                  )
                  .catch(e => setError(e?.message ?? String(e))),
            },
          ],
        );
      } else {
        sharePublic(key);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Carga la clave desde un archivo (id_ed25519, .pem, .key, .ppk…). */
  const pickFile = async () => {
    setError(null);
    try {
      const entries = await Ssh.pickImportFiles();
      if (!entries.length) {
        return;
      }
      const found = entries.filter(e => isPrivateKeyText(e.text));
      if (!found.length) {
        setError(
          'No es una clave privada. Si elegiste la .pub, elige el archivo ' +
            'sin extensión (p. ej. id_ed25519).',
        );
        return;
      }
      const f = found[0];
      setPem(f.text);
      if (!name.trim()) {
        setName((f.path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''));
      }
      if (found.length > 1) {
        setError(
          `Había ${found.length} claves; cargada “${f.path}”. ` +
            'Impórtalas de una en una.',
        );
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
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
            <Button
              title="Elegir archivo…"
              kind="secondary"
              disabled={busy}
              onPress={pickFile}
            />
            <Field label="Nombre" value={name} onChangeText={setName} />
            <Field
              label="Clave privada (OpenSSH, PEM o PuTTY .ppk)"
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
              disabled={busy || !name.trim() || !isPrivateKeyText(pem)}
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
