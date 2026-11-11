// Procedural soundscape with Web Audio: layered ambience (wind, water, birds,
// crickets, settlement murmur), generative music and synthesised effects.
// Separate buses for music, effects and ambience; nothing loops audibly.

let ctx = null, master, musicBus, sfxBus, ambBus, reverb;
const vol = { master: 0.8, music: 0.5, sfx: 0.7, ambience: 0.6 };
let started = false;
let amb = null;
let musicTimer = null, musicMood = 'menu';
const lastPlayed = new Map();

export function setVolumes(v) {
  Object.assign(vol, v);
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(vol.master, t, 0.1);
  musicBus.gain.setTargetAtTime(vol.music * 0.5, t, 0.1);
  sfxBus.gain.setTargetAtTime(vol.sfx * 0.7, t, 0.1);
  ambBus.gain.setTargetAtTime(vol.ambience * 0.6, t, 0.1);
}

export function initAudio() {
  if (started) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return; }
  started = true;
  master = ctx.createGain(); master.connect(ctx.destination);
  musicBus = ctx.createGain(); sfxBus = ctx.createGain(); ambBus = ctx.createGain();
  reverb = ctx.createConvolver(); reverb.buffer = impulse(2.6);
  const revGain = ctx.createGain(); revGain.gain.value = 0.35; reverb.connect(revGain); revGain.connect(master);
  for (const b of [musicBus, sfxBus, ambBus]) b.connect(master);
  musicBus.connect(reverb);
  setVolumes({});
  startAmbience();
  scheduleMusic();
}

export function resumeAudio() { if (ctx?.state === 'suspended') ctx.resume(); }

function impulse(sec) {
  const len = ctx.sampleRate * sec; const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  return b;
}
function noiseBuffer(sec = 2, color = 'white') {
  const len = ctx.sampleRate * sec; const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else if (color === 'pink') { last = 0.97 * last + 0.03 * w; d[i] = last * 4 + w * 0.15; } else d[i] = w; }
  return b;
}
function loopNoise(color, filterType, freq, q, gain) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(4, color); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(ambBus); src.start();
  return { src, f, g };
}

function startAmbience() {
  amb = {
    wind: loopNoise('pink', 'bandpass', 420, 0.6, 0.0),
    water: loopNoise('white', 'bandpass', 1300, 0.9, 0.0),
    murmur: loopNoise('brown', 'lowpass', 500, 0.5, 0.0),
    level: { wind: 0.25, water: 0, murmur: 0, birds: 0.5, crickets: 0, night: 0 },
  };
  // slow wind gusts
  setInterval(() => {
    if (!ctx || !amb) return;
    const t = ctx.currentTime; const L = amb.level;
    const gust = 0.5 + Math.random() * 0.8;
    amb.wind.g.gain.setTargetAtTime(L.wind * gust * 0.5, t, 1.5);
    amb.wind.f.frequency.setTargetAtTime(280 + Math.random() * 400, t, 2);
    amb.water.g.gain.setTargetAtTime(L.water * 0.12, t, 1);
    amb.murmur.g.gain.setTargetAtTime(L.murmur * 0.25, t, 1);
    if (Math.random() < L.birds * (1 - L.night) * 0.7) bird();
    if (Math.random() < L.night * 0.9) cricket();
  }, 900);
}

export function setAmbience(level) { if (amb) Object.assign(amb.level, level); }

function bird() {
  const t = ctx.currentTime + Math.random() * 0.3;
  const n = 2 + Math.floor(Math.random() * 4); const base = 2200 + Math.random() * 1800;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine';
    const s = t + i * (0.09 + Math.random() * 0.05);
    o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), s + 0.06);
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.035, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
    const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g); g.connect(p); p.connect(ambBus); o.start(s); o.stop(s + 0.1);
  }
}
function cricket() {
  const t = ctx.currentTime; const f = 4200 + Math.random() * 600;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'square'; o.frequency.value = f;
    const s = t + i * 0.06;
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.008, s + 0.005); g.gain.linearRampToValueAtTime(0, s + 0.035);
    o.connect(g); g.connect(ambBus); o.start(s); o.stop(s + 0.05);
  }
}

// ---------------------------------------------------------------- music
const SCALES = {
  menu: [0, 3, 5, 7, 10], oruvai: [0, 2, 4, 7, 9], kharvak: [0, 1, 5, 7, 8], thalori: [0, 2, 5, 7, 9], vaelith: [0, 2, 3, 7, 10], war: [0, 1, 3, 6, 7],
};
export function setMusicMood(m) { musicMood = m; }

function scheduleMusic() {
  let step = 0; let root = 50; let chordT = 0;
  const tick = () => {
    if (!ctx) return;
    const scale = SCALES[musicMood] || SCALES.menu;
    const t = ctx.currentTime + 0.05;
    if (step % 16 === 0) {
      // slow drone chord change
      root = [50, 45, 48, 43][(chordT++) % 4];
      pad(midi(root - 12), 7.5, 0.05); pad(midi(root - 5), 7.5, 0.03);
    }
    if (Math.random() < (musicMood === 'war' ? 0.75 : 0.55)) {
      const deg = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      pluck(midi(root + 12 + deg), t, musicMood === 'war' ? 0.06 : 0.05);
    }
    if (musicMood === 'war' && step % 4 === 0) drum(t, 0.18);
    step++;
    musicTimer = setTimeout(tick, (musicMood === 'war' ? 300 : 480) + Math.random() * 120);
  };
  tick();
}
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
function pluck(f, t, v) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2.001;
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(600, t + 1.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  const g2 = ctx.createGain(); g2.gain.value = 0.3;
  o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(musicBus);
  o.start(t); o2.start(t); o.stop(t + 2); o2.stop(t + 2);
}
function pad(f, dur, v) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.value = f; o2.frequency.value = f * 1.004;
  lp.type = 'lowpass'; lp.frequency.value = 700;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 2.5); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(musicBus);
  o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
}
function drum(t, v) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.4);
}

// ---------------------------------------------------------------- effects
function env(node, t, a, peak, d) { node.gain.setValueAtTime(0.0001, t); node.gain.linearRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(type, f, f2, dur, v, delay = 0, pan = 0) {
  const t = ctx.currentTime + delay; const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, 0.005, v, dur);
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; o.connect(g); g.connect(p); p.connect(sfxBus); }
  else { o.connect(g); g.connect(sfxBus); }
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, freq, q, v, delay = 0, type = 'bandpass', pan = 0) {
  const t = ctx.currentTime + delay; const s = ctx.createBufferSource(); s.buffer = noiseBuffer(Math.max(0.1, dur + 0.05));
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.004, v, dur);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  s.connect(f); f.connect(g); g.connect(p); p.connect(sfxBus); s.start(t); s.stop(t + dur + 0.05);
}

export function sfx(kind, opts = {}) {
  if (!ctx) return;
  const now = performance.now();
  const minGap = { hover: 40, chop: 120, hammer: 140, clash: 90 }[kind] || 30;
  if (now - (lastPlayed.get(kind) || 0) < minGap) return;
  lastPlayed.set(kind, now);
  const v = opts.vol ?? 1, pan = opts.pan || 0;
  switch (kind) {
    case 'hover': tone('square', 1800, 0, 0.02, 0.012 * v); break;
    case 'click': tone('square', 880, 660, 0.05, 0.05 * v); tone('triangle', 1320, 0, 0.04, 0.03 * v, 0.01); break;
    case 'open': noise(0.18, 900, 0.8, 0.06 * v, 0, 'bandpass'); tone('sine', 440, 660, 0.12, 0.03 * v); break;
    case 'close': noise(0.14, 600, 0.8, 0.05 * v); tone('sine', 520, 330, 0.1, 0.025 * v); break;
    case 'place': tone('sine', 140, 70, 0.18, 0.18 * v); noise(0.1, 400, 1, 0.08 * v); break;
    case 'built': [523, 659, 784].forEach((f, i) => tone('triangle', f, 0, 0.35, 0.05 * v, i * 0.07)); break;
    case 'tech': [523, 659, 784, 1046, 1318].forEach((f, i) => tone('triangle', f, 0, 0.6, 0.05 * v, i * 0.09)); noise(0.6, 6000, 2, 0.02 * v, 0.1, 'highpass'); break;
    case 'stage': [392, 523, 659, 784, 1046].forEach((f, i) => { tone('sawtooth', f, 0, 0.9, 0.025 * v, i * 0.12); tone('triangle', f / 2, 0, 1.2, 0.04 * v, i * 0.12); }); break;
    case 'diplomacy': tone('sawtooth', 294, 0, 0.5, 0.04 * v); tone('sawtooth', 440, 0, 0.6, 0.035 * v, 0.18); break;
    case 'war': drum(ctx.currentTime, 0.4 * v); drum(ctx.currentTime + 0.3, 0.35 * v); tone('sawtooth', 147, 110, 0.9, 0.05 * v, 0.1); break;
    case 'event': tone('sine', 880, 0, 1.2, 0.05 * v); tone('sine', 1318, 0, 1.4, 0.03 * v, 0.02); break;
    case 'bad': tone('triangle', 330, 220, 0.5, 0.06 * v); tone('triangle', 311, 207, 0.6, 0.04 * v, 0.12); break;
    case 'coin': tone('square', 1568, 0, 0.06, 0.03 * v); tone('square', 2093, 0, 0.12, 0.03 * v, 0.06); break;
    case 'chop': noise(0.07, 1800, 3, 0.07 * v, 0, 'bandpass', pan); tone('square', 220, 120, 0.05, 0.03 * v, 0, pan); break;
    case 'hammer': tone('square', 900, 600, 0.04, 0.03 * v, 0, pan); noise(0.04, 3000, 2, 0.04 * v, 0, 'bandpass', pan); break;
    case 'clash': noise(0.12, 4200, 4, 0.08 * v, 0, 'bandpass', pan); tone('square', 1700, 1200, 0.08, 0.02 * v, 0, pan); break;
    case 'error': tone('square', 200, 150, 0.15, 0.05 * v); break;
    case 'save': [784, 1046].forEach((f, i) => tone('triangle', f, 0, 0.2, 0.04 * v, i * 0.08)); break;
  }
}
