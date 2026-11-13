// Laws and governments. Each non-default policy consumes a law slot.
// `mods` feed the modifier system, so laws interact naturally with tech,
// tribe traits and each other. A few explicit interactions live in sim/government.js.

export const LAWS = [
  { key: 'labour', name: 'Working Hours', cat: 'Economic', options: [
    { key: 'normal', name: 'Customary Hours', desc: 'Work from dawn to dusk.', mods: {} },
    { key: 'long', name: 'Long Hours', desc: '+12% productivity, -5 happiness, worse health.', mods: { productivity: 0.12, happiness: -5, health: -0.02 } },
    { key: 'rest', name: 'Rest Days', desc: '-6% productivity, +4 happiness.', mods: { productivity: -0.06, happiness: 4 } },
  ] },
  { key: 'taxation', name: 'Taxation', cat: 'Economic', tech: 'currency', options: [
    { key: 'none', name: 'No Taxes', desc: 'The people keep what they earn.', mods: {} },
    { key: 'low', name: 'Light Taxes', desc: '+0.12 coins/citizen per season, -1 happiness.', mods: { taxRate: 0.12, happiness: -1 } },
    { key: 'moderate', name: 'Moderate Taxes', desc: '+0.25 coins/citizen per season, -3 happiness.', mods: { taxRate: 0.25, happiness: -3 } },
    { key: 'high', name: 'Heavy Taxes', desc: '+0.42 coins/citizen per season, -7 happiness, -3 stability.', mods: { taxRate: 0.42, happiness: -7, stability: -3 } },
  ] },
  { key: 'trade', name: 'Trade Regulation', cat: 'Economic', tech: 'barter', options: [
    { key: 'open', name: 'Open Markets', desc: 'Free exchange with partners.', mods: {} },
    { key: 'tariffs', name: 'Tariffs', desc: '+25% coin from trade, partners like you less.', mods: { tariff: 0.25, relationTrade: -0.5 } },
    { key: 'free', name: 'Free Trade Pact', desc: '+15% trade, +relations with partners, -2 stability.', mods: { trade: 0.15, relationTrade: 0.6, stability: -2 } },
    { key: 'protect', name: 'Protectionism', desc: '-40% trade, +15% crafting, +2 stability.', mods: { trade: -0.4, craft: 0.15, stability: 2 } },
  ] },
  { key: 'works', name: 'Public Works', cat: 'Economic', options: [
    { key: 'none', name: 'Private Building', desc: 'Families build for themselves.', mods: {} },
    { key: 'funded', name: 'Funded Works', desc: '+25% build speed. Costs wood & stone each season.', mods: { build: 0.25 }, upkeep: { wood: 0.06, stone: 0.04 } },
  ] },
  { key: 'rationing', name: 'Food Distribution', cat: 'Social', options: [
    { key: 'normal', name: 'Fair Shares', desc: 'Everyone eats their portion.', mods: {} },
    { key: 'generous', name: 'Generous Rations', desc: '+20% food eaten, +4 happiness, better health.', mods: { food: 0.2, happiness: 4, health: 0.02 } },
    { key: 'strict', name: 'Strict Rationing', desc: '-20% food eaten, -5 happiness, worse health.', mods: { food: -0.2, happiness: -5, health: -0.02 } },
  ] },
  { key: 'housing', name: 'Housing Priority', cat: 'Social', options: [
    { key: 'family', name: 'Family Homes', desc: '+20% births.', mods: { birth: 0.2 } },
    { key: 'workers', name: 'Worker Lodging', desc: '+6% productivity, -25% births.', mods: { productivity: 0.06, birth: -0.25 } },
  ] },
  { key: 'welfare', name: 'Welfare', cat: 'Social', tech: 'codeoflaws', options: [
    { key: 'none', name: 'Self-Reliance', desc: 'No public support.', mods: {} },
    { key: 'relief', name: 'Poor Relief', desc: 'Unemployed are cared for: +3 happiness, costs food.', mods: { happiness: 3, idleUnrest: -1 }, upkeep: { grain: 0.04 } },
  ] },
  { key: 'education', name: 'Education Priority', cat: 'Social', tech: 'writing', options: [
    { key: 'none', name: 'Informal Learning', desc: 'Skills pass from parent to child.', mods: {} },
    { key: 'apprentice', name: 'Apprenticeships', desc: 'Workers gain skill 50% faster.', mods: { skill: 0.5 } },
    { key: 'public', name: 'Public Schooling', desc: '+15% research, +2 happiness. Costs coins.', mods: { research: 0.15, happiness: 2 }, upkeep: { coins: 0.05 }, tech: 'education' },
  ] },
  { key: 'recruitment', name: 'Recruitment', cat: 'Military', tech: 'militaryorganisation', options: [
    { key: 'volunteer', name: 'Volunteers', desc: 'Only the willing serve.', mods: {} },
    { key: 'levy', name: 'Levy', desc: '+50% soldier capacity, -2 happiness.', mods: { soldierCap: 0.5, happiness: -2 } },
    { key: 'conscription', name: 'Conscription', desc: '+100% soldier capacity, -5 happiness, -4% productivity.', mods: { soldierCap: 1.0, happiness: -5, productivity: -0.04 } },
  ] },
  { key: 'defence', name: 'Defence Spending', cat: 'Military', options: [
    { key: 'normal', name: 'Standard', desc: 'Balanced upkeep.', mods: {} },
    { key: 'low', name: 'Lean Military', desc: '-35% military upkeep, -15% strength.', mods: { upkeep: -0.35, military: -0.15 } },
    { key: 'high', name: 'War Footing', desc: '+40% upkeep, +15% strength, +20% defence.', mods: { upkeep: 0.4, military: 0.15, defense: 0.2 } },
  ] },
  { key: 'forestry', name: 'Forest Management', cat: 'Environmental', options: [
    { key: 'free', name: 'Free Logging', desc: 'Cut what you need.', mods: {} },
    { key: 'managed', name: 'Managed Forestry', desc: '-10% wood, forests regrow twice as fast.', mods: { wood: -0.1, forestRegrow: 1.0 } },
    { key: 'sacred', name: 'Sacred Groves', desc: '-30% wood, regrowth x3, +3 happiness.', mods: { wood: -0.3, forestRegrow: 2.0, happiness: 3 } },
  ] },
  { key: 'extraction', name: 'Extraction Rules', cat: 'Environmental', tech: 'mining', options: [
    { key: 'open', name: 'Unrestricted', desc: 'Dig freely.', mods: {} },
    { key: 'regulated', name: 'Regulated Mining', desc: '-10% mining, deposits deplete 40% slower, +1 happiness.', mods: { mine: -0.1, depletion: -0.4, happiness: 1 } },
  ] },
  { key: 'land', name: 'Land Use', cat: 'Environmental', tech: 'cultivation', options: [
    { key: 'open', name: 'Open Commons', desc: 'Anyone may graze and hunt.', mods: {} },
    { key: 'protect', name: 'Protected Farmland', desc: '+12% farms, -15% hunting, -10% build speed.', mods: { farm: 0.12, hunt: -0.15, build: -0.1 } },
    { key: 'hunting', name: 'Hunting Grounds', desc: '+25% hunting, wildlife regrows faster, -8% farms.', mods: { hunt: 0.25, gameRegrow: 0.6, farm: -0.08 } },
  ] },
];
export const LAW = Object.fromEntries(LAWS.map(l => [l.key, l]));

export const GOVERNMENTS = {
  chiefdom:     { name: 'Chieftainship', desc: 'A single elder leads by custom and respect.', lawSlots: 1, mods: {} },
  council:      { name: 'Council of Elders', desc: 'Clan heads decide together. Requires a Council Hall.', lawSlots: 2, mods: { stability: 5, relation: 0.1 }, building: 'council', tech: 'formalleadership', favours: 'oruvai' },
  monarchy:     { name: 'Monarchy', desc: 'A ruling house commands loyalty and arms.', lawSlots: 2, mods: { stability: 8, military: 0.1, happiness: -1 }, tech: 'codeoflaws', favours: 'kharvak' },
  republic:     { name: 'Republic', desc: 'Elected magistrates. Prosperous and lively, if fractious.', lawSlots: 3, mods: { trade: 0.15, happiness: 3, stability: -2 }, tech: 'administration', building: 'admin', favours: 'oruvai' },
  technocracy:  { name: 'Technocracy', desc: 'Rule by the learned.', lawSlots: 3, mods: { research: 0.2, craft: 0.1, happiness: -1 }, tech: 'statecraft', favours: 'vaelith' },
  commonwealth: { name: 'Commonwealth', desc: 'Shared stewardship of land and harvest.', lawSlots: 3, mods: { farm: 0.1, happiness: 4, stability: 3 }, tech: 'statecraft', favours: 'thalori' },
};
