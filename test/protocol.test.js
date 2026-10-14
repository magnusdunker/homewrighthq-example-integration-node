// Kører integrationen som et rigtigt program og spiller TheHome over stdin og stdout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intervalOf } from '../src/counter.js';

/** En falsk TheHome: svarer på integrationens kald og husker tilstande. */
function fakeHost(dataDir) {
  const child = spawn(process.execPath, ['src/main.js'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, THEHOME_DATA_DIR: dataDir } });
  const states = new Map();
  const services = [];
  const events = [];
  const pending = new Map();
  let nextId = 1;
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');

  createInterface({ input: child.stdout }).on('line', (line) => {
    const m = JSON.parse(line);
    if (!m.method) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      p?.(m);
      return;
    }
    const p = m.params ?? {};
    let result = null;
    switch (m.method) {
      case 'device/register':
        result = { id: 'dev1', name: p.device.name };
        break;
      case 'entity/add':
        result = { entity_id: `${p.entity.domain}.${p.entity.unique_id.split('-').pop()}` };
        break;
      case 'state/set':
        states.set(p.entity_id, p.state);
        break;
      case 'service/register':
        services.push(p.service);
        break;
      case 'event/fire':
        events.push(p.event_type);
        break;
    }
    send({ jsonrpc: '2.0', id: m.id, result });
  });

  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      send({ jsonrpc: '2.0', id, method, params });
    });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { child, call, send, states, services, events, exited, stderr: () => stderr };
}

test('interval comes from options first', () => {
  assert.equal(intervalOf({ data: { interval: 5 }, options: { interval: 2 } }), 2);
  assert.equal(intervalOf({ data: { interval: 5 }, options: {} }), 5);
  assert.equal(intervalOf({ data: {} }), 10);
  assert.equal(intervalOf({ data: { interval: 99999 } }), 3600);
});

test('flow, setup, services and shutdown over the protocol', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-'));
  const h = fakeHost(dir);

  assert.deepEqual((await h.call('initialize', { api_version: 1, data_dir: dir })).result, { api_version: 1 });

  let r = await h.call('config_flow', { flow: { flow_id: 'f', source: 'user', data: {} }, step: 'user', input: null });
  assert.equal(r.result.result.type, 'form');
  r = await h.call('config_flow', { flow: { flow_id: 'f', source: 'user', data: {} }, step: 'user', input: { name: ' ', interval: 3 } });
  assert.deepEqual(r.result.result.errors, { name: 'required' });
  r = await h.call('config_flow', { flow: { flow_id: 'f', source: 'user', data: {} }, step: 'user', input: { name: 'Køkken', interval: 3 } });
  assert.equal(r.result.result.type, 'create_entry');
  assert.equal(r.result.unique_id, 'køkken');

  const entry = { entry_id: 'e1', domain: 'example_counter_node', title: 'Køkken', data: { name: 'Køkken', interval: 3 }, options: {} };
  r = await h.call('options_flow', { flow: { flow_id: 'o', source: 'options', data: {}, entry }, step: 'options', input: null });
  assert.equal(r.result.result.schema.properties.interval.default, 3);

  r = await h.call('setup_entry', { entry });
  assert.equal(r.error, undefined);
  assert.equal(h.states.get('sensor.count'), '0');
  assert.equal(h.states.get('switch.running'), 'on');
  assert.deepEqual(h.services, ['set']);

  await h.call('service/call', { entry_id: 'e1', service: 'set', data: { value: 42 }, entity_ids: ['sensor.count'] });
  assert.equal(h.states.get('sensor.count'), '42');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'e1.json'), 'utf8')).count, 42);
  r = await h.call('service/call', { entry_id: 'e1', service: 'set', data: { value: 1 }, entity_ids: [] });
  assert.equal(r.error.data.kind, 'invalid_argument');

  await h.call('entity/call_service', { entry_id: 'e1', entity_id: 'switch.running', service: 'turn_off', data: {} });
  assert.equal(h.states.get('switch.running'), 'off');
  await h.call('entity/call_service', { entry_id: 'e1', entity_id: 'button.reset', service: 'press', data: {} });
  assert.equal(h.states.get('sensor.count'), '0');
  assert.deepEqual(h.events, ['example_counter_node_reset']);
  r = await h.call('entity/call_service', { entry_id: 'e1', entity_id: 'switch.running', service: 'dance', data: {} });
  assert.equal(r.error.data.kind, 'not_supported');

  r = await h.call('diagnostics', { entry });
  assert.deepEqual(r.result, { count: 0, running: false, interval: 3 });
  r = await h.call('nope', {});
  assert.equal(r.error.data.kind, 'not_supported');

  await h.call('unload_entry', { entry_id: 'e1' });
  h.send({ jsonrpc: '2.0', method: 'shutdown' });
  assert.equal(await h.exited, 0);
  assert.match(h.stderr(), /^INFO Køkken tæller hvert 3\. sekund fra 0/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exits when stdin closes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-'));
  const h = fakeHost(dir);
  await h.call('initialize', { api_version: 1, data_dir: dir });
  h.child.stdin.end();
  assert.equal(await h.exited, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
