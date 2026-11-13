// Shared simulation constants. Time is measured in fixed ticks so the
// simulation is independent of rendering frame rate and behaves identically
// at every speed setting.

export const TILE = 8;                 // art pixels per tile
export const TICKS_PER_SECOND = 10;    // at 1x speed
export const TICK_DT = 1 / TICKS_PER_SECOND;
export const DAY_TICKS = 360;          // one in-game day = 36s at 1x
export const DAYS_PER_YEAR = 4;        // one season per day
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const WORK_AGE = 10;            // years
export const ELDER_AGE = 58;
export const SPEEDS = [0, 1, 3, 8];
export const SPEED_NAMES = ['Paused', 'Normal', 'Fast', 'Very Fast'];

export const MAP_SIZES = {
  small:  { w: 256, h: 200, label: 'Small',  desc: 'Close quarters. Rivals are never far.' },
  medium: { w: 384, h: 300, label: 'Medium', desc: 'A balanced continent with room to grow.' },
  large:  { w: 576, h: 448, label: 'Large',  desc: 'A vast world of distant frontiers. Rivals may be weeks of travel away.' },
};

export const DIFFICULTIES = {
  gentle:   { label: 'Gentle',   aiBonus: 0, skill: 0.6, eventSeverity: 0.7, desc: 'Forgiving events. Rival rulers misjudge and rarely exploit your weakness.' },
  balanced: { label: 'Balanced', aiBonus: 0, skill: 1.0, eventSeverity: 1.0, desc: 'The world as intended.' },
  harsh:    { label: 'Harsh',    aiBonus: 0, skill: 1.4, eventSeverity: 1.3, desc: 'Unforgiving seasons. Rivals plan more often, strike when you are weak and only fight wars they can win. No unfair bonuses.' },
};

export const STARTS = {
  humble:   { label: 'Humble Beginnings', pop: 10, stock: 0.7, desc: 'A small band with meagre supplies.' },
  standard: { label: 'Standard',          pop: 14, stock: 1.0, desc: 'A healthy tribe and a season of stores.' },
  bountiful:{ label: 'Bountiful',         pop: 18, stock: 1.5, desc: 'A thriving clan with full granaries.' },
};
