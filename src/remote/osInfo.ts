/**
 * Sistema operativo del servidor, leído al conectar por un canal aparte
 * (no se ve en la terminal): ID de /etc/os-release o, si no hay, `uname -s`.
 */

const MARK = 'LULO_OS:';

export function osCommand(): string {
  return (
    `(. /etc/os-release 2>/dev/null && echo "${MARK}$ID") || ` +
    `echo "${MARK}$(uname -s 2>/dev/null)"`
  );
}

/** Id normalizado ("ubuntu", "debian", "darwin"…) o undefined. */
export function parseOs(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l.startsWith(MARK));
  const id = line
    ?.slice(MARK.length)
    .replace(/["']/g, '')
    .trim()
    .toLowerCase();
  return id || undefined;
}

export interface OsBadge {
  label: string;
  color: string;
  name: string;
}

// Colores de marca aproximados; siglas en vez de logos (marcas registradas).
const BADGES: Record<string, OsBadge> = {
  ubuntu: { label: 'UB', color: '#E95420', name: 'Ubuntu' },
  debian: { label: 'DEB', color: '#D70751', name: 'Debian' },
  raspbian: { label: 'Pi', color: '#C51A4A', name: 'Raspberry Pi OS' },
  centos: { label: 'CE', color: '#A14F8C', name: 'CentOS' },
  rhel: { label: 'RH', color: '#EE0000', name: 'Red Hat' },
  rocky: { label: 'RK', color: '#10B981', name: 'Rocky Linux' },
  almalinux: { label: 'AL', color: '#4FA3E0', name: 'AlmaLinux' },
  fedora: { label: 'FE', color: '#51A2DA', name: 'Fedora' },
  alpine: { label: 'AP', color: '#2C8EBB', name: 'Alpine' },
  arch: { label: 'AR', color: '#1793D1', name: 'Arch' },
  manjaro: { label: 'MJ', color: '#35BF5C', name: 'Manjaro' },
  opensuse: { label: 'SU', color: '#73BA25', name: 'openSUSE' },
  'opensuse-leap': { label: 'SU', color: '#73BA25', name: 'openSUSE' },
  sles: { label: 'SU', color: '#30BA78', name: 'SUSE' },
  amzn: { label: 'AWS', color: '#FF9900', name: 'Amazon Linux' },
  ol: { label: 'OL', color: '#F80000', name: 'Oracle Linux' },
  linuxmint: { label: 'MT', color: '#87CF3E', name: 'Linux Mint' },
  kali: { label: 'KA', color: '#557C94', name: 'Kali' },
  nixos: { label: 'NX', color: '#7EBAE4', name: 'NixOS' },
  gentoo: { label: 'GE', color: '#9A8FD8', name: 'Gentoo' },
  freebsd: { label: 'BSD', color: '#AB2B28', name: 'FreeBSD' },
  openbsd: { label: 'BSD', color: '#F2CA30', name: 'OpenBSD' },
  darwin: { label: 'MAC', color: '#A2AAAD', name: 'macOS' },
  linux: { label: '🐧', color: '#F5C518', name: 'Linux' },
};

export function osBadge(os?: string): OsBadge | undefined {
  if (!os) {
    return undefined;
  }
  return BADGES[os] ?? { label: '🐧', color: '#F5C518', name: os };
}
