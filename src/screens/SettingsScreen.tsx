import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ssh } from '../native/SshModule';
import {
  expectExternalActivity,
  loadLockSettings,
  LOCK_AFTER_OPTIONS,
  LOCK_AFTER_PREF,
  LOCK_PREF,
  LockSettings,
} from '../ui/appLock';
import { parsePayload } from '../store/backup';
import { Store } from '../store/useStore';
import { Button, colors, Field, Header, Segmented, styles } from '../ui/kit';

const REPO = 'https://github.com/Citters-Technologies/lulossh';

export function SettingsScreen({
  store,
  onBack,
  onEditKeyBar,
  onLockChange,
}: {
  store: Store;
  onBack(): void;
  onEditKeyBar(): void;
  onLockChange(s: LockSettings): void;
}) {
  const [lock, setLock] = useState<LockSettings | null>(null);
  const [pw, setPw] = useState<{
    mode: 'export' | 'restore';
    a: string;
    b: string;
    file?: string;
  } | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPwError(null), [pw?.mode]);

  const doExport = async () => {
    if (!pw) {
      return;
    }
    if (pw.a.length < 8) {
      setPwError('Usa al menos 8 caracteres');
      return;
    }
    if (pw.a !== pw.b) {
      setPwError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    try {
      expectExternalActivity();
      const saved = await store.exportBackup(pw.a);
      setPw(null);
      if (saved) {
        const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
        const suspicious = saved.providerBytes === 0;
        Alert.alert(
          suspicious ? 'Revisa la copia' : 'Copia exportada',
          `“${saved.name}”: ${kb(saved.bytes)} escritos.` +
            (suspicious
              ? '\n\nEl destino dice que el fichero ocupa 0 bytes. Si es una carpeta en la nube puede tardar en subir; si sigue vacío, exporta a Descargas y cópialo luego al PC o a Drive.'
              : '\n\nGuárdala fuera del móvil (Drive, PC…) junto con su contraseña.'),
        );
      }
    } catch (e: any) {
      setPwError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickBackup = async () => {
    try {
      expectExternalActivity();
      const entries = await Ssh.pickImportFiles();
      if (!entries.length) {
        return;
      }
      setPw({ mode: 'restore', a: '', b: '', file: entries[0].text });
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? String(e));
    }
  };

  const doRestore = async () => {
    if (!pw?.file) {
      return;
    }
    setBusy(true);
    try {
      const payload = parsePayload(await Ssh.decryptBackup(pw.file, pw.a));
      const r = await store.restoreBackup(payload);
      setPw(null);
      Alert.alert(
        'Copia restaurada',
        [
          `${r.hosts} hosts, ${r.identities} identidades y ${r.keys} claves añadidos.`,
          r.hosts + r.identities + r.keys === 0
            ? 'Ya tenías todo lo que traía la copia.'
            : '',
          ...r.notes,
          'Los ajustes de la botonera y el bloqueo se aplican al reabrir la app.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (e: any) {
      setPwError(
        e?.code === 'BAD_PASSWORD'
          ? 'Contraseña incorrecta (o fichero dañado)'
          : e?.message ?? String(e),
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    loadLockSettings().then(setLock);
  }, []);

  const saveLock = (next: LockSettings) => {
    setLock(next);
    onLockChange(next);
    Ssh.prefSet(LOCK_PREF, next.enabled ? 'on' : 'off').catch(() => {});
    Ssh.prefSet(LOCK_AFTER_PREF, String(next.afterSec)).catch(() => {});
  };

  const toggleLock = async (enabled: boolean) => {
    if (!lock) {
      return;
    }
    // Quitar el bloqueo exige demostrar que eres tú.
    if (!enabled) {
      try {
        await Ssh.unlock('Desactivar el bloqueo de LuloSSH');
      } catch {
        return;
      }
    }
    saveLock({ ...lock, enabled });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Header title="Ajustes" left={{ label: '‹ Volver', onPress: onBack }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Seguridad</Text>
        <View style={local.card}>
          <View style={local.line}>
            <Text style={local.icon}>🔐</Text>
            <View style={local.lineText}>
              <Text style={local.title}>Bloquear con huella o PIN</Text>
              <Text style={local.sub}>
                Pide desbloquear al abrir la app y al volver a ella.
              </Text>
            </View>
            <Switch
              value={lock?.enabled ?? true}
              onValueChange={toggleLock}
              disabled={!lock}
            />
          </View>
          {lock?.enabled && (
            <>
              <Text style={[local.sub, local.gap]}>
                Pedirlo al volver después de
              </Text>
              <Segmented
                value={String(lock.afterSec)}
                onChange={v => saveLock({ ...lock, afterSec: Number(v) })}
                options={LOCK_AFTER_OPTIONS.map(o => ({ ...o }))}
              />
            </>
          )}
        </View>

        <Text style={styles.section}>Copia de seguridad</Text>
        <Item
          icon="📤"
          title="Exportar copia cifrada"
          sub={`Hosts, identidades, claves privadas y ajustes, protegidos con una contraseña. ${store.hosts.length} hosts · ${store.identities.length} identidades · ${store.keys.length} claves`}
          onPress={() => setPw({ mode: 'export', a: '', b: '' })}
        />
        <Item
          icon="📥"
          title="Restaurar copia"
          sub="Añade lo que falte desde un fichero .lulossh (no borra nada)"
          onPress={pickBackup}
        />

        <Text style={styles.section}>Terminal</Text>
        <Item
          icon="⌨️"
          title="Botonera de teclas"
          sub="Añade, quita y ordena las teclas de encima del teclado"
          onPress={onEditKeyBar}
        />

        <Text style={styles.section}>Acerca de</Text>
        <Item
          icon="🍊"
          title="LuloSSH"
          sub="Código abierto (AGPL-3.0) · Citters Technologies SLU"
          onPress={() => Linking.openURL(REPO)}
        />
      </ScrollView>

      <Modal
        visible={!!pw}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) {
            setPw(null);
          }
        }}
      >
        <View style={local.backdrop}>
          <View style={local.dialog}>
            <Text style={local.title}>
              {pw?.mode === 'export' ? 'Contraseña de la copia' : 'Abrir copia'}
            </Text>
            <Text style={local.sub}>
              {pw?.mode === 'export'
                ? 'La necesitarás para restaurar. Si la olvidas, la copia no se puede abrir: guárdala en tu gestor de contraseñas.'
                : 'Escribe la contraseña con la que exportaste la copia.'}
            </Text>
            <Field
              label="Contraseña"
              value={pw?.a ?? ''}
              onChangeText={a => setPw(p => (p ? { ...p, a } : p))}
              secureTextEntry
              autoFocus
            />
            {pw?.mode === 'export' && (
              <Field
                label="Repite la contraseña"
                value={pw.b}
                onChangeText={b => setPw(p => (p ? { ...p, b } : p))}
                secureTextEntry
              />
            )}
            {pwError && <Text style={styles.error}>{pwError}</Text>}
            <Button
              title={busy ? 'Un momento…' : pw?.mode === 'export' ? 'Exportar' : 'Restaurar'}
              disabled={busy}
              onPress={pw?.mode === 'export' ? doExport : doRestore}
            />
            <Button
              title="Cancelar"
              kind="secondary"
              disabled={busy}
              onPress={() => setPw(null)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Item({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [local.card, local.line, pressed && local.pressed]}
    >
      <Text style={local.icon}>{icon}</Text>
      <View style={local.lineText}>
        <Text style={local.title}>{title}</Text>
        <Text style={local.sub}>{sub}</Text>
      </View>
      <Text style={local.chev}>›</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineText: { flex: 1 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  gap: { marginTop: 12, marginBottom: 6 },
  icon: { fontSize: 20, width: 28, textAlign: 'center' },
  chev: { color: colors.muted, fontSize: 22 },
  pressed: { backgroundColor: colors.surface2 },
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
