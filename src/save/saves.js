// Run persistence in IndexedDB. Each run has a metadata record and several
// slots (auto, quick, manual). Writes are verified before commit and happen
// in a single transaction that also preserves the previous version as a
// backup, so a failed save never overwrites a healthy one.
import { STAGES } from '../sim/progress.js';
import { checksum } from './checksum.js';
export { checksum };

const DB_NAME = 'civsim', DB_VER = 1;
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('runs')) d.createObjectStore('runs', { keyPath: 'runId' });
      if (!d.objectStoreNames.contains('slots')) d.createObjectStore('slots', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (stores, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    let out;
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaction aborted'));
    out = fn(t);
  });
};
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const AUTO_SLOTS = ['a0', 'a1', 'a2', 'a3', 'a4'];
export const MANUAL_SLOTS = ['s1', 's2', 's3'];
export const SLOT_NAMES = { auto: 'Autosave', quick: 'Quicksave', s1: 'Slot I', s2: 'Slot II', s3: 'Slot III', recover: 'Recovery', a0: 'Autosave', a1: 'Autosave', a2: 'Autosave', a3: 'Autosave', a4: 'Autosave' };
export const isAuto = slot => slot === 'auto' || AUTO_SLOTS.includes(slot);
export const slotLabel = m => m?.label || SLOT_NAMES[m?.slot] || m?.slot || '';

export function runSummary(game) {
  const p = game.player;
  return {
    runId: game.runId, runName: game.runName, tribe: p.key, observer: game.observer,
    seedText: game.seedText, size: game.sizeKey, difficulty: game.difficulty,
    year: game.year, season: game.seasonName, day: game.day,
    pop: p.pop, stage: STAGES[p.stage].name, techs: p.techs.length, settlements: p.settlements.length, alive: p.alive,
    created: game.created, lastPlayed: Date.now(),
  };
}

// `game` supplies the run summary (the main-thread mirror is fine). `json` is the
// authoritative serialisation from the simulation worker; when the worker has
// already verified it (`opts.sum` given) the main thread does no parsing at all.
// Autosaves rotate through five slots (a0–a4); a rotating slot needs no backup
// copy because the previous autosaves are themselves the backups. Manual,
// quick and recovery saves keep the previous version as `|bak`.
export async function saveGame(game, slot = 'auto', thumb = null, json = null, opts = {}) {
  if (!json) json = JSON.stringify(game.serialize());
  let sum = opts.sum;
  if (!sum) {
    const parsed = JSON.parse(json);
    if (!parsed.tribes || parsed.tribes.length !== 4 || !parsed.world?.trees) throw new Error('Save verification failed');
    sum = checksum(json);
  }
  const rotating = slot === 'auto';
  return tx(['runs', 'slots'], 'readwrite', t => {
    const slots = t.objectStore('slots'), runs = t.objectStore('runs');
    const result = {};
    const getRun = runs.get(game.runId);
    getRun.onsuccess = () => {
      const prev = getRun.result || {};
      const real = rotating ? AUTO_SLOTS[(prev.autoNext || 0) % AUTO_SLOTS.length] : slot;
      const label = opts.label ?? (rotating ? null : prev.slots?.[real]?.label) ?? null;
      const meta = { ...runSummary(game), slot: real, label, savedAt: Date.now(), bytes: json.length, v: opts.v ?? null, sum };
      Object.assign(result, meta);
      const key = `${game.runId}|${real}`;
      if (!rotating && real !== 'recover') {
        const getOld = slots.get(key);
        getOld.onsuccess = () => { if (getOld.result) slots.put({ ...getOld.result, key: key + '|bak' }); slots.put({ key, runId: game.runId, slot: real, meta, json }); };
      } else slots.put({ key, runId: game.runId, slot: real, meta, json });
      const slotsMeta = { ...(prev.slots || {}), [real]: meta };
      if (rotating) delete slotsMeta.auto; // legacy single autosave superseded by the rotation
      runs.put({ ...prev, ...runSummary(game), thumb: thumb || prev.thumb || null, autoNext: rotating ? ((prev.autoNext || 0) + 1) % AUTO_SLOTS.length : (prev.autoNext || 0), slots: slotsMeta });
    };
    return result;
  });
}

export async function listRuns() {
  const r = await tx(['runs'], 'readonly', t => req(t.objectStore('runs').getAll()));
  return (r || []).sort((a, b) => b.lastPlayed - a.lastPlayed);
}
export async function getRun(runId) { return tx(['runs'], 'readonly', t => req(t.objectStore('runs').get(runId))); }

const getRec = key => tx(['slots'], 'readonly', t => req(t.objectStore('slots').get(key)));
function intact(rec) {
  if (!rec || typeof rec.json !== 'string') return false;
  if (rec.meta?.sum && checksum(rec.json) !== rec.meta.sum) return false;
  try { const d = JSON.parse(rec.json); return !!(d && d.world && d.tribes); } catch { return false; }
}

// Returns { json, meta, fallback } — fallback names the copy used when the
// requested save was damaged (its backup, or the next most recent autosave).
export async function loadSlot(runId, slot) {
  const rec = await getRec(`${runId}|${slot}`);
  if (!rec && slot !== 'auto') throw new Error('Save slot is empty');
  if (intact(rec)) return { json: rec.json, meta: rec.meta, fallback: null };
  const bak = await getRec(`${runId}|${slot}|bak`);
  if (intact(bak)) return { json: bak.json, meta: bak.meta, fallback: 'its previous version' };
  const run = await getRun(runId);
  const others = Object.values(run?.slots || {}).filter(m => m.slot !== slot).sort((a, b) => b.savedAt - a.savedAt);
  for (const m of others) {
    const r = await getRec(`${runId}|${m.slot}`);
    if (intact(r)) return { json: r.json, meta: r.meta, fallback: slotLabel(m) + ' from ' + new Date(m.savedAt).toLocaleString() };
  }
  throw new Error('Every save of this run is damaged');
}

export async function latestSlot(run) {
  const s = Object.values(run.slots || {}).sort((a, b) => b.savedAt - a.savedAt)[0];
  return s?.slot || 'auto';
}

export async function deleteRun(runId) {
  const run = await getRun(runId);
  const keys = new Set([...Object.keys(SLOT_NAMES), ...Object.keys(run?.slots || {})]);
  await tx(['runs', 'slots'], 'readwrite', t => {
    t.objectStore('runs').delete(runId);
    const s = t.objectStore('slots');
    for (const slot of keys) { s.delete(`${runId}|${slot}`); s.delete(`${runId}|${slot}|bak`); }
  });
}

// Drops the recovery save once a normal save supersedes it.
export async function clearRecovery(runId) {
  await tx(['runs', 'slots'], 'readwrite', t => {
    t.objectStore('slots').delete(`${runId}|recover`);
    const runs = t.objectStore('runs'); const g = runs.get(runId);
    g.onsuccess = () => { if (g.result?.slots?.recover) { const slots = { ...g.result.slots }; delete slots.recover; runs.put({ ...g.result, slots }); } };
  });
}

export async function renameRun(runId, name) {
  await tx(['runs'], 'readwrite', t => {
    const s = t.objectStore('runs'); const g = s.get(runId);
    g.onsuccess = () => { if (g.result) s.put({ ...g.result, runName: name }); };
  });
}

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'civsim.settings';
export const DEFAULT_SETTINGS = {
  master: 0.8, music: 0.5, sfx: 0.7, ambience: 0.6, ui: 0.6,
  quality: 'high', lighting: true, particles: true, animations: true, territory: true, uiScale: 1,
  inputMode: null, camSpeed: 1, edgePan: false, autosaveMin: 3, pauseOnEvent: true, defaultSpeed: 1, hudHidden: [], colorblind: false, hints: true, hintsSeen: [],
};
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function storeSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
