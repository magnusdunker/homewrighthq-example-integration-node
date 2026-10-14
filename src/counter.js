// Eksempel-tæller (Node): en ekstern integration til TheHome.
//
// Hver opsætning får en enhed med
// - en sensor, der tæller én op med et fast interval,
// - en kontakt, der sætter tælleren på pause,
// - en knap, der nulstiller den.
//
// Den viser også et opsætningsforløb med validering, et options-forløb,
// en tjeneste (`example_counter_node.set`), en hændelse og en fil i
// integrationens datamappe, så tallet overlever en genstart.

import fs from 'node:fs';
import path from 'node:path';
import { flow, log, PluginError } from '../sdk/thehome-plugin.js';

const DOMAIN = 'example_counter_node';
const VERSION = '0.1.0';
/** Hvor tit tællerens stand skrives i TheHomes log (ms). */
const LOG_EVERY = 10_000;

/**
 * @typedef {object} Counter
 * @property {string} name
 * @property {number} count
 * @property {boolean} running
 * @property {string | null} countId
 * @property {string | null} runningId
 * @property {string | null} resetId
 * @property {ReturnType<typeof setInterval> | null} timer
 * @property {ReturnType<typeof setInterval> | null} logTimer
 */

/** @type {Map<string, Counter>} entry_id -> tæller */
const counters = new Map();

const userSchema = (name, interval) => ({
  type: 'object',
  required: ['name', 'interval'],
  properties: {
    name: { type: 'string', title: 'Navn', default: name },
    interval: {
      type: 'integer', title: 'Interval (sekunder)', minimum: 1, maximum: 3600, default: interval,
      description: 'Hvor tit tælleren tæller én op',
    },
  },
});

const optionsSchema = (interval) => ({
  type: 'object',
  required: ['interval'],
  properties: {
    interval: { type: 'integer', title: 'Interval (sekunder)', minimum: 1, maximum: 3600, default: interval },
  },
});

/** Intervallet fra options først, ellers fra data. */
export function intervalOf(entry) {
  const v = Number(entry?.options?.interval ?? entry?.data?.interval ?? 10);
  return Math.min(3600, Math.max(1, Number.isFinite(v) ? Math.floor(v) : 10));
}

const file = (host, entryId) => path.join(host.dataDir, `${entryId}.json`);

function load(host, entryId) {
  try {
    const n = JSON.parse(fs.readFileSync(file(host, entryId), 'utf8')).count;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function save(host, entryId, count) {
  try {
    fs.mkdirSync(host.dataDir, { recursive: true });
    fs.writeFileSync(file(host, entryId), JSON.stringify({ count }));
  } catch (e) {
    log('WARN', `kunne ikke gemme tælleren: ${e.message}`);
  }
}

/** Send tællerens og kontaktens tilstand til TheHome. */
async function publish(host, entryId) {
  const c = counters.get(entryId);
  if (!c) return;
  if (c.countId) await host.setState(c.countId, c.count);
  if (c.runningId) await host.setState(c.runningId, c.running ? 'on' : 'off');
}

async function setCount(host, entryId, value) {
  const c = counters.get(entryId);
  if (!c) throw PluginError.notReady('opsætningen kører ikke');
  c.count = value;
  save(host, entryId, value);
  await publish(host, entryId);
}

async function reset(host, entryId) {
  await setCount(host, entryId, 0);
  const c = counters.get(entryId);
  // en knaps tilstand er tidspunktet for sidste tryk
  if (c?.resetId) await host.setState(c.resetId, new Date().toISOString());
  await host.fireEvent(`${DOMAIN}_reset`, { entry_id: entryId });
}

/**
 * `example_counter_node.set` gælder alle opsætninger; målet afgør hvilken.
 * TheHome knytter tjenesten til den opsætning, der registrerede den.
 */
async function registerSetService(host, entryId) {
  await host.registerService(entryId, 'set', {
    name: 'Sæt tæller',
    description: 'Sætter en tæller til en bestemt værdi',
    target: { entity: { integration: DOMAIN, domain: 'sensor' } },
    fields: {
      value: { name: 'Værdi', required: true, example: 100, selector: { number: { min: 0, max: 1000000 } } },
    },
  });
}

/** @type {import('../sdk/thehome-plugin.js').Integration} */
export const integration = {
  async configFlow(host, f, step, input) {
    if (step !== 'user') throw PluginError.invalid(`ukendt trin ${step}`);
    if (!input) return flow.form('user', userSchema('Tæller', 10));
    const name = String(input.name ?? '').trim();
    const interval = Number.isInteger(input.interval) ? input.interval : 10;
    if (!name) return flow.form('user', userSchema('', interval), { name: 'required' });
    return { ...flow.create(name, { name, interval }), unique_id: name.toLowerCase() };
  },

  async optionsFlow(host, f, step, input) {
    const current = f.entry ? intervalOf(f.entry) : 10;
    if (!input) return flow.form('init', optionsSchema(current));
    const interval = Number.isInteger(input.interval) ? input.interval : current;
    return flow.create('', { interval });
  },

  async setupEntry(host, entry) {
    const id = entry.entry_id;
    const name = entry.data?.name ?? entry.title;
    const interval = intervalOf(entry);

    const device = await host.registerDevice(id, {
      identifiers: [[DOMAIN, id]],
      name,
      manufacturer: 'TheHome',
      model: 'Eksempel-tæller (Node)',
      sw_version: VERSION,
    });
    const countId = await host.addEntity(id, {
      domain: 'sensor', unique_id: `${id}-count`, name: 'Antal', device_id: device,
      icon: 'mdi:counter', state_class: 'total_increasing',
    });
    const runningId = await host.addEntity(id, {
      domain: 'switch', unique_id: `${id}-running`, name: 'Tæller', device_id: device, icon: 'mdi:play-pause',
    }, true);
    const resetId = await host.addEntity(id, {
      domain: 'button', unique_id: `${id}-reset`, name: 'Nulstil', device_id: device, icon: 'mdi:restart',
    }, true);
    await registerSetService(host, id);

    const count = load(host, id);
    /** @type {Counter} */
    const c = { name, count, running: true, countId, runningId, resetId, timer: null, logTimer: null };
    counters.set(id, c);
    if (resetId) await host.setState(resetId, 'unknown');
    await publish(host, id);

    c.timer = setInterval(() => {
      if (!c.running) return;
      c.count += 1;
      save(host, id, c.count);
      if (c.countId) {
        host.setState(c.countId, c.count).catch((e) => log('WARN', `kunne ikke opdatere ${c.countId}: ${e.message}`));
      }
    }, interval * 1000);
    c.logTimer = setInterval(() => {
      log('INFO', `${c.name}: tælleren står på ${c.count} (${c.running ? 'kører' : 'pause'})`);
    }, LOG_EVERY);
    log('INFO', `${name} tæller hvert ${interval}. sekund fra ${count}`);
  },

  async unloadEntry(host, entryId) {
    const c = counters.get(entryId);
    if (c?.timer) clearInterval(c.timer);
    if (c?.logTimer) clearInterval(c.logTimer);
    counters.delete(entryId);
    // TheHome fjerner tjenesten med opsætningen; de andre skal stadig have den
    const other = counters.keys().next().value;
    if (other) await registerSetService(host, other);
  },

  async entityService(host, entryId, entityId, service) {
    const c = counters.get(entryId);
    if (!c) throw PluginError.unavailable(entityId);
    if (entityId === c.runningId && ['turn_on', 'turn_off', 'toggle'].includes(service)) {
      c.running = service === 'turn_on' ? true : service === 'turn_off' ? false : !c.running;
      await publish(host, entryId);
      return;
    }
    if (entityId === c.resetId && service === 'press') {
      await reset(host, entryId);
      return;
    }
    throw PluginError.notSupported(`${service} på ${entityId}`);
  },

  async domainService(host, entryId, service, data, entityIds) {
    if (service !== 'set') throw PluginError.notSupported(service);
    const value = Number(data.value);
    if (data.value === undefined || !Number.isFinite(value)) throw PluginError.invalid('value mangler');
    if (value < 0) throw PluginError.invalid('value skal være 0 eller mere');
    const targets = [...counters].filter(([, c]) => entityIds.includes(c.countId) || entityIds.includes(c.runningId)).map(([id]) => id);
    if (!targets.length) throw PluginError.invalid('vælg en tæller som mål');
    for (const t of targets) await setCount(host, t, Math.floor(value));
    return null;
  },

  async diagnostics(host, entry) {
    const c = counters.get(entry.entry_id);
    return c ? { count: c.count, running: c.running, interval: intervalOf(entry) } : { loaded: false };
  },
};
