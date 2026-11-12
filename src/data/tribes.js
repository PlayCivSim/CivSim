// The four civilisations. Traits feed the modifier system; `ai` weights feed the
// utility AI. Weights bias behaviour but never forbid it.

// The four peoples. Everything that makes a people distinct lives here as
// data, so content packs (src/data/registry.js) can rename, recolour or
// rebalance them without touching the simulation:
//   name/adjective/title/motto/blurb, pal (colours), style (sprite & emblem
//   look: oruvai | kharvak | thalori | vaelith), ai (temperament), mods
//   (bonuses & weaknesses), strengths/weaknesses (text), start, biome,
//   techBias, names, affinity (opinion of other peoples), warCry, lightTint,
//   quirks (small behaviour tweaks read by the simulation).
export const TRIBES = [
  {
    key: 'oruvai', name: 'Oruvai', adjective: 'Oruvan', title: 'The Tidebound Concord',
    motto: 'Many currents, one sea.',
    color: '#2f6fd6',
    borderLine: '#9fe0ff', // pale border line so it reads against the ocean
    pal: { primary: '#2f6fd6', dark: '#173a7a', light: '#7fb2ff', accent: '#d7e3f2', trim: '#b9c6d8', skin: ['#f1c9a5', '#d9a77f', '#b97f58'], hair: ['#2a1d15', '#4a3426', '#1b1b2a'] },
    style: 'oruvai',
    blurb: 'A coastal people who settle disputes in council and bind rivals with treaties. Their towns rise in ordered rings around a central forum, roofed in blue domes.',
    strengths: ['Relations improve 40% faster', 'Trade agreements yield 30% more', 'Council government available earlier', 'Laws grant +25% stability'],
    weaknesses: ['Soldiers fight 10% weaker', 'Military buildings cost more', 'Relies on partners for security'],
    start: 'Coastline & river mouths',
    mods: { relation: 0.4, trade: 0.3, lawStability: 0.25, military: -0.1, fish: 0.15, happiness: 0.05, costMilitaryBuild: 0.15, costGovernment: -0.25 },
    ai: { aggression: 0.25, diplomacy: 0.95, research: 0.55, expansion: 0.5, military: 0.35, agriculture: 0.5, trade: 0.9, caution: 0.6, loyalty: 0.85 },
    techBias: { government: 1.6, economics: 1.5, agriculture: 1.0, construction: 1.0, extraction: 0.8, military: 0.6, innovation: 0.9 },
    biome: { coast: 2, river: 1.5, grass: 1, forest: 0.6, hills: 0.5 },
    names: { pre: ['A', 'Ae', 'O', 'Mi', 'Se', 'Lu', 'Va', 'Ri', 'Na', 'Ilo', 'Ce'], mid: ['ru', 'la', 'shen', 'ma', 've', 'ni', 'lo', 'ro', 'sa'], end: ['n', 'a', 'el', 'is', 'ai', 'on', 'ae', 'ra'] },
    affinity: { thalori: 10, vaelith: 5, kharvak: -6 },
    quirks: { fishing: 2, techLikes: { fishing: 1.5 }, lawDislikes: [{ law: 'trade', opt: 'protect', name: 'Closed Harbours', desc: 'Oruvai merchants chafe at protectionism: -2 stability.', mods: { stability: -2 } }] },
    leaderTitle: 'Speaker', capitalNames: ['Oru Tessar', 'Lumaren', 'Seravel', 'Aelon'], townNames: ['Mirashen', 'Calvae', 'Nimara', 'Ilosen', 'Vessaro', 'Ruvain'],
  },
  {
    key: 'kharvak', name: 'Kharvak', adjective: 'Kharvaki', title: 'The Iron Hearth Clans',
    motto: 'What is held, is kept.',
    color: '#b3242c',
    pal: { primary: '#b3242c', dark: '#5c1116', light: '#e2585c', accent: '#c78b3a', trim: '#3a3536', skin: ['#e0b08a', '#c48c62', '#9a6844'], hair: ['#1d1412', '#3b2416', '#5e2a18'] },
    style: 'kharvak',
    blurb: 'Hill clans forged in feuds. They raise heavy timber halls behind sharpened palisades and measure a chief by the land they hold.',
    strengths: ['Soldiers fight 25% stronger', 'Defensive structures +30% strength', 'Military upkeep 20% cheaper', 'Resist morale-breaking events'],
    weaknesses: ['Relations improve 30% slower', 'Upkeep strains the economy', 'Research 10% slower'],
    start: 'Hills & highland passes',
    mods: { military: 0.25, defense: 0.3, upkeep: -0.2, relation: -0.3, research: -0.1, mine: 0.1, hunt: 0.15, costMilitary: -0.25 },
    ai: { aggression: 0.9, diplomacy: 0.3, research: 0.35, expansion: 0.85, military: 0.95, agriculture: 0.45, trade: 0.35, caution: 0.35, loyalty: 0.5 },
    techBias: { military: 1.8, extraction: 1.3, construction: 1.1, government: 0.8, agriculture: 0.8, economics: 0.6, innovation: 0.6 },
    biome: { hills: 2, mountainEdge: 1.5, grass: 1, forest: 0.8, coast: 0.4 },
    names: { pre: ['Gr', 'Kh', 'Dr', 'Vor', 'Ul', 'Bra', 'Kor', 'Th', 'Ska', 'Hro'], mid: ['a', 'o', 'u', 'ag', 'ar', 'ok', 'ur'], end: ['k', 'vak', 'dak', 'gar', 'rok', 'ash', 'nor', 'th', 'ga'] },
    affinity: { oruvai: -6, thalori: -4, vaelith: -8 },
    warCry: 'to prove Kharvaki might',
    quirks: { warWeariness: 0.6, morale: 0.15, mining: 2 },
    leaderTitle: 'Warchief', capitalNames: ['Kharuth', 'Grom Hald', 'Vorgard', 'Skarn'], townNames: ['Drakmoor', 'Uldrek', 'Hrothgar', 'Brasskar', 'Korvash', 'Thundak'],
  },
  {
    key: 'thalori', name: 'Thalori', adjective: 'Thalorin', title: 'The Greenweave Kin',
    motto: 'Take from the land, and return.',
    color: '#2f8a3e',
    borderColor: '#0d4219', // territory tint and border: darker so it reads against grassland
    pal: { primary: '#2f8a3e', dark: '#164a20', light: '#76c45a', accent: '#c9a24a', trim: '#7a5532', skin: ['#e9c29b', '#c79a6e', '#8f6440'], hair: ['#3d2a1a', '#6b4626', '#a8743a'] },
    style: 'thalori',
    blurb: 'Patient forest-dwellers who weave their homes into living groves. They farm with uncanny skill and harvest only what the land can give back.',
    strengths: ['Farms produce 30% more food', 'Forests and game regrow twice as fast', 'Herbs and wildlife yield more', 'Population needs 10% less food'],
    weaknesses: ['Smelting and industry 20% slower', 'Less inclined to expand by force', 'Struggles in barren lands'],
    start: 'Forests & fertile valleys',
    mods: { farm: 0.3, forestRegrow: 1.0, hunt: 0.1, food: -0.1, craft: -0.2, industry: -0.2, happiness: 0.05, diseaseResist: 0.2 },
    ai: { aggression: 0.3, diplomacy: 0.6, research: 0.5, expansion: 0.55, military: 0.4, agriculture: 0.95, trade: 0.55, caution: 0.75, loyalty: 0.75 },
    techBias: { agriculture: 1.8, construction: 1.1, government: 1.0, economics: 0.9, extraction: 0.8, military: 0.7, innovation: 0.8 },
    biome: { forest: 2, valley: 2, grass: 1.2, swamp: 0.8, hills: 0.5 },
    names: { pre: ['Fen', 'Tha', 'Wy', 'Bra', 'Eli', 'Ro', 'Sy', 'Ma', 'Hal', 'Ty'], mid: ['l', 'lo', 'ri', 'we', 'an', 'el', 'ny'], end: ['wyn', 'lia', 'dra', 'ren', 'on', 'eth', 'a', 'is'] },
    affinity: { oruvai: 10, kharvak: -4, vaelith: 0 },
    quirks: { lawLikes: [{ law: 'forestry', opt: 'sacred', name: 'Ancestral Groves', desc: 'The Thalori revere their forests: +2 happiness.', mods: { happiness: 2 } }] },
    leaderTitle: 'Grove Keeper', capitalNames: ['Thalorwen', 'Elmhollow', 'Fennabra', 'Wyrlden'], townNames: ['Mossbrook', 'Rowanshade', 'Haldrel', 'Syrawen', 'Tyleth', 'Briarlen'],
  },
  {
    key: 'vaelith', name: 'Vaelith', adjective: 'Vaelithi', title: 'The Prism Assembly',
    motto: 'Know first, then build.',
    color: '#7d3fc4',
    pal: { primary: '#7d3fc4', dark: '#3d1d66', light: '#b98af0', accent: '#c7ccd8', trim: '#4a4a5c', skin: ['#efd0b4', '#d0a581', '#a87a58'], hair: ['#1a1624', '#e8e0d0', '#3a2a40'] },
    style: 'vaelith',
    blurb: 'Scholars and engineers who raise geometric spires of dressed stone. Their curiosity drives them toward the minerals and secrets buried in the mountains.',
    strengths: ['Research 30% faster', 'Workshops and smelters +20% output', 'Advanced production unlocks earlier', 'Specialised buildings +15% efficiency'],
    weaknesses: ['Buildings cost 15% more stone', 'Soldiers fight 10% weaker', 'Population is harder to please'],
    start: 'Mountain foothills & mineral veins',
    mods: { research: 0.3, craft: 0.2, industry: 0.2, specialised: 0.15, military: -0.1, happiness: -0.05, costStone: 0.15, costInnovation: -0.2 },
    ai: { aggression: 0.4, diplomacy: 0.55, research: 1.0, expansion: 0.6, military: 0.4, agriculture: 0.45, trade: 0.6, caution: 0.55, loyalty: 0.6 },
    techBias: { innovation: 1.9, extraction: 1.4, construction: 1.2, economics: 1.0, government: 0.9, agriculture: 0.7, military: 0.7 },
    biome: { mountainEdge: 2, hills: 1.5, minerals: 2, grass: 0.8, desert: 0.6 },
    names: { pre: ['Vae', 'Ze', 'Ith', 'Qua', 'Sol', 'Yr', 'Ca', 'Xe', 'Ny', 'Aur'], mid: ['li', 'th', 'ra', 'ze', 'ven', 'si', 'qu'], end: ['ith', 'eth', 'ys', 'ion', 'ara', 'el', 'ix', 'yr'] },
    affinity: { oruvai: 5, kharvak: -8, thalori: 0 },
    warCry: 'to secure valuable resources',
    lightTint: [196, 160, 255],
    quirks: { mining: 2, smelting: 2, mineralSites: 1.5, cometOmen: { research: 0.2 } },
    leaderTitle: 'Archon', capitalNames: ['Vael Sirith', 'Zethara', 'Solquen', 'Ithrael'], townNames: ['Aurenith', 'Calyx', 'Nyvere', 'Xeradon', 'Quessil', 'Yrtheon'],
  },
];

export const TRIBE_BY_KEY = Object.fromEntries(TRIBES.map((t, i) => [t.key, { ...t, index: i }]));

export function tribeName(rng, def) {
  const n = def.names;
  let s = rng.pick(n.pre) + (rng.chance(0.6) ? rng.pick(n.mid) : '') + rng.pick(n.end);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
