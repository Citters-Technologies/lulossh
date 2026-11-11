/** Diálogos comunes a las importaciones (Xshell, JuiceSSH). */
import { expectExternalActivity } from '../ui/appLock';
import { Alert, PermissionsAndroid } from 'react-native';
import { Ssh } from '../native/SshModule';
import type { Store } from '../store/useStore';
import { parseJuice } from './juicessh';

export const confirmUpdates = (
  updates: { name: string; changes: string[] }[],
): Promise<boolean> =>
  new Promise(resolve => {
    const list = updates
      .slice(0, 10)
      .map(u => `• ${u.name}: ${u.changes.join(', ')}`)
      .join('\n');
    const more = updates.length > 10 ? `\n… y ${updates.length - 10} más` : '';
    Alert.alert(
      'Completar hosts existentes',
      `${updates.length} hosts que ya tenías están incompletos y la importación trae lo que les falta:\n\n${list}${more}\n\n¿Actualizarlos?`,
      [
        { text: 'No', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Actualizar', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });

type Summary = Awaited<ReturnType<Store['importBatch']>>;

export function showSummary(title: string, r: Summary, extra?: string) {
  const lines = [
    `${r.hosts} hosts nuevos${r.keys ? `, ${r.keys} claves nuevas` : ''}.`,
    r.updated ? `${r.updated} hosts completados.` : '',
    r.duplicates ? `${r.duplicates} hosts ya existían.` : '',
    r.incomplete
      ? `${r.incomplete} hosts sin usuario o credenciales (⚠): al tocarlos se abre el editor.`
      : '',
    extra ?? '',
    ...r.notes.slice(0, 12),
    r.notes.length > 12 ? `… y ${r.notes.length - 12} avisos más` : '',
  ].filter(Boolean);
  Alert.alert(title, lines.join('\n'));
}

const JUICE_PERMS = [
  'com.sonelli.juicessh.api.v1.permission.READ_CONNECTIONS',
  'com.sonelli.juicessh.api.v1.permission.READ_CONNECTION_GROUPS',
] as const;

/** Importa conexiones y grupos de JuiceSSH. Devuelve false si no se pudo. */
export async function importFromJuiceSsh(store: Store): Promise<boolean> {
  try {
    expectExternalActivity();
      const res = await PermissionsAndroid.requestMultiple(JUICE_PERMS as any);
    if ((res as any)[JUICE_PERMS[0]] !== 'granted') {
      Alert.alert(
        'Sin permiso',
        'JuiceSSH no ha dado permiso para leer sus conexiones. Si instalaste ' +
          'JuiceSSH después de LuloSSH, desinstala y vuelve a instalar LuloSSH ' +
          '(Android solo concede estos permisos si JuiceSSH ya estaba).',
      );
      return false;
    }
    const parsed = parseJuice(await Ssh.readJuiceSsh());
    if (!parsed.hosts.length) {
      Alert.alert('JuiceSSH', 'No se encontraron conexiones SSH.');
      return false;
    }
    const r = await store.importBatch(parsed, confirmUpdates);
    showSummary(
      'Importación de JuiceSSH',
      r,
      'JuiceSSH no comparte usuarios ni claves: complétalos al conectar, ' +
        'reimporta desde Xshell o importa tus claves desde Claves.',
    );
    return true;
  } catch (e: any) {
    Alert.alert('Error al importar de JuiceSSH', e?.message ?? String(e));
    return false;
  }
}
