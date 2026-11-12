import React from 'react';
import {
  Appearance,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

/**
 * Modo de color de la app. Los estilos se crean al cargar los módulos, así
 * que el modo se lee de forma síncrona al arrancar (constante del módulo
 * nativo) y cambiarlo requiere reiniciar la interfaz.
 */
export type AppThemeMode = 'dark' | 'light' | 'system';
export const APP_THEME_PREF = 'appTheme';
export const DEFAULT_APP_THEME: AppThemeMode = 'dark';

function readMode(): AppThemeMode {
  try {
    const m = NativeModules.LuloSsh;
    const v = (m?.getConstants?.() ?? m)?.appTheme;
    if (v === 'dark' || v === 'light' || v === 'system') {
      return v;
    }
  } catch {}
  return DEFAULT_APP_THEME;
}

export const appThemeMode = readMode();
export const isLight =
  appThemeMode === 'light' ||
  (appThemeMode === 'system' && Appearance.getColorScheme() === 'light');

const DARK = {
  bg: '#0b0f14',
  surface: '#161c24',
  surface2: '#242d38',
  text: '#d7dde5',
  muted: '#8fa1b3',
  accent: '#3b82f6',
  danger: '#ef4444',
  /** Títulos y texto destacado. */
  strong: '#ffffff',
  /** Pistas, placeholders, iconos apagados. */
  faint: '#5b6b7c',
  /** Verde de marca ("SSH" del logo). */
  brand: '#9be22d',
  /** Fondo de elemento seleccionado. */
  selected: '#1d3557',
  dangerBg: '#3b1d1d',
  dangerText: '#ff7b72',
  pressed: '#35414f',
  link: '#7fb0ff',
  warn: '#f59e0b',
  success: '#22c55e',
  /** Texto sobre botones de color (accent, danger). */
  onAccent: '#ffffff',
};

const LIGHT: typeof DARK = {
  bg: '#f2f4f7',
  surface: '#ffffff',
  surface2: '#e3e8ef',
  text: '#1f2933',
  muted: '#5f6f80',
  accent: '#2563eb',
  danger: '#dc2626',
  strong: '#0b0f14',
  faint: '#8a97a6',
  brand: '#4d8a0c',
  selected: '#dbe7ff',
  dangerBg: '#fde2e2',
  dangerText: '#c62828',
  pressed: '#cbd5e1',
  link: '#1d5fd1',
  warn: '#d97706',
  success: '#16a34a',
  onAccent: '#ffffff',
};

export const colors = isLight ? LIGHT : DARK;

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.faint}
        {...input}
        style={[styles.input, input.multiline && styles.multiline, input.style]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
}: {
  title: string;
  onPress(): void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'danger' && styles.btnDanger,
        (pressed || disabled) && styles.btnDim,
      ]}
    >
      <Text style={styles.btnText}>{title}</Text>
    </Pressable>
  );
}

export function Header({
  title,
  left,
  right,
}: {
  title: string;
  left?: { label: string; onPress(): void };
  right?: { label: string; onPress(): void };
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerSide} onPress={left?.onPress}>
        {left?.label ?? ''}
      </Text>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text
        style={[styles.headerSide, styles.headerRight]}
        onPress={right?.onPress}
      >
        {right?.label ?? ''}
      </Text>
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map(o => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[styles.segment, o.value === value && styles.segmentOn]}
        >
          <Text style={styles.segmentText}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16 },
  field: { marginBottom: 12 },
  label: { color: colors.muted, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnSecondary: { backgroundColor: colors.surface2 },
  btnDanger: { backgroundColor: colors.danger },
  btnDim: { opacity: 0.5 },
  btnText: { color: colors.onAccent, fontWeight: '700' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surface2,
  },
  headerTitle: {
    flex: 1,
    color: colors.strong,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSide: { minWidth: 70, color: colors.accent, fontSize: 15 },
  headerRight: { textAlign: 'right' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
  },
  segment: { flex: 1, padding: 8, borderRadius: 6, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.surface2 },
  segmentText: { color: colors.text },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowTitle: { color: colors.strong, fontSize: 16, fontWeight: '600' },
  rowSub: { color: colors.muted, marginTop: 2 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
  error: { color: colors.danger, marginBottom: 12 },
  section: {
    color: colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 6,
  },
});
