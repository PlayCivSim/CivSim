// Technology tree. Each tech belongs to a branch and tier (column). Unlocks are
// mostly capabilities (buildings, deposits, laws, governments); `mods` adds
// smaller efficiency improvements.

export const BRANCHES = [
  { key: 'agriculture',  name: 'Agriculture',  color: '#8cbf3f', icon: 'farmer' },
  { key: 'extraction',   name: 'Extraction',   color: '#c08a4a', icon: 'miner' },
  { key: 'construction', name: 'Construction', color: '#c9b48a', icon: 'builder' },
  { key: 'military',     name: 'Military',     color: '#d04a4a', icon: 'soldier' },
  { key: 'economics',    name: 'Economics',    color: '#e3b341', icon: 'trader' },
  { key: 'government',   name: 'Government',   color: '#5f8fe0', icon: 'crown' },
  { key: 'innovation',   name: 'Innovation',   color: '#a873e8', icon: 'researcher' },
];

export const TIER_COST = [15, 35, 70, 130, 220, 340, 520];
export const TIER_STAGE = [1, 1, 2, 3, 4, 5, 5];

const T = (key, name, branch, tier, req, desc, extra = {}) => ({ key, name, branch, tier, req, desc, ...extra });

export const TECHS = [
  // Agriculture
  T('cultivation', 'Cultivation', 'agriculture', 0, [], 'Sow wild grain in tilled rows.', { unlocks: ['farm'] }),
  T('fishing', 'Fishing', 'agriculture', 0, [], 'Nets, lines and dugout canoes.', { unlocks: ['fishery'] }),
  T('animalhusbandry', 'Animal Husbandry', 'agriculture', 1, ['cultivation'], 'Tame herds for meat and hides.', { unlocks: ['pasture'] }),
  T('cropspecialisation', 'Crop Specialisation', 'agriculture', 2, ['cultivation'], 'Vegetables and orchards bring variety.', { unlocks: ['orchard'], mods: { farm: 0.05 } }),
  T('irrigation', 'Irrigation', 'agriculture', 3, ['cropspecialisation', 'stoneworking'], 'Channels carry river water to the fields.', { mods: { farm: 0.2, drought: -0.35 }, unlocks: ['w_thalori'] }),
  T('croprotation', 'Crop Rotation', 'agriculture', 4, ['irrigation', 'animalhusbandry'], 'Fallow cycles keep soil rich; winter harvests improve.', { mods: { farm: 0.15, winterFarm: 0.25 } }),
  T('preservation', 'Preservation', 'agriculture', 5, ['croprotation'], 'Salting, smoking and cellars. Food lasts longer.', { mods: { spoilage: -0.6, food: -0.05 } }),
  T('agronomy', 'Agronomy', 'agriculture', 6, ['preservation', 'education'], 'Scientific farming practice.', { mods: { farm: 0.3 } }),

  // Extraction
  T('stoneworking', 'Stoneworking', 'extraction', 0, [], 'Shape stone and dig clay. Quarries and wells.', { unlocks: ['quarry', 'well'], deposits: ['stone', 'clay', 'salt'] }),
  T('toolmaking', 'Toolmaking', 'extraction', 1, ['stoneworking'], 'Hafted axes and picks.', { unlocks: ['workshop'], mods: { wood: 0.1 } }),
  T('mining', 'Mining', 'extraction', 2, ['toolmaking'], 'Shafts into the hills for iron and copper.', { unlocks: ['mine'], deposits: ['iron', 'copper'] }),
  T('metalworking', 'Metalworking', 'extraction', 3, ['mining'], 'Bloomeries and forges refine ore into steel.', { unlocks: ['smelter'] }),
  T('prospecting', 'Prospecting', 'extraction', 3, ['mining'], 'Find and work silver and gold lodes.', { deposits: ['silver', 'gold'], mods: { mine: 0.1 } }),
  T('deepmining', 'Deep Mining', 'extraction', 4, ['metalworking'], 'Timbered galleries reach coal seams and gems.', { deposits: ['coal', 'gems'], mods: { mine: 0.2 } }),
  T('industrialextraction', 'Industrial Extraction', 'extraction', 6, ['deepmining', 'mechanisation'], 'Drills and pumps tap oil.', { unlocks: ['derrick'], deposits: ['oil'], mods: { mine: 0.25 } }),

  // Construction
  T('carpentry', 'Carpentry', 'construction', 0, [], 'Joinery for proper houses.', { unlocks: ['house'], mods: { build: 0.1 } }),
  T('masonry', 'Masonry', 'construction', 1, ['stoneworking', 'carpentry'], 'Dressed stone walls. Builders work faster.', { mods: { build: 0.15 } }),
  T('roads', 'Roads & Bridges', 'construction', 2, ['masonry'], 'Paved roads speed travel and may cross rivers.', { mods: { roadSpeed: 0.3 } }),
  T('urbanplanning', 'Urban Planning', 'construction', 3, ['roads'], 'Planned districts and stone residences.', { unlocks: ['manor'] }),
  T('engineering', 'Engineering', 'construction', 4, ['urbanplanning', 'mathematics'], 'Cranes and scaffolds.', { mods: { build: 0.3 } }),
  T('advancedhousing', 'Advanced Housing', 'construction', 5, ['engineering', 'metalworking'], 'Steel-framed terraces with plumbing.', { unlocks: ['terrace'] }),

  // Military
  T('militaryorganisation', 'Military Organisation', 'military', 1, ['carpentry'], 'Ranks, drills and barracks.', { unlocks: ['barracks', 'w_kharvak'], mods: { military: 0.1 } }),
  T('palisades', 'Palisades', 'military', 1, ['carpentry'], 'Sharpened stakes and watchtowers.', { unlocks: ['tower'], mods: { defense: 0.1 } }),
  T('bronzeweapons', 'Bronze Weapons', 'military', 3, ['militaryorganisation', 'mining'], 'Cast blades. Unlocks the Armory.', { unlocks: ['armory'], equip: 1 }),
  T('ironweapons', 'Iron Weapons', 'military', 4, ['bronzeweapons', 'metalworking'], 'Forged iron arms and armour.', { equip: 2 }),
  T('fortification', 'Fortification', 'military', 4, ['palisades', 'masonry', 'metalworking'], 'Stone keeps and curtain walls.', { unlocks: ['fort'], mods: { defense: 0.15 } }),
  T('tactics', 'Tactics', 'military', 5, ['ironweapons'], 'Formations and coordinated manoeuvre.', { mods: { military: 0.2 } }),
  T('steelarms', 'Steel Arms', 'military', 6, ['tactics', 'deepmining'], 'Tempered steel weapons and plate.', { equip: 3 }),

  // Economics
  T('barter', 'Barter', 'economics', 1, ['oraltradition'], 'Marketplaces and exchange between peoples.', { unlocks: ['market'], tradeTreaty: true }),
  T('tradenetworks', 'Trade Networks', 'economics', 2, ['barter'], 'Caravan routes and artisans.', { unlocks: ['artisan'], mods: { trade: 0.2 } }),
  T('navigation', 'Navigation', 'economics', 3, ['tradenetworks', 'fishing'], 'Seaworthy ships and harbours.', { unlocks: ['harbor'], mods: { fish: 0.15 } }),
  T('currency', 'Currency', 'economics', 4, ['tradenetworks', 'prospecting'], 'Minted coin. Enables taxation.', { unlocks: ['mint'], laws: ['taxation'] }),
  T('banking', 'Banking', 'economics', 5, ['currency', 'administration'], 'Credit, ledgers and investment.', { mods: { tax: 0.25, trade: 0.15 } }),

  // Government
  T('oraltradition', 'Oral Tradition', 'government', 0, [], 'Stories carry knowledge between generations.', { unlocks: ['school', 'shrine'] }),
  T('formalleadership', 'Formal Leadership', 'government', 1, ['oraltradition'], 'A council of elders and recognised chiefs.', { unlocks: ['council'], govs: ['council'] }),
  T('codeoflaws', 'Code of Laws', 'government', 2, ['formalleadership'], 'Written customs. More laws may be enacted.', { mods: { lawSlots: 1, stability: 3 }, govs: ['monarchy'] }),
  T('administration', 'Administration', 'government', 3, ['codeoflaws', 'writing'], 'Officials manage distant settlements.', { unlocks: ['admin'], mods: { lawSlots: 1 }, govs: ['republic'] }),
  T('diplomaticcorps', 'Diplomatic Corps', 'government', 4, ['administration'], 'Envoys and permanent embassies.', { unlocks: ['w_oruvai'], mods: { relation: 0.25 } }),
  T('statecraft', 'Statecraft', 'government', 5, ['diplomaticcorps', 'education'], 'The machinery of a mature state.', { unlocks: ['capitol'], mods: { lawSlots: 1, stability: 4 }, govs: ['technocracy', 'commonwealth'] }),

  // Innovation
  T('writing', 'Writing', 'innovation', 2, ['oraltradition'], 'Scripts and scrolls. Libraries.', { unlocks: ['library', 'w_vaelith'], mods: { research: 0.1 } }),
  T('mathematics', 'Mathematics', 'innovation', 3, ['writing'], 'Measure, count and plan.', { mods: { research: 0.1, build: 0.05 } }),
  T('sanitation', 'Sanitation', 'innovation', 3, ['masonry', 'writing'], 'Drains and bathhouses curb disease.', { unlocks: ['bathhouse'], mods: { disease: -0.25 } }),
  T('education', 'Education', 'innovation', 4, ['mathematics'], 'Schools for all. Academies.', { unlocks: ['academy'], laws: ['education'] }),
  T('mechanisation', 'Mechanisation', 'innovation', 5, ['education', 'deepmining'], 'Water wheels and engines drive manufactories.', { unlocks: ['factory'], mods: { craft: 0.2 } }),
  T('scientificmethod', 'Scientific Method', 'innovation', 6, ['mechanisation'], 'Systematic experiment accelerates discovery.', { mods: { research: 0.3 } }),
];

export const TECH = Object.fromEntries(TECHS.map(t => [t.key, t]));
export const INDUSTRIAL_TECHS = ['mechanisation', 'industrialextraction', 'scientificmethod'];
