// Scouting parties: a few people leave with food and walk out in one direction,
// charting the land on either side, and come back when half the food is gone.
// Party size sets how wide a strip they chart; food sets how far they go.
// Balance: they are away from work, eat as they go, can die out there, and only
// one party (two from stage 3) may be out at once.
import { BIOMES, B } from '../world/biomes.js';
import { revealFor } from './vision.js';
import { eatFood, foodTotal, addRes } from './economy.js';
import { isAdult } from './agents.js';

export const SCOUT_MAX = 4;
export const RATION = 1.5;          // food per scout per day
export const SCOUT_SPEED = 9;       // tiles per day on open ground
export const FOOD_MIN = 6, FOOD_MAX = 90;
const STEP = 10;                    // ticks between updates
const DAY = 360;

export const sweepRadius = party => 2 + party * 1.5;             // 3.5 .. 8 tiles each side
export function scoutEstimate(party, food) {
  const days = food / (party * RATION);
  const reach = Math.round(days / 2 * SCOUT_SPEED * 0.8);       // terrain slows them a little
  return { days: Math.round(days * 10) / 10, reach, width: Math.round(sweepRadius(party) * 2), risk: Math.min(0.6, 1 - Math.pow(1 - 0.012, days * party)) };
}
export const maxParties = t => (t.stage >= 3 ? 2 : 1);

export function canScout(g, t, party, food) {
  if (g.vis === 'open') return { ok: false, why: 'On Easy the whole map is already known' };
  if (!(party >= 1 && party <= SCOUT_MAX)) return { ok: false, why: `A party is 1 to ${SCOUT_MAX} people` };
  if ((g.expeditions || []).filter(e => e.tribe === t.id).length >= maxParties(t)) return { ok: false, why: maxParties(t) > 1 ? 'Two parties are already out' : 'A party is already out (two allowed from the third age)' };
  if (food < FOOD_MIN) return { ok: false, why: `Give them at least ${FOOD_MIN} food` };
  if (foodTotal(t) < food + 10) return { ok: false, why: 'Not enough food in your stores' };
  if (pickMembers(g, t, party).length < party) return { ok: false, why: 'Not enough people to spare' };
  return { ok: true };
}

function pickMembers(g, t, n) {
  const adults = [];
  for (const a of g.agents.values()) if (a.tribe === t.id && isAdult(a) && !a.army && !a.expedition && a.state !== 'travel' && a.job !== 'soldier') adults.push(a);
  if (adults.length < n + 6) return []; // never strip a tiny tribe bare
  const pref = { idle: 0, hunter: 1, gatherer: 2, woodcutter: 3 };
  adults.sort((a, b) => (pref[a.job] ?? 9) - (pref[b.job] ?? 9) || a.id - b.id);
  return adults.slice(0, n);
}

export function sendScouts(g, t, party, food, tx, ty) {
  party = Math.round(party); food = Math.max(FOOD_MIN, Math.min(FOOD_MAX, Math.round(food)));
  const c = canScout(g, t, party, food); if (!c.ok) return c;
  const home = g.settlements.get(t.capital); if (!home) return { ok: false, why: 'No home to leave from' };
  const dx = tx - home.x, dy = ty - home.y, d = Math.hypot(dx, dy);
  if (d < 2) return { ok: false, why: 'Pick a direction away from your capital' };
  const members = pickMembers(g, t, party);
  const carried = eatFood(t, food);
  const e = { id: g.nextId++, tribe: t.id, members: members.map(a => a.id), party, food: carried, food0: carried, x: home.x + 0.5, y: home.y + 0.5,
    hx: home.x + 0.5, hy: home.y + 0.5, ang: Math.atan2(dy, dx), state: 'out', start: g.tick, dist: 0, lost: 0, trail: [], explored0: countExplored(g, t.id) };
  for (const a of members) { a.expedition = e.id; a.state = 'travel'; a.hidden = true; a.timer = 1e9; a.travel = null; a.job = 'idle'; a.workId = null; a.path = null; }
  (g.expeditions = g.expeditions || []).push(e);
  g.log(t, 'world', `A scouting party of ${party} set out with ${Math.round(carried)} food.`, 1, { at: { x: home.x, y: home.y } });
  return { ok: true, id: e.id };
}

export function recallScouts(g, t, id) {
  const e = (g.expeditions || []).find(x => x.id === id && x.tribe === t.id); if (e && e.state === 'out') e.state = 'back';
  return !!e;
}

function countExplored(g, t) { const ex = g.explored?.[t]; if (!ex) return 0; let n = 0; for (let i = 0; i < ex.length; i++) n += ex[i]; return n; }

const harsh = bi => bi === B.DESERT || bi === B.SNOW || bi === B.MOUNTAIN || bi === B.SWAMP || bi === B.TUNDRA;

export function updateExpeditions(g) {
  if (!g.expeditions?.length || g.tick % STEP) return;
  const w = g.world, dtd = STEP / DAY;
  for (const e of [...g.expeditions]) {
    const t = g.tribes[e.tribe];
    const alive = e.members.map(id => g.agents.get(id)).filter(a => a && a.expedition === e.id);
    if (!alive.length || !t.alive) { finish(g, e, alive, true); continue; }
    e.party = alive.length;
    // eat
    const need = e.party * RATION * dtd;
    e.food -= need; const starving = e.food < 0; if (starving) e.food = 0;
    // move
    const i0 = w.idx(e.x | 0, e.y | 0);
    const cost = Math.max(1, w.walkCost(i0) || 1);
    const step = SCOUT_SPEED * dtd / cost;
    if (e.state === 'out') {
      // turn back once the food left only just covers the way home (with a margin)
      const home = Math.hypot(e.x - e.hx, e.y - e.hy);
      if (e.food <= (home / (SCOUT_SPEED * 0.8)) * e.party * RATION * 1.2) e.state = 'back';
      else {
        let moved = false;
        // keep to the chosen heading; skirt water and peaks by following the shore
        const base = e.ang0 ?? (e.ang0 = e.ang);
        const ok = (x, y) => w.inb(x | 0, y | 0) && w.walkCost(w.idx(x | 0, y | 0)) > 0;
        for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75]) {
          const a = e.ang + off, nx = e.x + Math.cos(a) * step, ny = e.y + Math.sin(a) * step;
          // look a little ahead so the party does not walk into a dead end
          if (!ok(nx, ny) || !ok(e.x + Math.cos(a) * 2, e.y + Math.sin(a) * 2)) continue;
          e.ang = a + (base - a) * 0.15; // ease back toward the chosen heading
          e.x = nx; e.y = ny; e.dist += step; moved = true; break;
        }
        if (!moved) { e.blocked = (e.blocked || 0) + 1; e.ang += 0.6; if (e.blocked > 12) e.state = 'back'; } else e.blocked = 0;
        const last = e.trail[e.trail.length - 1];
        if (!last || Math.hypot(last[0] - e.x, last[1] - e.y) >= 1) e.trail.push([Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10]);
      }
    } else {
      // retrace the trail home
      let left = step;
      while (left > 0 && e.trail.length) {
        const [px, py] = e.trail[e.trail.length - 1]; const dd = Math.hypot(px - e.x, py - e.y);
        if (dd <= left) { e.x = px; e.y = py; left -= dd; e.trail.pop(); } else { e.x += (px - e.x) / dd * left; e.y += (py - e.y) / dd * left; left = 0; }
      }
      if (!e.trail.length) { const dd = Math.hypot(e.hx - e.x, e.hy - e.y); if (dd <= step + 0.5) { finish(g, e, alive, false); continue; } e.x += (e.hx - e.x) / dd * step; e.y += (e.hy - e.y) / dd * step; }
    }
    revealFor(g, e.tribe, e.x, e.y, sweepRadius(e.party));
    // dangers of the road: harsh land, winter, hostile lands, hunger
    const i = w.idx(e.x | 0, e.y | 0), bi = w.biome[i], own = w.owner[i];
    let p = 0.012;
    if (harsh(bi)) p += 0.02;
    if (g.season === 3) p += 0.015;
    if (own >= 0 && own !== e.tribe) p += g.dip.atWar(e.tribe, own) ? 0.08 : 0.01;
    if (starving) p += 0.25;
    for (const a of alive) if (g.rng.chance(p * dtd)) {
      e.lost++; e.members = e.members.filter(id => id !== a.id);
      g.removeAgent(a, 'expedition');
      if (t.isPlayer) g.log(t, 'world', `A scout was lost ${starving ? 'to hunger' : own >= 0 && own !== e.tribe && g.dip.atWar(e.tribe, own) ? 'to enemy patrols' : harsh(bi) ? 'in the ' + BIOMES[bi].name.toLowerCase() : g.season === 3 ? 'to the cold' : 'in the wilds'}.`, 1, { at: { x: e.x, y: e.y }, alert: true });
    }
  }
}

function finish(g, e, alive, lost) {
  const t = g.tribes[e.tribe];
  g.expeditions = g.expeditions.filter(x => x !== e);
  const home = g.settlements.get(t.capital);
  for (const a of alive) { a.expedition = null; a.hidden = false; a.state = 'think'; a.timer = 0; if (home) { a.x = home.x + 0.5; a.y = home.y + 2; a._x0 = a.x; a._y0 = a.y; } }
  if (e.food > 0.5 && t.alive) addRes(g, t, 'grain', e.food);
  if (!t.isPlayer) return;
  const charted = Math.max(0, countExplored(g, t.id) - e.explored0);
  if (lost) g.log(t, 'world', 'Your scouting party never came back.', 2, { alert: true });
  else g.log(t, 'world', `Your scouts came home${e.lost ? `, ${e.lost} fewer than left` : ''}, having charted ${charted} new tiles over ${Math.round(e.dist)} tiles of travel.`, 2, { at: { x: e.x, y: e.y } });
}

// Rival peoples explore the same way: now and then a small party heads toward
// the least-known land around their capital, judged only from their own map.
export function aiScouting(g) {
  if (g.vis === 'open') return;
  for (const t of g.tribes) {
    if (t.isPlayer || !t.alive || g.tutorial) continue;
    if ((g.expeditions || []).some(e => e.tribe === t.id)) continue;
    const unmet = g.tribes.some(o => o !== t && o.alive && !g.dip.contact[t.id][o.id]);
    if (!g.rng.chance(unmet ? 0.06 : 0.015)) continue;
    const cap = g.settlements.get(t.capital); if (!cap) continue;
    const ex = g.explored[t.id], w = g.world;
    let best = null, bv = -1;
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + g.rng.range(-0.2, 0.2); let v = 0;
      for (let r = 12; r <= 40; r += 4) { const x = Math.round(cap.x + Math.cos(a) * r), y = Math.round(cap.y + Math.sin(a) * r); if (!w.inb(x, y)) break; const i = w.idx(x, y); if (!ex[i]) v += w.walkCost(i) > 0 ? 1 : 0.3; }
      if (v > bv) { bv = v; best = a; }
    }
    if (best == null || bv < 2) continue;
    const party = foodTotal(t) > 150 ? 2 : 1, food = Math.min(36, Math.floor(foodTotal(t) * 0.12));
    if (canScout(g, t, party, food).ok) sendScouts(g, t, party, food, cap.x + Math.cos(best) * 20, cap.y + Math.sin(best) * 20);
  }
}
