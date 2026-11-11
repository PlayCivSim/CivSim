// Biome definitions: palette (for the pixel renderer) and gameplay properties.

export const B = {
  DEEP: 0, OCEAN: 1, SHALLOW: 2, LAKE: 3, RIVER: 4, BEACH: 5, GRASS: 6, FOREST: 7, DENSE: 8,
  HILLS: 9, MOUNTAIN: 10, PEAK: 11, DESERT: 12, SWAMP: 13, TUNDRA: 14, SNOW: 15, VALLEY: 16,
};

// cols: [base, alt, dark, light]
export const BIOMES = [
  { id: 0,  key: 'deep',     name: 'Deep Ocean',   water: true,  walk: 0,   cols: ['#1f4fa8', '#2152ad', '#1a4596', '#2a5db8'] },
  { id: 1,  key: 'ocean',    name: 'Ocean',        water: true,  walk: 0,   cols: ['#2a62c2', '#2c66c8', '#2559b3', '#3570d0'] },
  { id: 2,  key: 'shallow',  name: 'Shallows',     water: true,  walk: 0,   cols: ['#3a7fd6', '#3d84da', '#3577cc', '#4a92e2'], fish: 1.0 },
  { id: 3,  key: 'lake',     name: 'Lake',         water: true,  walk: 0,   cols: ['#3576cf', '#377ad3', '#2f6cc2', '#4688dd'], fish: 0.8 },
  { id: 4,  key: 'river',    name: 'River',        water: true,  walk: 5,   cols: ['#3f86da', '#438bde', '#387bcd', '#5aa0ea'], fish: 0.6, river: true },
  { id: 5,  key: 'beach',    name: 'Coast',        walk: 1.2, build: true, fert: 0.15, cols: ['#e6cf8d', '#ebd697', '#d6bc78', '#f3e2aa'], fibre: 0.3, salt: true },
  { id: 6,  key: 'grass',    name: 'Grassland',    walk: 1,   build: true, fert: 0.8, trees: 0.08, game: 0.4, fibre: 0.6, cols: ['#6fb23e', '#78ba43', '#62a136', '#86c650'] },
  { id: 7,  key: 'forest',   name: 'Forest',       walk: 1.5, build: true, fert: 0.55, trees: 0.55, game: 0.8, herbs: 0.4, fibre: 0.3, cols: ['#4f9a32', '#57a136', '#448a2b', '#62ac3d'] },
  { id: 8,  key: 'dense',    name: 'Dense Forest', walk: 2,   build: true, fert: 0.4, trees: 0.85, game: 1.0, herbs: 0.7, cols: ['#3c8128', '#42882b', '#336f22', '#4a9231'] },
  { id: 9,  key: 'hills',    name: 'Hills',        walk: 1.8, build: true, fert: 0.35, trees: 0.12, game: 0.3, cols: ['#7f9a4a', '#869f50', '#6d8840', '#94ad5d'], defense: 0.25 },
  { id: 10, key: 'mountain', name: 'Mountains',    walk: 3.5, build: false, cols: ['#5b5a5e', '#636267', '#4a494d', '#77767b'], defense: 0.4 },
  { id: 11, key: 'peak',     name: 'Snowy Peaks',  walk: 0,   cols: ['#e9eef3', '#f4f7fa', '#c9d2dc', '#ffffff'] },
  { id: 12, key: 'desert',   name: 'Desert',       walk: 1.4, build: true, fert: 0.05, trees: 0.03, game: 0.1, cols: ['#dcbf74', '#e2c67c', '#cfae62', '#ead38f'] },
  { id: 13, key: 'swamp',    name: 'Swamp',        walk: 2.4, build: true, fert: 0.3, trees: 0.3, game: 0.5, herbs: 1.0, fibre: 0.8, cols: ['#55704a', '#5b7650', '#48613f', '#6a855b'] },
  { id: 14, key: 'tundra',   name: 'Tundra',       walk: 1.4, build: true, fert: 0.12, trees: 0.1, game: 0.5, cols: ['#a7b59a', '#afbca2', '#97a68a', '#bcc8b0'], fur: true },
  { id: 15, key: 'snow',     name: 'Snowfield',    walk: 2,   build: true, fert: 0.02, trees: 0.12, game: 0.25, cols: ['#e3e9ef', '#eaeff4', '#d0d9e2', '#f6f9fb'] },
  { id: 16, key: 'valley',   name: 'Fertile Valley', walk: 1, build: true, fert: 1.25, trees: 0.06, game: 0.5, fibre: 0.7, cols: ['#7cc444', '#84cb4a', '#6eb43b', '#93d659'] },
];

export const isWater = b => b <= 4;
export const isLand = b => b > 4;

export function biomeKeyForAffinity(b) {
  switch (b) {
    case B.BEACH: return 'coast';
    case B.GRASS: return 'grass';
    case B.FOREST: case B.DENSE: return 'forest';
    case B.HILLS: return 'hills';
    case B.DESERT: return 'desert';
    case B.SWAMP: return 'swamp';
    case B.VALLEY: return 'valley';
    default: return null;
  }
}
