/** Preferencias del bloqueo de la app (huella / PIN del sistema). No sensibles. */
import { Ssh } from '../native/SshModule';

export const LOCK_PREF = 'appLock'; // 'on' | 'off' (por defecto: on)
export const LOCK_AFTER_PREF = 'appLockAfter'; // segundos en segundo plano

export const LOCK_AFTER_OPTIONS = [
  { value: '0', label: 'Siempre' },
  { value: '60', label: '1 min' },
  { value: '300', label: '5 min' },
  { value: '900', label: '15 min' },
] as const;

export interface LockSettings {
  enabled: boolean;
  afterSec: number;
}

export async function loadLockSettings(): Promise<LockSettings> {
  const [on, after] = await Promise.all([
    Ssh.prefGet(LOCK_PREF).catch(() => null),
    Ssh.prefGet(LOCK_AFTER_PREF).catch(() => null),
  ]);
  return {
    enabled: on !== 'off',
    afterSec: after != null && !isNaN(Number(after)) ? Number(after) : 60,
  };
}

/** ¿Hay que bloquear al volver tras `elapsedMs` en segundo plano? */
export const shouldRelock = (s: LockSettings, elapsedMs: number) =>
  s.enabled && elapsedMs >= s.afterSec * 1000;
