import { parseJuice } from '../src/import/juicessh';
import { planImport } from '../src/import/merge';
import type { Host } from '../src/store/models';

const data = {
  connections: [
    { id: 'c1', name: 'web', nickname: 'web', address: '10.0.0.1', port: '22', type: '0' },
    { id: 'c2', name: 'pi', nickname: '', address: 'pi@192.168.1.5', port: '2222', type: '1' },
    { id: 'c3', name: 'router', nickname: 'router', address: '10.0.0.254', port: '23', type: '3' },
    { id: 'c4', name: '', nickname: '', address: '', port: '22', type: '0' },
  ],
  groups: [
    { id: 'g1', name: 'Prod' },
    { id: 'g2', name: 'Casa' },
  ],
  memberships: [
    { group_id: 'g1', connection_id: 'c1' },
    { group_id: 'g2', connection_id: 'c2' },
    { group_id: 'g1', connection_id: 'c2' },
  ],
};

test('conexiones SSH/mosh con grupo; usuario si viene en la dirección', () => {
  const r = parseJuice(data);
  expect(r.hosts).toEqual([
    { name: 'web', host: '10.0.0.1', port: 22, username: '', group: 'JuiceSSH/Prod' },
    { name: 'pi', host: '192.168.1.5', port: 2222, username: 'pi', group: 'JuiceSSH/Casa' },
  ]);
  expect(r.skipped).toHaveLength(2); // telnet y sin dirección
});

test('sin usuario, no duplica un host que ya existe en ese destino', () => {
  const existing: Host = {
    id: 'e',
    name: 'web (xshell)',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    auth: { type: 'password', password: 'x' },
    group: 'Prod',
  };
  const plan = planImport([existing], [], parseJuice(data).hosts, () => 'n');
  expect(plan.toAdd.map(h => h.name)).toEqual(['pi']);
  expect(plan.duplicates).toBe(1);
});
