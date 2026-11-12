// Building catalogue. `job` + `slots` define workplaces used by the workforce
// system. `prod` describes the work cycle output; `site` constrains placement.

export const BUILDING_CATS = [
  { key: 'housing', name: 'Housing' },
  { key: 'production', name: 'Production' },
  { key: 'infrastructure', name: 'Infrastructure' },
  { key: 'government', name: 'Government' },
  { key: 'research', name: 'Research' },
  { key: 'military', name: 'Military' },
  { key: 'culture', name: 'Wonders' },
];

export const BUILDINGS = {
  // ---------------- Government / centre
  centre: { name: 'Tribal Hearth', cat: 'government', size: 3, cost: {}, work: 0, hp: 900, tower: { range: 5, dmg: 4, rate: 14 }, housing: 6, storage: true, slots: 0,
    desc: 'The heart of a settlement. Stores goods, shelters the elders and anchors territory.', influence: 9, noBuild: true },
  council: { name: 'Council Hall', cat: 'government', size: 3, cost: { wood: 60, stone: 40 }, work: 140, tech: 'formalleadership', influence: 3, hp: 400,
    desc: 'Where elders deliberate. Enables councils, more law slots and +stability.', effect: { stability: 6 }, unique: true },
  admin: { name: 'Administrative Hall', cat: 'government', size: 3, cost: { stone: 120, wood: 60, clay: 30 }, work: 220, tech: 'administration', influence: 4, hp: 500,
    desc: 'Clerks and records. Reduces the strain of a large realm and improves tax collection.', effect: { stability: 8, tax: 0.15, sprawl: -0.4 }, unique: true },
  capitol: { name: 'Grand Capitol', cat: 'government', size: 3, cost: { stone: 300, steel: 40, gold: 20, goods: 60 }, work: 420, tech: 'statecraft', influence: 5, hp: 900,
    desc: 'The seat of a mature state. Large stability, relation and law bonuses.', effect: { stability: 14, relation: 0.15, lawSlots: 1 }, unique: true },

  // ---------------- Housing
  hut: { name: 'Hut', cat: 'housing', size: 2, cost: { wood: 14 }, work: 30, housing: 4, hp: 80, desc: 'A simple shelter for a family.' },
  house: { name: 'House', cat: 'housing', size: 2, cost: { wood: 22, stone: 12, clay: 6 }, work: 55, housing: 7, tech: 'carpentry', hp: 140, upgradeOf: 'hut', desc: 'A sturdy family home of timber and stone.' },
  manor: { name: 'Stone Residence', cat: 'housing', size: 3, cost: { stone: 50, wood: 25, clay: 15 }, work: 110, housing: 14, tech: 'urbanplanning', hp: 260, desc: 'Multi-family stone housing for a growing town.', effect: { happiness: 0.5 } },
  terrace: { name: 'Terrace Block', cat: 'housing', size: 3, cost: { stone: 70, steel: 10, clay: 25 }, work: 150, housing: 24, tech: 'advancedhousing', hp: 340, desc: 'Dense advanced housing with running water.', effect: { happiness: 0.6 } },

  // ---------------- Production
  farm: { name: 'Farm', cat: 'production', size: 3, cost: { wood: 18 }, work: 40, job: 'farmer', slots: 4, tech: 'cultivation', hp: 60, field: true,
    prod: { out: 'grain', amt: 3.2, time: 60, mod: 'farm', seasonal: true }, desc: 'Fields of grain. Yields swell in autumn and fall away in winter.', site: 'fertile' },
  orchard: { name: 'Orchard & Gardens', cat: 'production', size: 3, cost: { wood: 30, stone: 10 }, work: 60, job: 'farmer', slots: 4, tech: 'cropspecialisation', hp: 70, field: true,
    prod: { out: 'veg', alt: 'fruit', amt: 3.4, time: 60, mod: 'farm', seasonal: true }, desc: 'Vegetable beds and fruit trees. Food variety lifts spirits.', site: 'fertile' },
  pasture: { name: 'Pasture', cat: 'production', size: 3, cost: { wood: 35 }, work: 60, job: 'farmer', slots: 2, tech: 'animalhusbandry', hp: 70, field: true,
    prod: { out: 'meat', amt: 3.5, time: 70, mod: 'farm', livestock: true }, desc: 'Fenced grazing for livestock. Steady meat in every season.', site: 'open' },
  lumber: { name: 'Lumber Camp', cat: 'production', size: 2, cost: { wood: 12 }, work: 30, job: 'woodcutter', slots: 4, hp: 80,
    prod: { out: 'wood', amt: 3, time: 45, mod: 'wood', gather: 'trees', radius: 9 }, desc: 'Woodcutters fell nearby trees. Forests regrow over time.' },
  hunter: { name: 'Hunting Lodge', cat: 'production', size: 2, cost: { wood: 15 }, work: 30, job: 'hunter', slots: 3, hp: 70,
    prod: { out: 'meat', amt: 2.6, time: 55, mod: 'hunt', gather: 'game', radius: 11, byproduct: 'fibre' }, desc: 'Hunters track game in wild lands. Overhunting depletes wildlife.' },
  fishery: { name: 'Fishing Hut', cat: 'production', size: 2, cost: { wood: 18 }, work: 35, job: 'fisher', slots: 3, tech: 'fishing', hp: 70,
    prod: { out: 'fish', amt: 3, time: 50, mod: 'fish', gather: 'fish', radius: 8 }, desc: 'Must be built beside water. Fish stocks slowly replenish.', site: 'water' },
  quarry: { name: 'Quarry', cat: 'production', size: 2, cost: { wood: 20 }, work: 40, job: 'miner', slots: 4, tech: 'stoneworking', hp: 100,
    prod: { out: 'stone', amt: 2.6, time: 55, mod: 'mine', gather: 'deposit', deps: ['stone', 'clay', 'salt'], radius: 6 }, desc: 'Cuts stone, clay or salt from deposits — or slowly quarries bare rock from nearby hills and mountains.', site: 'rock' },
  outpost: { name: 'Resource Outpost', cat: 'production', size: 2, cost: { wood: 30, tools: 4 }, work: 50, job: 'miner', slots: 3, tech: 'toolmaking', hp: 70, influence: 2, outpost: true,
    prod: { out: 'stone', amt: 2.4, time: 60, mod: 'mine', gather: 'deposit', deps: ['stone', 'clay', 'salt', 'iron', 'copper', 'coal', 'silver', 'gold', 'gems'], radius: 4 },
    desc: 'A small work camp on a rich deposit beyond your borders. Miners walk out to it and haul the yield home along a road. Needs food each day, can be raided, and neighbours resent camps near their land.', site: 'deposit:stone,clay,salt,iron,copper,coal,silver,gold,gems' },
  loggingcamp: { name: 'Logging Outpost', cat: 'production', size: 2, cost: { wood: 20, tools: 3 }, work: 40, job: 'woodcutter', slots: 4, tech: 'toolmaking', hp: 60, influence: 2, outpost: true,
    prod: { out: 'wood', amt: 3.2, time: 45, mod: 'wood', gather: 'trees', radius: 7 },
    desc: 'A woodcutters\u2019 camp in a rich forest beyond your borders. They fell the trees around it and haul the timber home. Needs food each day, can be raided, and neighbours dislike camps near their land.', site: 'forest' },
  mine: { name: 'Mine', cat: 'production', size: 2, cost: { wood: 40, stone: 20 }, work: 70, job: 'miner', slots: 4, tech: 'mining', hp: 140,
    prod: { out: 'iron', amt: 2, time: 65, mod: 'mine', gather: 'deposit', deps: ['iron', 'copper', 'coal', 'silver', 'gold', 'gems'], radius: 6 }, desc: 'Extracts ores within reach. Some ores need deeper mining knowledge.', site: 'deposit:iron,copper,coal,silver,gold,gems' },
  derrick: { name: 'Oil Derrick', cat: 'production', size: 2, cost: { steel: 25, stone: 30, tools: 12 }, work: 120, job: 'miner', slots: 3, tech: 'industrialextraction', hp: 160,
    prod: { out: 'oil', amt: 2.4, time: 60, mod: 'industry', gather: 'deposit', deps: ['oil'], radius: 4 }, desc: 'Draws oil from seeps for industry.', site: 'deposit:oil' },
  gatherer: { name: 'Forager Camp', cat: 'production', size: 2, cost: { wood: 8 }, work: 20, job: 'gatherer', slots: 5, hp: 60,
    prod: { out: 'fruit', amt: 1.8, time: 45, mod: 'farm', gather: 'wild', radius: 10, byproduct: 'fibre' }, desc: 'Gatherers collect berries, roots, fibres and herbs.' },
  workshop: { name: 'Workshop', cat: 'production', size: 2, cost: { wood: 30, stone: 15 }, work: 60, job: 'craftsman', slots: 3, tech: 'toolmaking', hp: 120,
    prod: { recipes: [{ out: 'tools', amt: 1, in: { wood: 2, iron: 1 } }, { out: 'tools', amt: 1, in: { wood: 2, copper: 1 } }, { out: 'tools', amt: 0.6, in: { wood: 2, stone: 2 } }], time: 70, mod: 'craft' }, desc: 'Craftsmen make tools that speed every gatherer and builder.' },
  smelter: { name: 'Smelter', cat: 'production', size: 2, cost: { stone: 50, clay: 20, wood: 20 }, work: 90, job: 'craftsman', slots: 3, tech: 'metalworking', hp: 160, smoke: true,
    prod: { recipes: [{ out: 'steel', amt: 1, in: { iron: 2, coal: 1 } }, { out: 'steel', amt: 0.7, in: { iron: 2, wood: 4 } }], time: 80, mod: 'industry' }, desc: 'Refines ore into steel for advanced construction and arms.' },
  armory: { name: 'Armory', cat: 'production', size: 2, cost: { stone: 40, wood: 30 }, work: 80, job: 'craftsman', slots: 3, tech: 'bronzeweapons', hp: 160, smoke: true,
    prod: { recipes: [{ out: 'weapons', amt: 1, in: { steel: 1, wood: 1 } }, { out: 'weapons', amt: 1, in: { iron: 2, wood: 1 } }, { out: 'weapons', amt: 0.8, in: { copper: 2, wood: 1 } }], time: 80, mod: 'craft' }, desc: 'Forges weapons that equip your soldiers.' },
  artisan: { name: 'Artisan Hall', cat: 'production', size: 2, cost: { wood: 40, stone: 30 }, work: 80, job: 'craftsman', slots: 3, tech: 'tradenetworks', hp: 140,
    prod: { recipes: [{ out: 'goods', amt: 1.4, in: { silver: 1 } }, { out: 'goods', amt: 1, in: { fibre: 3 } }, { out: 'goods', amt: 1, in: { herbs: 2, clay: 1 } }], time: 70, mod: 'craft' }, desc: 'Turns fibre, herbs and silver into valuable trade goods.' },
  mint: { name: 'Mint', cat: 'production', size: 2, cost: { stone: 60, steel: 5 }, work: 100, job: 'craftsman', slots: 2, tech: 'currency', hp: 200,
    prod: { recipes: [{ out: 'coins', amt: 14, in: { gold: 1 } }, { out: 'coins', amt: 7, in: { silver: 1 } }, { out: 'coins', amt: 3, in: { copper: 2 } }], time: 70, mod: 'craft' }, desc: 'Strikes coinage from precious metals.' },
  factory: { name: 'Manufactory', cat: 'production', size: 3, cost: { steel: 60, stone: 80, tools: 25 }, work: 260, job: 'craftsman', slots: 6, tech: 'mechanisation', hp: 320, smoke: true,
    prod: { recipes: [{ out: 'machinery', amt: 1, in: { steel: 2, oil: 1 } }, { out: 'machinery', amt: 0.7, in: { steel: 2, coal: 2 } }, { out: 'tools', amt: 4, in: { steel: 1, wood: 2 } }, { out: 'goods', amt: 4, in: { fibre: 3, coal: 1 } }], time: 70, mod: 'industry' }, desc: 'Powered production. Makes machinery and mass-produced goods.' },

  // ---------------- Infrastructure
  storehouse: { name: 'Storehouse', cat: 'infrastructure', size: 2, cost: { wood: 25 }, work: 45, storage: true, hp: 150, influence: 2,
    desc: 'A drop-off point for workers. Shortens hauling trips and protects against spoilage.' },
  well: { name: 'Well', cat: 'infrastructure', size: 1, cost: { stone: 10 }, work: 25, tech: 'stoneworking', hp: 60, desc: 'Clean water nearby: +health, softens droughts.', effect: { health: 0.03, happiness: 0.4 } },
  market: { name: 'Marketplace', cat: 'infrastructure', size: 3, cost: { wood: 50, stone: 30 }, work: 110, job: 'trader', slots: 3, tech: 'barter', hp: 180,
    prod: { trade: true, time: 80 }, desc: 'Traders run caravans to partners and sell surplus for coin.', effect: { happiness: 0.6 } },
  harbor: { name: 'Harbour', cat: 'infrastructure', size: 3, cost: { wood: 60, stone: 40 }, work: 130, job: 'trader', slots: 3, tech: 'navigation', hp: 200, site: 'water',
    prod: { trade: true, time: 70, bonus: 0.4 }, desc: 'Sea trade. Traders here earn far more from agreements.' },
  shrine: { name: 'Shrine', cat: 'infrastructure', size: 2, cost: { wood: 20, stone: 20 }, work: 50, tech: 'oraltradition', hp: 90, desc: 'A place of gathering and remembrance.', effect: { happiness: 1.2, stability: 1 } },
  bathhouse: { name: 'Bathhouse', cat: 'infrastructure', size: 2, cost: { stone: 40, clay: 30 }, work: 80, tech: 'sanitation', hp: 120, desc: 'Improves health and reduces epidemics.', effect: { health: 0.06, happiness: 0.8, disease: -0.3 } },

  // ---------------- Research
  school: { name: 'Learning Hut', cat: 'research', size: 2, cost: { wood: 25 }, work: 45, job: 'researcher', slots: 3, tech: 'oraltradition', hp: 90,
    prod: { research: 1.0, time: 40 }, desc: 'Elders teach and record knowledge. Produces research.' },
  library: { name: 'Library', cat: 'research', size: 2, cost: { wood: 40, stone: 40, clay: 20 }, work: 100, job: 'researcher', slots: 4, tech: 'writing', hp: 150,
    prod: { research: 1.6, time: 40 }, desc: 'Scrolls and scribes. Researchers work far faster here.' },
  academy: { name: 'Academy', cat: 'research', size: 3, cost: { stone: 100, wood: 40, goods: 15 }, work: 200, job: 'researcher', slots: 6, tech: 'education', hp: 260,
    prod: { research: 2.4, time: 40 }, desc: 'A seat of higher learning. Large research output.', effect: { research: 0.05 } },

  // ---------------- Military
  barracks: { name: 'Barracks', cat: 'military', size: 3, cost: { wood: 60, stone: 30 }, work: 110, tech: 'militaryorganisation', hp: 300, garrison: 10, influence: 2,
    desc: 'Houses and drills soldiers. Raises your soldier capacity by 10.', job: 'soldier', slots: 10, train: true },
  training: { name: 'Training Ground', cat: 'military', size: 2, cost: { wood: 25 }, work: 40, hp: 120, garrison: 5, job: 'soldier', slots: 5, train: true,
    desc: 'A muster field. Allows up to 5 soldiers to train.' },
  tower: { name: 'Watchtower', cat: 'military', size: 1, cost: { wood: 30, stone: 15 }, work: 60, tech: 'palisades', hp: 260, tower: { range: 6, dmg: 6, rate: 12 }, influence: 3,
    desc: 'Archers watch the borders and shoot intruders.' },
  fort: { name: 'Fortress', cat: 'military', size: 3, cost: { stone: 160, steel: 20, wood: 40 }, work: 260, tech: 'fortification', hp: 1200, tower: { range: 8, dmg: 12, rate: 10 }, garrison: 12, influence: 4, job: 'soldier', slots: 12, train: true,
    desc: 'A stone stronghold. Defenders nearby fight far harder.', effect: { defense: 0.15 } },

  // ---------------- Tribal wonders (one per tribe, unique)
  w_oruvai: { name: 'Tidal Forum', cat: 'culture', size: 3, cost: { stone: 150, wood: 80, goods: 30 }, work: 300, tech: 'diplomaticcorps', tribe: 'oruvai', unique: true, hp: 600,
    desc: 'A great colonnaded forum. +25% relation gain, +10% trade, +5 stability.', effect: { relation: 0.25, trade: 0.1, stability: 5 } },
  w_kharvak: { name: 'Hall of Banners', cat: 'culture', size: 3, cost: { wood: 150, stone: 100, weapons: 30 }, work: 300, tech: 'militaryorganisation', tribe: 'kharvak', unique: true, hp: 900,
    desc: 'Trophies of every war. +15% soldier strength, +5 stability while at war.', effect: { military: 0.15, warStability: 5 } },
  w_thalori: { name: 'Grove Sanctum', cat: 'culture', size: 3, cost: { wood: 120, stone: 60, herbs: 40 }, work: 280, tech: 'irrigation', tribe: 'thalori', unique: true, hp: 600,
    desc: 'A living temple of ancient trees. +15% food, +2 happiness, resists droughts.', effect: { farm: 0.15, happiness: 2, drought: -0.5 } },
  w_vaelith: { name: 'Prism Observatory', cat: 'culture', size: 3, cost: { stone: 160, gems: 10, steel: 20 }, work: 320, tech: 'writing', tribe: 'vaelith', unique: true, hp: 600,
    desc: 'A crystal-topped tower that reads the heavens. +20% research.', effect: { research: 0.2 } },
};

export const JOBS = {
  idle:       { name: 'Unemployed', plural: 'Unemployed', icon: 'idle' },
  gatherer:   { name: 'Gatherer',   plural: 'Gatherers',   icon: 'gatherer', base: 4, desc: 'Forage fruit, fibre and herbs.' },
  farmer:     { name: 'Farmer',     plural: 'Farmers',     icon: 'farmer', desc: 'Work farms, orchards and pastures.' },
  woodcutter: { name: 'Woodcutter', plural: 'Woodcutters', icon: 'woodcutter', base: 3, desc: 'Fell timber.' },
  hunter:     { name: 'Hunter',     plural: 'Hunters',     icon: 'hunter', desc: 'Hunt game for meat and hides.' },
  fisher:     { name: 'Fisher',     plural: 'Fishers',     icon: 'fisher', desc: 'Fish rivers, lakes and coasts.' },
  miner:      { name: 'Miner',      plural: 'Miners',      icon: 'miner', desc: 'Quarry stone and mine ore.' },
  builder:    { name: 'Builder',    plural: 'Builders',    icon: 'builder', unlimited: true, desc: 'Raise new buildings. Haul wood when idle.' },
  craftsman:  { name: 'Craftsman',  plural: 'Craftsmen',   icon: 'craftsman', desc: 'Make tools, steel, weapons and goods.' },
  trader:     { name: 'Trader',     plural: 'Traders',     icon: 'trader', desc: 'Run markets and trade caravans.' },
  researcher: { name: 'Researcher', plural: 'Researchers', icon: 'researcher', base: 1, desc: 'Generate research.' },
  soldier:    { name: 'Soldier',    plural: 'Soldiers',    icon: 'soldier', base: 3, desc: 'Defend and wage war. Eat more, produce nothing.' },
};
export const JOB_KEYS = Object.keys(JOBS).filter(k => k !== 'idle');

export function buildingDef(type) { return BUILDINGS[type]; }
