// Persistent data model + pure simulation helpers (no rendering here).
import { FOODS, TOYS, PET_SPOTS, TRICKS, FoodId, ToyId, PetSpot, DecorSlot, BODY_TYPES, EAR_TYPES, TAIL_TYPES, EYE_TYPES, MARKINGS, PALETTES } from './data';
import { clamp01, seeded } from './util';
import { emptyWalkMem, type WalkMem } from './walkmem';

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
  /** Slow-moving behavioural tendencies (see pet/context.ts). Missing in older saves → {}. */
  habits: Record<string, number>;
  /** Walkies memory (see walkmem.ts). Missing in older saves → defaults. */
  walk: WalkMem;
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
  return { foods: {}, toys: {}, spots: {}, tricks, traitsRevealed: [], collect: {}, journal: [], recent: [], counters: {}, habits: {}, walk: emptyWalkMem() };
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

/** Old single-pet format (kept for tests and as the migration source; the game writes the v2 store). */
export function writeSave(save: SaveData, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    save.lastSeen = Date.now();
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}


// ---------- Several Fuzzlets (save format v2) ----------
//
// One container holds up to MAX_PETS pets, each with its own complete SaveData (memories,
// friendship, twinkles, room, habits, walks, keepsakes, achievements…). Settings are global.
// The old single-pet save (SAVE_KEY) is read once to migrate and is never modified or removed,
// so it stays on the device as a backup of the original pet.
//
// Safety rules (enforced here, tested in tests/pets.test.ts):
// - adding a pet never replaces or touches another one, and fails when the home is full;
// - only removePet() deletes a pet, and only the one asked for;
// - a store that can't be read is set aside under a separate key, never overwritten.
export const STORE_KEY = 'fuzzlet.save.v2';
export const STORE_VERSION = 2;
export const MAX_PETS = 3;

export interface SaveStore {
  version: number;
  activePetId: string | null;
  /** Pet ids in the order they came home (slot order). */
  order: string[];
  pets: Record<string, SaveData>;
  /** Global settings: volume, motion, contrast, text size. */
  settings: Settings;
  /** Id the old single-pet save was given when it was migrated (if any). */
  legacyId?: string;
}

export function emptyStore(settings: Settings = defaultSettings()): SaveStore {
  return { version: STORE_VERSION, activePetId: null, order: [], pets: {}, settings };
}

export function newPetId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (let i = 0; i < 100; i++) {
    const id = 'pet-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    if (!used.has(id)) return id;
  }
  return 'pet-' + Math.random().toString(36).slice(2);
}

/** Wrap an old single-pet save (already migrated) as slot 1 of a new store. */
export function storeFromLegacy(save: SaveData): SaveStore {
  const id = 'pet-1';
  const settings = deepFill(save.settings, defaultSettings()) as Settings;
  const store: SaveStore = { version: STORE_VERSION, activePetId: id, order: [id], pets: { [id]: save }, settings, legacyId: id };
  save.settings = settings;
  return store;
}

/** Validate and upgrade a parsed store. Pets that can't be read are dropped from this copy only. */
export function migrateStore(raw: any): SaveStore | null {
  if (!raw || typeof raw !== 'object' || typeof raw.pets !== 'object' || raw.pets === null) return null;
  const settings = deepFill(raw.settings ?? {}, defaultSettings()) as Settings;
  const pets: Record<string, SaveData> = {};
  const order: string[] = [];
  const ids: string[] = Array.isArray(raw.order) ? raw.order.filter((x: unknown) => typeof x === 'string') : [];
  for (const id of Object.keys(raw.pets)) if (!ids.includes(id)) ids.push(id);
  for (const id of ids) {
    if (order.includes(id)) continue; // (never drop a pet, even past the limit: nothing is lost)
    const pet = migrate(raw.pets[id]);
    if (!pet) continue;
    pet.settings = settings;
    pets[id] = pet;
    order.push(id);
  }
  const activePetId = typeof raw.activePetId === 'string' && pets[raw.activePetId] ? raw.activePetId : order[0] ?? null;
  return { version: STORE_VERSION, activePetId, order, pets, settings, legacyId: typeof raw.legacyId === 'string' ? raw.legacyId : undefined };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The stored pets as they are right now, or null if there's nothing readable (no side effects). */
export function readStore(storage: Pick<Storage, 'getItem'> = localStorage): SaveStore | null {
  try { const txt = storage.getItem(STORE_KEY); return txt ? migrateStore(JSON.parse(txt)) : null; } catch { return null; }
}

/**
 * Load all pets. Order of preference: the v2 store; else the old single-pet save, migrated into
 * slot 1 (and written as v2 straight away; the old key is left untouched); else an empty store.
 */
export function loadStore(storage: Store = localStorage): { store: SaveStore; migrated: boolean; problem?: string } {
  let problem: string | undefined;
  let txt: string | null = null;
  try { txt = storage.getItem(STORE_KEY); } catch { problem = 'storage unavailable'; }
  if (txt) {
    try {
      const st = migrateStore(JSON.parse(txt));
      if (st) return { store: st, migrated: false };
      problem = 'unreadable pet store';
    } catch { problem = 'unreadable pet store'; }
    // keep the unreadable data safe under another key instead of ever overwriting it
    try { storage.setItem(`${STORE_KEY}.unreadable-${Date.now()}`, txt); } catch { /* ignore */ }
  }
  const legacy = loadSave(storage);
  if (legacy) {
    const store = storeFromLegacy(legacy);
    writeStore(store, storage);
    return { store, migrated: true, problem };
  }
  return { store: emptyStore(), migrated: false, problem };
}

export function writeStore(store: SaveStore, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    // settings are stored once, globally (each pet's `settings` is the same shared object)
    storage.setItem(STORE_KEY, JSON.stringify(store, function (this: unknown, k, v) { return k === 'settings' && this !== store ? undefined : v; }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read-modify-write: apply a change to the pets as they are stored *right now*, then write. A save
 * therefore only ever changes what it means to change — it can never undo a pet adopted, played
 * or removed somewhere else (e.g. the game open in a second browser tab). `fallback` is used when
 * nothing readable is stored yet. Returns the store as written (the caller keeps it).
 */
export function updateStore(mutate: (st: SaveStore) => void, fallback: SaveStore, storage: Store = localStorage): { store: SaveStore; ok: boolean } {
  let base: SaveStore | null = null;
  try {
    const txt = storage.getItem(STORE_KEY);
    if (txt) {
      try { base = migrateStore(JSON.parse(txt)); } catch { base = null; }
      if (!base) { try { storage.setItem(`${STORE_KEY}.unreadable-${Date.now()}`, txt); } catch { /* ignore */ } }
    }
  } catch { /* storage unavailable: work in memory */ }
  const st = base ?? fallback;
  if (base) base.settings = fallback.settings; // settings changed here win (they're global and small)
  for (const id of st.order) st.pets[id].settings = st.settings;
  mutate(st);
  return { store: st, ok: writeStore(st, storage) };
}

export const canAddPet = (store: SaveStore) => store.order.length < MAX_PETS;

/** Add a newly adopted pet in a free slot and make it the active one. Never replaces anyone. */
export function addPet(store: SaveStore, save: SaveData): string | null {
  if (!canAddPet(store)) return null;
  const id = newPetId(store.order);
  save.settings = store.settings;
  store.pets[id] = save;
  store.order.push(id);
  store.activePetId = id;
  return id;
}

/** Permanently remove one pet (the UI asks for a deliberate, held confirmation first). */
export function removePet(store: SaveStore, id: string): boolean {
  if (!store.pets[id]) return false;
  delete store.pets[id];
  store.order = store.order.filter((x) => x !== id);
  if (store.activePetId === id) store.activePetId = store.order[0] ?? null;
  return true;
}

export function setActivePet(store: SaveStore, id: string): SaveData | null {
  const pet = store.pets[id];
  if (!pet) return null;
  store.activePetId = id;
  pet.settings = store.settings;
  return pet;
}

export function activePet(store: SaveStore): SaveData | null {
  return store.activePetId ? store.pets[store.activePetId] ?? null : null;
}

/**
 * Deliberate, press-and-hold confirmation (for removing a pet). Letting go early resets it;
 * a tap can never complete it. Pure state so it can be tested without a DOM.
 */
export class HoldConfirm {
  held = 0;
  holding = false;
  done = false;
  constructor(public need = 2) {}
  press() { if (!this.done) this.holding = true; }
  release() { this.holding = false; if (!this.done) this.held = 0; }
  /** Advance time; returns true exactly once, when the hold completes. */
  update(dt: number): boolean {
    if (this.done || !this.holding) return false;
    this.held += Math.min(dt, 0.1); // a stalled frame can't skip the wait
    if (this.held >= this.need) { this.done = true; this.holding = false; return true; }
    return false;
  }
  get progress() { return this.done ? 1 : Math.min(1, this.held / this.need); }
}

export function friendshipLevel(xp: number, levels: { xp: number }[]) {
  let l = 0;
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i].xp) l = i;
  return l;
}

export type { FoodId, ToyId, PetSpot };
