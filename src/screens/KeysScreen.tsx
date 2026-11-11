import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isPrivateKeyText } from '../import/xshell';
import { Ssh } from '../native/SshModule';
import { SshKey } from '../store/models';
import { Store } from '../store/useStore';
import { expectExternalActivity } from '../ui/appLock';
import { Button, colors, Field, Header, styles } from '../ui/kit';

type Mode = 'list' | 'generate' | 'import';

/** Tipo legible: "ssh-ed25519" -> "ED25519", "ecdsa-sha2-nistp256" -> "ECDSA". */
const shortType = (t: string) =>
  t.replace(/^ssh-/, '').replace(/^ecdsa-sha2-.*/, 'ecdsa').toUpperCase();

/** Final de la clave pública, para distinguirlas a simple vista. */
const tail = (pub: string) => {
  const blob = pub.split(' ')[1] ?? '';
  return blob.length > 12 ? `…${blob.slice(-12)}` : blob;
};

export function KeysScreen({
  store,
  onBack,
  embedded = false,
}: {
  store: Store;
  onBack(): void;
  /** Dentro de las pestañas: sin cabecera propia. */
  embedded?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('list');
  const [name, setName] = useState('');
  const [pem, setPem] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode('list');
    setName('');
    setPem('');
    setPassphrase('');
    setPasting(false);
    setError(null);
  };

  const usage = (k: SshKey) => {
    const uses = (a: { type: string; keyId?: string }) =>
      a.type === 'privateKey' && a.keyId === k.id;
    return (
      store.hosts.filter(h => uses(h.auth as any)).length +
      store.identities.filter(i => uses(i.auth as any)).length
    );
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

  /** Importar: abre directamente el selector de archivos. */
  const startImport = async () => {
    setError(null);
    setMode('import');
    try {
      expectExternalActivity();
      const entries = await Ssh.pickImportFiles();
      if (!entries.length) {
        setPasting(true); // canceló: ofrecer pegar el texto
        return;
      }
      const found = entries.filter(e => isPrivateKeyText(e.text));
      if (!found.length) {
        setError(
          'No es una clave privada. Si elegiste la .pub, elige el archivo ' +
            'sin extensión (p. ej. id_ed25519).',
        );
        setPasting(true);
        return;
      }
      const f = found[0];
      setPem(f.text);
      setName((f.path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''));
      if (found.length > 1) {
        setError(
          `Había ${found.length} claves; cargada “${f.path}”. Impórtalas de una en una.`,
        );
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPasting(true);
    }
  };

  const sharePublic = (k: SshKey) =>
    Share.share({ title: `Clave pública ${k.name}`, message: k.publicKey });

  const copyPublic = (k: SshKey) => {
    Ssh.copyText(k.publicKey);
    Alert.alert('Copiada', `Clave pública de “${k.name}” en el portapapeles.`);
  };

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

  const Root = embedded ? View : SafeAreaView;
  return (
    <Root style={styles.screen}>
      {!embedded && (
        <Header
          title="Claves"
          left={{ label: '‹ Volver', onPress: mode === 'list' ? onBack : reset }}
        />
      )}
      <ScrollView
        contentContainerStyle={local.body}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'list' && (
          <>
            <View style={local.actions}>
              <Pill label="＋ Generar" primary onPress={() => setMode('generate')} />
              <Pill label="⇪ Importar" onPress={startImport} />
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
            {store.keys.length === 0 && (
              <View style={local.empty}>
                <Text style={local.emptyIcon}>🔑</Text>
                <Text style={local.emptyTitle}>Sin claves</Text>
                <Text style={styles.rowSub}>
                  Genera una ed25519 o importa la tuya (OpenSSH, PEM o .ppk).
                </Text>
              </View>
            )}
            {store.keys.map(k => {
              const n = usage(k);
              return (
                <View key={k.id} style={local.card}>
                  <View style={local.avatar}>
                    <Text style={local.avatarText}>🔑</Text>
                  </View>
                  <View style={local.text}>
                    <Text style={local.name} numberOfLines={1}>
                      {k.name}
                    </Text>
                    <Text style={local.sub} numberOfLines={1}>
                      <Text style={local.badge}>{shortType(k.type)}</Text>
                      {'  '}
                      {tail(k.publicKey)}
                      {n ? ` · ${n} en uso` : ''}
                    </Text>
                  </View>
                  <Icon label="⧉" hint="Copiar clave pública" onPress={() => copyPublic(k)} />
                  <Icon label="⤴" hint="Compartir clave pública" onPress={() => sharePublic(k)} />
                  <Icon label="🗑" hint="Borrar clave" onPress={() => remove(k)} />
                </View>
              );
            })}
            {store.keys.length > 0 && (
              <Text style={local.hint}>
                ⧉ copia y ⤴ comparte la clave pública, lista para
                ~/.ssh/authorized_keys.
              </Text>
            )}
          </>
        )}

        {mode === 'generate' && (
          <View style={local.form}>
            <Text style={local.formTitle}>Nueva clave ed25519</Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Field
              label="Nombre"
              value={name}
              onChangeText={setName}
              placeholder="movil-david"
              autoFocus
            />
            <Text style={local.sub}>
              La privada nunca sale del dispositivo sin cifrar. Después podrás
              copiar la pública al servidor.
            </Text>
            <View style={local.formButtons}>
              <Pill label="Cancelar" onPress={reset} />
              <Pill
                label={busy ? 'Generando…' : 'Generar'}
                primary
                disabled={busy || !name.trim()}
                onPress={() => run(() => store.generateKey(name.trim()))}
              />
            </View>
          </View>
        )}

        {mode === 'import' && (
          <View style={local.form}>
            <Text style={local.formTitle}>Importar clave</Text>
            {error && <Text style={styles.error}>{error}</Text>}
            {pem && !pasting ? (
              <Text style={local.loaded}>✓ Clave cargada del archivo</Text>
            ) : (
              <Field
                label="Pega la clave privada (OpenSSH, PEM o .ppk)"
                value={pem}
                onChangeText={setPem}
                multiline
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            )}
            <Field label="Nombre" value={name} onChangeText={setName} />
            <Field
              label="Passphrase (si tiene)"
              value={passphrase}
              onChangeText={setPassphrase}
              secureTextEntry
            />
            <View style={local.formButtons}>
              <Pill label="Cancelar" onPress={reset} />
              <Pill label="Otro archivo…" onPress={startImport} />
              <Pill
                label={busy ? 'Importando…' : 'Importar'}
                primary
                disabled={busy || !name.trim() || !isPrivateKeyText(pem)}
                onPress={() => run(() => store.importKey(name.trim(), pem, passphrase))}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </Root>
  );
}

function Pill({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        local.pill,
        primary && local.pillPrimary,
        (pressed || disabled) && local.dim,
      ]}
    >
      <Text style={[local.pillText, primary && local.pillTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Icon({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel={hint}
      style={({ pressed }) => [local.icon, pressed && local.iconPressed]}
    >
      <Text style={local.iconText}>{label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  pillPrimary: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontWeight: '600' },
  pillTextPrimary: { color: '#fff' },
  dim: { opacity: 0.5 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f59e0b26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17 },
  text: { flex: 1 },
  name: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  badge: { color: '#f5b301', fontWeight: '700' },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { backgroundColor: colors.surface2 },
  iconText: { color: colors.text, fontSize: 17 },
  hint: { color: '#5b6b7c', fontSize: 12, textAlign: 'center', marginTop: 12 },
  empty: { alignItems: 'center', marginTop: 40, gap: 6 },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  form: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 4 },
  formTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  loaded: { color: '#22c55e', fontWeight: '600', marginBottom: 10 },
});
