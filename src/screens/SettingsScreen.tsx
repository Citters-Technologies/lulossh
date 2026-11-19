import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '../ui/Text';
import * as Application from 'expo-application';
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
import { ImportSection } from './ImportSection';
import {
  DEFAULT_THEME_ID,
  TERM_THEME_PREF,
  TERM_THEMES,
  themeById,
} from '../terminal/themes';
import {
  DEFAULT_FONT,
  fontName,
  TERM_FONT_PREF,
  TERM_FONTS,
  TERM_RENDERER_PREF,
} from '../terminal/font';
import {
  APP_THEME_PREF,
  AppThemeMode,
  appThemeMode,
  Button,
  colors,
  Field,
  Header,
  Segmented,
  styles,
} from '../ui/kit';

const APP_THEME_OPTIONS: { value: AppThemeMode; label: string }[] = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
];

const REPO = 'https://github.com/Citters-Technologies/lulossh';
const LOGO = require('../../assets/logo/lulossh-icon.png');

/** Ancho mínimo (dp) para el diseño de dos paneles. */
const WIDE_MIN = 720;

interface SettingsSection {
  id: string;
  icon: string;
  title: string;
  body: React.ReactNode;
}

/** "Versión 0.1.0 (compilación 1)", leída del binario instalado. */
function versionLabel(): string {
  const v = Application.nativeApplicationVersion;
  const b = Application.nativeBuildVersion;
  if (!v) {
    return 'Versión desconocida';
  }
  return b ? `Versión ${v} (compilación ${b})` : `Versión ${v}`;
}

export function SettingsScreen({
  store,
  onBack,
  onEditKeyBar,
  onLicenses,
  onLockChange,
}: {
  store: Store;
  onBack(): void;
  onEditKeyBar(): void;
  onLicenses(): void;
  onLockChange(s: LockSettings): void;
}) {
  const [lock, setLock] = useState<LockSettings | null>(null);
  // En pantallas anchas (tablet, móvil plegable abierto) va en dos paneles.
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_MIN;
  const [current, setCurrent] = useState('appearance');
  const [pw, setPw] = useState<{
    mode: 'export' | 'restore';
    a: string;
    b: string;
    file?: string;
  } | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [themePicker, setThemePicker] = useState(false);
  useEffect(() => {
    Ssh.prefGet(TERM_THEME_PREF)
      .then(v => v && setThemeId(v))
      .catch(() => {});
  }, []);
  const chooseTheme = (id: string) => {
    setThemeId(id);
    setThemePicker(false);
    Ssh.prefSet(TERM_THEME_PREF, id).catch(() => {});
  };
  const [fontId, setFontId] = useState(DEFAULT_FONT);
  const [fontPicker, setFontPicker] = useState(false);
  useEffect(() => {
    Ssh.prefGet(TERM_FONT_PREF)
      .then(v => v && setFontId(v))
      .catch(() => {});
  }, []);
  // Dibujo con GPU (WebGL): más fluido y gasta menos; DOM por si falla.
  const [gpu, setGpu] = useState(true);
  useEffect(() => {
    Ssh.prefGet(TERM_RENDERER_PREF)
      .then(v => setGpu(v !== 'dom'))
      .catch(() => {});
  }, []);
  const toggleGpu = (on: boolean) => {
    setGpu(on);
    Ssh.prefSet(TERM_RENDERER_PREF, on ? 'gpu' : 'dom').catch(() => {});
  };
  const chooseFont = (id: string) => {
    setFontId(id);
    setFontPicker(false);
    Ssh.prefSet(TERM_FONT_PREF, id).catch(() => {});
  };

  // Modo claro/oscuro: los estilos se crean al arrancar, así que aplicarlo
  // exige reiniciar la interfaz (y eso cierra las sesiones abiertas).
  const [appTheme, setAppTheme] = useState<AppThemeMode>(appThemeMode);
  const chooseAppTheme = async (mode: AppThemeMode) => {
    if (mode === appTheme) {
      return;
    }
    setAppTheme(mode);
    await Ssh.prefSet(APP_THEME_PREF, mode).catch(() => {});
    if (mode === appThemeMode) {
      return; // vuelve al que está aplicado: nada que reiniciar
    }
    const open = (await Ssh.listSessions().catch(() => [])).length;
    if (!open) {
      Ssh.reloadUi();
      return;
    }
    Alert.alert(
      'Reiniciar la interfaz',
      `Para aplicar el modo hay que reiniciar la interfaz, y eso cierra ${
        open === 1 ? 'la sesión abierta' : `las ${open} sesiones abiertas`
      }.`,
      [
        { text: 'Más tarde', style: 'cancel' },
        { text: 'Reiniciar ahora', onPress: () => Ssh.reloadUi() },
      ],
    );
  };

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

  const sections: SettingsSection[] = [
    {
      id: 'appearance',
      icon: '🌓',
      title: 'Apariencia',
      body: (
        <>
          <View style={local.card}>
            <View style={local.line}>
              <Text style={local.icon}>🌓</Text>
              <View style={local.lineText}>
                <Text style={local.title}>Modo de la app</Text>
                <Text style={local.sub}>
                  Colores de las pantallas. Los de la consola, más abajo en
                  Terminal.
                </Text>
              </View>
            </View>
            <View style={local.gap}>
              <Segmented
                value={appTheme}
                onChange={chooseAppTheme}
                options={APP_THEME_OPTIONS}
              />
            </View>
          </View>
          <Text style={local.subhead}>Terminal</Text>
          <Item
            icon="🎨"
            title="Tema de color"
            sub={`Colores de la consola · ${themeById(themeId).name}`}
            onPress={() => setThemePicker(true)}
          />
          <Item
            icon="🔤"
            title="Fuente"
            sub={fontName(fontId)}
            onPress={() => setFontPicker(true)}
          />
          <View style={local.card}>
            <View style={local.line}>
              <Text style={local.icon}>⚡</Text>
              <View style={local.lineText}>
                <Text style={local.title}>Dibujo con GPU</Text>
                <Text style={local.sub}>
                  Más fluido y gasta menos batería con mucha salida. Desactívalo
                  solo si ves fallos al pintar. Se aplica a sesiones nuevas.
                </Text>
              </View>
              <Switch value={gpu} onValueChange={toggleGpu} />
            </View>
          </View>
          <Item
            icon="⌨️"
            title="Botonera de teclas"
            sub="Añade, quita y ordena las teclas de encima del teclado"
            onPress={onEditKeyBar}
          />
        </>
      ),
    },
    {
      id: 'security',
      icon: '🔐',
      title: 'Seguridad',
      body: (
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
      ),
    },
    {
      id: 'data',
      icon: '💾',
      title: 'Copias e importación',
      body: (
        <>
          <Text style={local.subheadFirst}>Copia de seguridad</Text>
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
          <Text style={local.subhead}>Importar</Text>
          <ImportSection store={store} />
        </>
      ),
    },
    {
      id: 'about',
      icon: '🍊',
      title: 'Acerca de',
      body: (
        <>
          <View style={[local.card, local.about]}>
            <Image source={LOGO} style={local.aboutLogo} />
            <Text style={local.aboutName}>
              Lulo<Text style={local.aboutAccent}>SSH</Text>
            </Text>
            <Text style={local.sub}>{versionLabel()}</Text>
            <Text style={[local.sub, local.aboutText]}>
              Cliente SSH de código abierto para Android e iOS.
            </Text>
            <Text style={[local.sub, local.aboutText]}>
              © Citters Technologies SLU · AGPL-3.0
            </Text>
          </View>
          <Item
            icon="🐙"
            title="Código fuente"
            sub="github.com/Citters-Technologies/lulossh"
            onPress={() => Linking.openURL(REPO)}
          />
          <Item
            icon="⚖️"
            title="Componentes y licencias"
            sub="Librerías de terceros que incluye la app y sus licencias"
            onPress={onLicenses}
          />
          <Item
            icon="✉️"
            title="Contacto"
            sub="hola@citters.com"
            onPress={() => Linking.openURL('mailto:hola@citters.com')}
          />
        </>
      ),
    },
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <Header title="Ajustes" left={{ label: '‹ Volver', onPress: onBack }} />
      {wide ? (
        // Tablet: menú de secciones a la izquierda y su contenido a la derecha,
        // como los Ajustes del sistema.
        <View style={local.split}>
          <ScrollView style={local.menu} contentContainerStyle={local.menuBody}>
            {sections.map(sec => {
              const on = sec.id === current;
              return (
                <Pressable
                  key={sec.id}
                  onPress={() => setCurrent(sec.id)}
                  style={({ pressed }) => [
                    local.menuItem,
                    on && local.menuItemOn,
                    pressed && local.pressed,
                  ]}
                >
                  <Text style={local.icon}>{sec.icon}</Text>
                  <Text
                    style={[local.menuText, on && local.menuTextOn]}
                    numberOfLines={1}
                  >
                    {sec.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView
            key={current}
            style={local.detail}
            contentContainerStyle={local.detailBody}
          >
            {sections
              .filter(sec => sec.id === current)
              .map(sec => (
                <View key={sec.id}>
                  <Text style={local.detailTitle}>{sec.title}</Text>
                  {sec.body}
                </View>
              ))}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {sections.map(sec => (
            <View key={sec.id}>
              <Text style={styles.section}>{sec.title}</Text>
              {sec.body}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={fontPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setFontPicker(false)}
      >
        <View style={local.backdrop}>
          <View style={local.dialog}>
            <Text style={local.title}>Fuente de la consola</Text>
            <Text style={local.sub}>Se aplica al abrir una sesión nueva.</Text>
            {TERM_FONTS.map(f => {
              const on = f.id === fontId;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => chooseFont(f.id)}
                  style={({ pressed }) => [
                    local.themeRow,
                    on && local.themeRowOn,
                    pressed && local.pressed,
                  ]}
                >
                  <View style={local.lineText}>
                    <Text style={local.themeName}>{f.name}</Text>
                    <Text style={local.sub}>{f.sub}</Text>
                  </View>
                  {on && <Text style={local.themeCheck}>✓</Text>}
                </Pressable>
              );
            })}
            <Button
              title="Cerrar"
              kind="secondary"
              onPress={() => setFontPicker(false)}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={themePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setThemePicker(false)}
      >
        <View style={local.backdrop}>
          <View style={[local.dialog, local.themeDialog]}>
            <Text style={local.title}>Tema de color</Text>
            <Text style={local.sub}>Se aplica al abrir una sesión nueva.</Text>
            <ScrollView style={local.themeList}>
              {TERM_THEMES.map(t => {
                const on = t.id === themeId;
                const c = t.colors;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => chooseTheme(t.id)}
                    style={({ pressed }) => [
                      local.themeRow,
                      on && local.themeRowOn,
                      pressed && local.pressed,
                    ]}
                  >
                    <View
                      style={[local.swatch, { backgroundColor: c.background }]}
                    >
                      <Text style={[local.swText, { color: c.green }]}>$</Text>
                      <Text style={[local.swText, { color: c.foreground }]}>
                        A
                      </Text>
                      <Text style={[local.swText, { color: c.blue }]}>n</Text>
                      <View
                        style={[local.swCursor, { backgroundColor: c.cursor }]}
                      />
                    </View>
                    <Text style={local.themeName}>{t.name}</Text>
                    {on && <Text style={local.themeCheck}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button
              title="Cerrar"
              kind="secondary"
              onPress={() => setThemePicker(false)}
            />
          </View>
        </View>
      </Modal>

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
              title={
                busy
                  ? 'Un momento…'
                  : pw?.mode === 'export'
                  ? 'Exportar'
                  : 'Restaurar'
              }
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
      style={({ pressed }) => [
        local.card,
        local.line,
        pressed && local.pressed,
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
  title: { color: colors.strong, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  gap: { marginTop: 12, marginBottom: 6 },
  subhead: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  subheadFirst: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
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
  themeDialog: { maxHeight: '80%' },
  themeList: { marginVertical: 8 },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  themeRowOn: { backgroundColor: colors.surface2 },
  swatch: {
    width: 56,
    height: 34,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: '#0006',
  },
  swText: { fontSize: 14, fontWeight: '700' },
  swCursor: { width: 7, height: 16, borderRadius: 1, marginLeft: 2 },
  themeName: { flex: 1, color: colors.strong, fontSize: 15, fontWeight: '600' },
  themeCheck: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  split: { flex: 1, flexDirection: 'row' },
  menu: {
    width: 280,
    flexGrow: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.surface2,
  },
  menuBody: { padding: 12, gap: 2 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  menuItemOn: { backgroundColor: colors.surface },
  menuText: { flex: 1, color: colors.text, fontSize: 16 },
  menuTextOn: { color: colors.strong, fontWeight: '700' },
  detail: { flex: 1 },
  detailBody: { padding: 24, maxWidth: 760 },
  detailTitle: {
    color: colors.strong,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 16,
  },
  about: { alignItems: 'center', paddingVertical: 24 },
  aboutLogo: { width: 96, height: 96, marginBottom: 12 },
  aboutName: { color: colors.strong, fontSize: 26, fontWeight: '800' },
  aboutAccent: { color: colors.brand },
  aboutText: { textAlign: 'center', marginTop: 6 },
});
