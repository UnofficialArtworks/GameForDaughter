// Persistent data model + pure simulation helpers (no rendering here).
import { FOODS, TOYS, PET_SPOTS, TRICKS, FoodId, ToyId, PetSpot, DecorSlot, BODY_TYPES, EAR_TYPES, TAIL_TYPES, EYE_TYPES, MARKINGS, PALETTES } from './data';
import { clamp01, seeded } from './util';

export interface Traits { energy: number; brave: number; cuddly: number; appetite: number; playful: number; curious: number; }
export type TraitId = keyof Traits;
export interface Needs { hunger: number; energy: number; clean: number; fun: number; affection: number; }
export interface Appearance {
  body: (typeof BODY_TYPES)[number];
  ears: (typeof EAR_TYPES)[number];
  tail: (typeof TAIL_TYPES)[number];
  eyes: (typeof EYE_TYPES)[number];
  marking: (typeof MARKINGS)[number];
  palette: number;
}
export interface Hidden { food: Record<string, number>; toy: Record<string, number>; spot: Record<string, number>; }
export interface JournalEntry { t: number; icon: string; text: string; }
export interface MemoryData {
  foods: Record<string, { tastes: number; liking: number }>;
  toys: Record<string, { plays: number; liking: number }>;
  spots: Record<string, { pets: number; liking: number }>;
  tricks: Record<string, { prof: number; learned: boolean; performed: number }>;
  favFood?: string;
  dislikedFood?: string;
  favToy?: string;
  favSpot?: string;
  traitsRevealed: string[];
  collect: Record<string, number>;
  journal: JournalEntry[];
  recent: { t: number; what: string }[];
  counters: Record<string, number>;
}
export interface Settings { music: number; sfx: number; reducedMotion: boolean; highContrast: boolean; largeText: boolean; }
export interface SaveData {
  version: number;
  createdAt: number;
  lastSeen: number;
  lastDay: string;
  playTime: number;
  pet: { name: string; appearance: Appearance; traits: Traits; hidden: Hidden; needs: Needs; friendship: number; seed: number; };
  memory: MemoryData;
  twinkles: number;
  inventory: { foods: Record<string, number>; toys: string[]; wear: string[]; decor: string[] };
  equipped: { wear: Partial<Record<'head' | 'face' | 'neck', string>>; decor: Record<DecorSlot, string> };
  room: { water: number; bowl: number };
  achievements: string[];
  flags: Record<string, boolean>;
  settings: Settings;
}

export const SAVE_VERSION = 1;

export function defaultSettings(): Settings {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { music: 0.5, sfx: 0.8, reducedMotion: reduce, highContrast: false, largeText: false };
}

export function randomTraits(rng: () => number = Math.random): Traits {
  const t = (): number => {
    // bias away from the dead-centre so pets feel distinct
    const r = rng();
    return clamp01(0.5 + (r - 0.5) * 1.3);
  };
  const traits: Traits = { energy: t(), brave: t(), cuddly: t(), appetite: t(), playful: t(), curious: t() };
  // guarantee at least two standout traits
  const keys = Object.keys(traits) as TraitId[];
  for (let i = 0; i < 2; i++) {
    const k = keys[Math.floor(rng() * keys.length)];
    traits[k] = rng() < 0.5 ? 0.08 + rng() * 0.12 : 0.82 + rng() * 0.15;
  }
  return traits;
}

export function randomAppearance(rng: () => number = Math.random): Appearance {
  const p = <T>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
  return {
    body: p(BODY_TYPES), ears: p(EAR_TYPES), tail: p(TAIL_TYPES), eyes: p(EYE_TYPES),
    marking: p(MARKINGS), palette: Math.floor(rng() * PALETTES.length),
  };
}

/** Hidden "true" preferences. They are only discovered through play. */
export function makeHidden(seed: number, traits: Traits): Hidden {
  const rng = seeded(seed);
  const food: Record<string, number> = {};
  const others = FOODS.filter((f) => f.id !== 'kibble').map((f) => f.id);
  for (const id of others) food[id] = -0.5 + rng() * 1.1 + (traits.appetite - 0.5) * 0.5;
  food.kibble = 0.25;
  const fav = others[Math.floor(rng() * others.length)];
  food[fav] = 0.95;
  let dis = others[Math.floor(rng() * others.length)];
  if (dis === fav) dis = others[(others.indexOf(fav) + 3) % others.length];
  food[dis] = traits.appetite > 0.8 ? -0.35 : -0.7; // food lovers only mildly dislike
  const toy: Record<string, number> = {};
  for (const t of TOYS) toy[t.id] = 0.2 + rng() * 0.5 + (traits.playful - 0.5) * 0.2;
  toy[TOYS[Math.floor(rng() * TOYS.length)].id] = 0.95;
  const spot: Record<string, number> = {};
  for (const s of PET_SPOTS) spot[s] = 0.15 + rng() * 0.4;
  spot[PET_SPOTS[Math.floor(rng() * PET_SPOTS.length)]] = 0.95;
  return { food, toy, spot };
}

export function emptyMemory(): MemoryData {
  const tricks: MemoryData['tricks'] = {};
  for (const t of TRICKS) tricks[t.id] = { prof: 0, learned: false, performed: 0 };
  return { foods: {}, toys: {}, spots: {}, tricks, traitsRevealed: [], collect: {}, journal: [], recent: [], counters: {} };
}

export function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function newSave(name: string, appearance: Appearance, traits?: Traits, seed?: number): SaveData {
  const s = seed ?? Math.floor(Math.random() * 1e9);
  const tr = traits ?? randomTraits();
  const t = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: t,
    lastSeen: t,
    lastDay: dayKey(t),
    playTime: 0,
    pet: { name, appearance, traits: tr, hidden: makeHidden(s, tr), needs: { hunger: 0.7, energy: 0.9, clean: 0.9, fun: 0.6, affection: 0.5 }, friendship: 0, seed: s },
    memory: emptyMemory(),
    twinkles: 20,
    inventory: { foods: { apple: 2, strawberry: 2, carrot: 2, cookie: 2 }, toys: ['ball'], wear: [], decor: ['bed_basic', 'rug_round', 'bowls_basic', 'wall_sun', 'curtains_yellow', 'basket_wicker', 'garden_none'] },
    equipped: { wear: {}, decor: { bed: 'bed_basic', rug: 'rug_round', bowls: 'bowls_basic', wall: 'wall_sun', curtains: 'curtains_yellow', basket: 'basket_wicker', garden: 'garden_none' } },
    room: { water: 1, bowl: 0 },
    achievements: [],
    flags: {},
    settings: defaultSettings(),
  };
}

// ---------- Needs ----------
/** Per-second decay while playing. Deliberately gentle. */
export function decayNeeds(n: Needs, tr: Traits, dt: number, asleep: boolean) {
  const m = dt / 60; // per minute
  n.hunger = clamp01(n.hunger - m * (0.012 + tr.appetite * 0.006));
  n.clean = clamp01(n.clean - m * 0.004);
  n.fun = clamp01(n.fun - m * (0.012 + tr.playful * 0.01));
  n.affection = clamp01(n.affection - m * (0.01 + tr.cuddly * 0.01));
  if (asleep) n.energy = clamp01(n.energy + m * 0.25);
  else n.energy = clamp01(n.energy - m * (0.012 + tr.energy * 0.004));
}

export const OFFLINE_FLOOR = 0.35;
/** Offline time is very gentle: slow decay, capped floor, energy restored by sleeping. */
export function applyOffline(save: SaveData, seconds: number) {
  if (seconds <= 0) return;
  const n = save.pet.needs;
  const m = Math.min(seconds, 3 * 86400) / 60;
  const dec = (v: number, rate: number) => (v <= OFFLINE_FLOOR ? v : Math.max(OFFLINE_FLOOR, v - rate * m));
  n.hunger = dec(n.hunger, 0.003);
  n.clean = dec(n.clean, 0.001);
  n.fun = dec(n.fun, 0.003);
  n.affection = dec(n.affection, 0.003);
  n.energy = clamp01(n.energy + m * 0.05);
  // water evaporates only a bit, food bowl gets eaten
  save.room.bowl = seconds > 1800 ? 0 : save.room.bowl;
}

// ---------- Save / Load ----------
export const SAVE_KEY = 'fuzzlet.save';

export function migrate(raw: any): SaveData | null {
  if (!raw || typeof raw !== 'object' || !raw.pet) return null;
  if (typeof raw.version !== 'number') return null;
  // Fill any missing fields from a template so old saves keep working.
  const tpl = newSave(raw.pet.name ?? 'Pet', raw.pet.appearance ?? randomAppearance(), raw.pet.traits, raw.pet.seed);
  const merged: SaveData = deepFill(raw, tpl);
  merged.version = SAVE_VERSION;
  return merged;
}

function deepFill(obj: any, tpl: any): any {
  if (obj === undefined || obj === null) return tpl;
  if (typeof tpl !== 'object' || tpl === null || Array.isArray(tpl)) return obj;
  const out: any = { ...obj };
  for (const k of Object.keys(tpl)) {
    out[k] = k in obj ? deepFill(obj[k], tpl[k]) : tpl[k];
  }
  return out;
}

export function loadSave(storage: Pick<Storage, 'getItem'> = localStorage): SaveData | null {
  try {
    const txt = storage.getItem(SAVE_KEY);
    if (!txt) return null;
    return migrate(JSON.parse(txt));
  } catch {
    return null;
  }
}

export function writeSave(save: SaveData, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    save.lastSeen = Date.now();
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage: Pick<Storage, 'removeItem'> = localStorage) {
  try { storage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function friendshipLevel(xp: number, levels: { xp: number }[]) {
  let l = 0;
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i].xp) l = i;
  return l;
}

export type { FoodId, ToyId, PetSpot };
