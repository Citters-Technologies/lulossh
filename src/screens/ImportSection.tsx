import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { expectExternalActivity } from '../ui/appLock';
import { confirmUpdates, importFromJuiceSsh, showSummary } from '../import/ui';
import { ImportResult, parseImport } from '../import/xshell';
import { Ssh } from '../native/SshModule';
import { Store } from '../store/useStore';
import { Button, colors, Field, styles } from '../ui/kit';

/**
 * Importar máquinas, grupos y claves desde Xshell (.xts/.zip/.xsh/.pem) o
 * JuiceSSH. Incluye el paso de contraseña maestra de Xshell para descifrar las
 * contraseñas guardadas. Pensado para vivir en Ajustes, junto a las copias.
 */
export function ImportSection({ store }: { store: Store }) {
  const [busy, setBusy] = useState(false);
  const [juiceInstalled, setJuiceInstalled] = useState(false);
  useEffect(() => {
    Ssh.isJuiceSshInstalled()
      .then(setJuiceInstalled)
      .catch(() => {});
  }, []);

  // Importación de Xshell que espera la contraseña maestra (null = sin modal).
  const [xMaster, setXMaster] = useState<{
    parsed: ImportResult;
    count: number;
    pw: string;
    error?: string;
  } | null>(null);

  const importXshell = async () => {
    try {
      expectExternalActivity();
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
            'de la carpeta Sessions, ficheros .xsh o claves privadas (OpenSSH/.pem).',
        );
        return;
      }
      const count = parsed.hosts.filter(h => h.encPassword).length;
      if (count > 0) {
        setXMaster({ parsed, count, pw: '' });
        return;
      }
      await finishXshell(parsed);
    } catch (e: any) {
      Alert.alert('Error al importar', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const finishXshell = async (parsed: ImportResult, decrypted?: number) => {
    const r = await store.importBatch(parsed, confirmUpdates);
    const extra: string[] = [];
    if (decrypted !== undefined) {
      const total = parsed.hosts.filter(h => h.encPassword).length;
      extra.push(`🔑 ${decrypted}/${total} contraseñas descifradas.`);
      if (decrypted < total) {
        extra.push(
          'Las que faltan usan otra contraseña maestra o un formato que no ' +
            'reconocemos; complétalas a mano.',
        );
      }
    }
    if (r.incomplete) {
      extra.push('Importa sus claves (OpenSSH) desde Claves o vuelve a importar con los .pem.');
    }
    showSummary('Importación de Xshell', r, extra.join('\n') || undefined);
  };

  const runXMaster = async () => {
    if (!xMaster) {
      return;
    }
    setBusy(true);
    try {
      const { parsed, pw } = xMaster;
      const withPw = parsed.hosts.filter(h => h.encPassword);
      const plains = await Ssh.decryptXshellPasswords(
        pw,
        withPw.map(h => h.encPassword!),
      );
      let ok = 0;
      withPw.forEach((h, i) => {
        if (plains[i]) {
          h.password = plains[i]!;
          ok++;
        }
      });
      if (ok === 0) {
        setXMaster(m =>
          m
            ? { ...m, error: 'Contraseña maestra incorrecta (no cuadró ninguna).' }
            : m,
        );
        return;
      }
      setXMaster(null);
      await finishXshell(parsed, ok);
    } catch (e: any) {
      setXMaster(m => (m ? { ...m, error: e?.message ?? String(e) } : m));
    } finally {
      setBusy(false);
    }
  };

  const skipXMaster = async () => {
    if (!xMaster) {
      return;
    }
    const parsed = xMaster.parsed;
    setXMaster(null);
    setBusy(true);
    try {
      await finishXshell(parsed);
    } catch (e: any) {
      Alert.alert('Error al importar', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const importJuice = async () => {
    setBusy(true);
    await importFromJuiceSsh(store);
    setBusy(false);
  };

  return (
    <>
      <Row
        icon="⇪"
        title={busy ? 'Importando…' : 'Importar de Xshell'}
        sub="Máquinas, grupos, claves y contraseñas (.xts, .zip, .xsh, OpenSSH/.pem)"
        disabled={busy}
        onPress={importXshell}
      />
      {juiceInstalled && (
        <Row
          icon="⇪"
          title="Importar de JuiceSSH"
          sub="Máquinas y grupos de JuiceSSH (su API no expone claves ni contraseñas)"
          disabled={busy}
          onPress={importJuice}
        />
      )}

      <Modal
        visible={!!xMaster}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) {
            setXMaster(null);
          }
        }}
      >
        <View style={local.backdrop}>
          <View style={local.dialog}>
            <Text style={styles.rowTitle}>Contraseña maestra de Xshell</Text>
            <Text style={styles.rowSub}>
              {xMaster?.count} sesiones traen la contraseña cifrada. Escribe la
              contraseña maestra que usas en Xshell para descifrarlas. No se
              guarda; solo se usa aquí.
            </Text>
            <Field
              label="Contraseña maestra"
              value={xMaster?.pw ?? ''}
              onChangeText={pw =>
                setXMaster(m => (m ? { ...m, pw, error: undefined } : m))
              }
              secureTextEntry
              autoFocus
            />
            {xMaster?.error && <Text style={styles.error}>{xMaster.error}</Text>}
            <Button
              title={busy ? 'Descifrando…' : 'Descifrar e importar'}
              disabled={busy || !xMaster?.pw}
              onPress={runXMaster}
            />
            <Button
              title="Importar sin contraseñas"
              kind="secondary"
              disabled={busy}
              onPress={skipXMaster}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function Row({
  icon,
  title,
  sub,
  disabled,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        local.card,
        local.line,
        pressed && local.pressed,
        disabled && local.dim,
      ]}
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
  icon: { fontSize: 20, width: 28, textAlign: 'center' },
  chev: { color: colors.muted, fontSize: 22 },
  pressed: { backgroundColor: colors.surface2 },
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
    gap: 6,
  },
});
