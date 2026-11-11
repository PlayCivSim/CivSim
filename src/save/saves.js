// Run persistence in IndexedDB. Each run has a metadata record and several
// slots (auto, quick, manual). Writes are verified before commit and happen
// in a single transaction that also preserves the previous version as a
// backup, so a failed save never overwrites a healthy one.
import { STAGES } from '../sim/progress.js';

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

export const SLOT_NAMES = { auto: 'Autosave', quick: 'Quicksave', s1: 'Slot I', s2: 'Slot II', s3: 'Slot III' };

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

// `game` supplies the run summary (the main-thread mirror is fine); `json` is the
// authoritative serialisation produced by the simulation worker.
export async function saveGame(game, slot = 'auto', thumb = null, json = null) {
  // 1. serialise and verify before touching storage
  if (!json) json = JSON.stringify(game.serialize());
  const parsed = JSON.parse(json);
  if (!parsed.tribes || parsed.tribes.length !== 4 || !parsed.world?.trees) throw new Error('Save verification failed');
  const meta = { ...runSummary(game), slot, savedAt: Date.now(), bytes: json.length };
  const key = `${game.runId}|${slot}`;
  // 2. atomic write: previous slot content is moved to a backup in the same transaction
  await tx(['runs', 'slots'], 'readwrite', t => {
    const slots = t.objectStore('slots');
    const getOld = slots.get(key);
    getOld.onsuccess = () => {
      if (getOld.result) slots.put({ ...getOld.result, key: key + '|bak' });
      slots.put({ key, runId: game.runId, slot, meta, json });
    };
    const runs = t.objectStore('runs');
    const getRun = runs.get(game.runId);
    getRun.onsuccess = () => {
      const prev = getRun.result || {};
      runs.put({ ...prev, ...runSummary(game), thumb: thumb || prev.thumb || null, slots: { ...(prev.slots || {}), [slot]: meta } });
    };
  });
  return meta;
}

export async function listRuns() {
  const runs = await tx(['runs'], 'readonly', t => req(t.objectStore('runs').getAll()));
  const r = await runs;
  return (r || []).sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function loadSlot(runId, slot) {
  const rec = await tx(['slots'], 'readonly', t => req(t.objectStore('slots').get(`${runId}|${slot}`)));
  const r = await rec;
  if (!r) throw new Error('Save slot is empty');
  try {
    JSON.parse(r.json); // integrity check before handing it to the worker
    return r.json;
  } catch (e) {
    // fall back to the backup copy if the primary is damaged
    const bak = await (await tx(['slots'], 'readonly', t => req(t.objectStore('slots').get(`${runId}|${slot}|bak`))));
    if (bak) { JSON.parse(bak.json); return bak.json; }
    throw e;
  }
}

export async function latestSlot(run) {
  const s = Object.values(run.slots || {}).sort((a, b) => b.savedAt - a.savedAt)[0];
  return s?.slot || 'auto';
}

export async function deleteRun(runId) {
  await tx(['runs', 'slots'], 'readwrite', t => {
    t.objectStore('runs').delete(runId);
    const s = t.objectStore('slots');
    for (const slot of Object.keys(SLOT_NAMES)) { s.delete(`${runId}|${slot}`); s.delete(`${runId}|${slot}|bak`); }
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
  master: 0.8, music: 0.5, sfx: 0.7, ambience: 0.6,
  quality: 'high', particles: true, animations: true, territory: true, uiScale: 1,
  camSpeed: 1, edgePan: false, autosaveMin: 3, pauseOnEvent: true, defaultSpeed: 1,
};
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function storeSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
