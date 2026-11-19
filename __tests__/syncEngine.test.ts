import { LocalState } from '../src/sync/document';
import {
  CloudProvider,
  SyncConflict,
  syncOnce,
  SyncTarget,
} from '../src/sync/engine';

// Cifrado simulado: "sellar" = prefijo + JSON (los secretos los añade nativo).
jest.mock('../src/native/SshModule', () => ({
  Ssh: {
    sealSync: jest.fn(
      async (doc: string, keyIds: string[], pass: string) =>
        `sealed:${pass}:` +
        JSON.stringify({
          ...JSON.parse(doc),
          secrets: Object.fromEntries(
            keyIds.map(id => [id, { pem: `PEM-${id}` }]),
          ),
        }),
    ),
    decryptBackup: jest.fn(async (content: string, pass: string) => {
      const prefix = `sealed:${pass}:`;
      if (!content.startsWith(prefix)) {
        throw Object.assign(new Error('mala'), { code: 'BAD_PASSWORD' });
      }
      return content.slice(prefix.length);
    }),
  },
}));

class MemoryCloud implements CloudProvider {
  readonly id = 'google' as const;
  readonly label = 'Memoria';
  content: string | null = null;
  version = 0;
  /** Simula que otro dispositivo escribe justo antes de la próxima subida. */
  beforeUpload?: () => Promise<unknown> | void;

  async download() {
    return this.content == null
      ? null
      : { content: this.content, etag: String(this.version) };
  }

  async upload(content: string, etag: string | null) {
    const hook = this.beforeUpload;
    this.beforeUpload = undefined;
    await hook?.();
    if (
      (etag ?? null) !== (this.content == null ? null : String(this.version))
    ) {
      throw new SyncConflict();
    }
    this.content = content;
    this.version++;
  }
}

function device(
  initial: Partial<LocalState>,
): SyncTarget & { state: LocalState; imported: string[] } {
  const t = {
    state: {
      hosts: [],
      identities: [],
      keys: [],
      tombstones: [],
      ...initial,
    } as LocalState,
    imported: [] as string[],
    snapshot() {
      return t.state;
    },
    async apply(s: LocalState, secrets: Record<string, { pem: string }>) {
      for (const k of s.keys) {
        if (!t.state.keys.some(x => x.id === k.id) && secrets[k.id]) {
          t.imported.push(k.id);
        }
      }
      t.state = s;
    },
  };
  return t;
}

const host = (id: string, name: string, updatedAt: number) => ({
  id,
  name,
  host: `${id}.example.com`,
  port: 22,
  username: 'root',
  auth: { type: 'password' as const, password: 'x' },
  updatedAt,
});

describe('syncOnce', () => {
  it('sube lo local la primera vez y otro dispositivo lo recibe con sus claves', async () => {
    const cloud = new MemoryCloud();
    const movil = device({
      hosts: [host('a', 'A', 1)],
      keys: [
        {
          id: 'k1',
          name: 'k1',
          type: 'ssh-ed25519',
          publicKey: 'x',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await syncOnce(movil, cloud, 'secreta', 'movil', () => 10);
    const tablet = device({});
    const r = await syncOnce(tablet, cloud, 'secreta', 'tablet', () => 20);
    expect(tablet.state.hosts.map(h => h.name)).toEqual(['A']);
    expect(tablet.imported).toEqual(['k1']);
    expect(r.hosts.added).toBe(1);
  });

  it('con otra contraseña falla sin tocar nada', async () => {
    const cloud = new MemoryCloud();
    await syncOnce(
      device({ hosts: [host('a', 'A', 1)] }),
      cloud,
      'buena',
      'm',
      () => 1,
    );
    const otro = device({});
    await expect(
      syncOnce(otro, cloud, 'mala', 't', () => 2),
    ).rejects.toMatchObject({
      code: 'BAD_PASSWORD',
    });
    expect(otro.state.hosts).toEqual([]);
  });

  it('si otro dispositivo escribe a la vez, fusiona de nuevo y no pierde nada', async () => {
    const cloud = new MemoryCloud();
    await syncOnce(
      device({ hosts: [host('a', 'A', 1)] }),
      cloud,
      'p',
      'm',
      () => 1,
    );
    const tablet = device({ hosts: [host('a', 'A', 1), host('b', 'B', 5)] });
    // Mientras la tablet sincroniza, el móvil sube un host C.
    cloud.beforeUpload = () => {
      const movil = device({ hosts: [host('a', 'A', 1), host('c', 'C', 6)] });
      return syncOnce(movil, cloud, 'p', 'movil', () => 6);
    };
    await syncOnce(tablet, cloud, 'p', 'tablet', () => 7);
    const check = device({});
    await syncOnce(check, cloud, 'p', 'check', () => 8);
    expect(check.state.hosts.map(h => h.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
