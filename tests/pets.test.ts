import { describe, it, expect } from 'vitest';
import {
  newSave, randomAppearance, loadStore, writeStore, updateStore, readStore, addPet, removePet, setActivePet, activePet, canAddPet,
  HoldConfirm, MAX_PETS, SAVE_KEY, STORE_KEY, type SaveData,
} from '../src/state';

/** A localStorage stand-in. */
function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

/** A well-played old single-pet save (the shape the previous build wrote). */
function oldSave(): SaveData {
  const s = newSave('Biscuit', randomAppearance());
  s.pet.friendship = 212;
  s.twinkles = 57;
  s.memory.journal.push({ t: 1, icon: 'heart', text: 'Biscuit came home!' });
  s.memory.collect = { acorn: 2, smoothstone: 1 };
  s.memory.walk.walks = 4; s.memory.walk.fav = 'puddle';
  s.memory.habits = { walkies: 0.5 };
  s.memory.tricks.sit = { prof: 100, learned: true, performed: 3 };
  s.inventory.toys.push('squeaky');
  s.equipped.wear.head = 'bow';
  s.achievements.push('walkies');
  s.settings.sfx = 0.3; s.settings.largeText = true;
  return s;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** Everything that belongs to the pet (settings are global now, so compared separately). */
const petPart = (s: SaveData) => { const c = clone(s) as Partial<SaveData>; delete c.settings; return c; };

describe('old save → several-pets store', () => {
  it('migrates the old single pet into slot 1, unchanged, and leaves the old save in place', () => {
    const old = oldSave();
    const raw = JSON.stringify(old);
    const st = memStorage({ [SAVE_KEY]: raw });
    const { store, migrated } = loadStore(st);
    expect(migrated).toBe(true);
    expect(store.order.length).toBe(1);
    const pet = activePet(store)!;
    expect(petPart(pet)).toEqual(petPart(old));
    expect(store.settings.sfx).toBe(0.3); // the old settings become the global ones
    expect(store.settings.largeText).toBe(true);
    expect(st.getItem(SAVE_KEY)).toBe(raw); // backup untouched
    expect(st.getItem(STORE_KEY)).not.toBeNull(); // written as v2 straight away
    // and a second load reads v2 (no double migration)
    const again = loadStore(st);
    expect(again.migrated).toBe(false);
    expect(petPart(activePet(again.store)!)).toEqual(petPart(old));
  });

  it('an unreadable store is set aside (never overwritten) and the old save still loads', () => {
    const st = memStorage({ [SAVE_KEY]: JSON.stringify(oldSave()), [STORE_KEY]: '{not json' });
    const { store, problem } = loadStore(st);
    expect(problem).toBeTruthy();
    expect(activePet(store)!.pet.name).toBe('Biscuit');
    expect(st.keys().some((k) => k.startsWith(`${STORE_KEY}.unreadable-`))).toBe(true);
  });

  it('a device with no save starts empty', () => {
    const { store } = loadStore(memStorage());
    expect(store.order).toEqual([]);
    expect(activePet(store)).toBeNull();
  });
});

describe('up to three Fuzzlets', () => {
  it('adopting another never touches the first; each pet keeps its own state', () => {
    const st = memStorage({ [SAVE_KEY]: JSON.stringify(oldSave()) });
    const { store } = loadStore(st);
    const firstId = store.activePetId!;
    const before = petPart(store.pets[firstId]);
    const mochi = newSave('Mochi', randomAppearance());
    const id2 = addPet(store, mochi)!;
    expect(id2).toBeTruthy();
    expect(id2).not.toBe(firstId);
    expect(store.activePetId).toBe(id2); // the new pet becomes active
    // play with the second pet
    mochi.twinkles += 100; mochi.pet.friendship = 999; mochi.memory.collect.acorn = 9; mochi.memory.walk.walks = 12;
    writeStore(store, st);
    // switch back: the first pet is exactly as it was
    const reloaded = loadStore(st).store;
    const first = setActivePet(reloaded, firstId)!;
    expect(petPart(first)).toEqual(before);
    expect(reloaded.pets[id2].twinkles).toBe(mochi.twinkles);
    expect(reloaded.pets[id2].memory.walk.walks).toBe(12);
    expect(reloaded.activePetId).toBe(firstId);
  });

  it('a third is fine, a fourth is refused and nothing is replaced', () => {
    const { store } = loadStore(memStorage({ [SAVE_KEY]: JSON.stringify(oldSave()) }));
    expect(addPet(store, newSave('Mochi', randomAppearance()))).toBeTruthy();
    expect(addPet(store, newSave('Pip', randomAppearance()))).toBeTruthy();
    expect(store.order.length).toBe(MAX_PETS);
    expect(canAddPet(store)).toBe(false);
    const snapshot = clone(store);
    expect(addPet(store, newSave('Extra', randomAppearance()))).toBeNull();
    expect(clone(store)).toEqual(snapshot);
    expect(store.order.map((id) => store.pets[id].pet.name)).toEqual(['Biscuit', 'Mochi', 'Pip']);
  });

  it('removing one pet leaves the others intact (and frees a slot)', () => {
    const st = memStorage({ [SAVE_KEY]: JSON.stringify(oldSave()) });
    const { store } = loadStore(st);
    const a = store.activePetId!;
    const b = addPet(store, newSave('Mochi', randomAppearance()))!;
    const c = addPet(store, newSave('Pip', randomAppearance()))!;
    const keepA = petPart(store.pets[a]), keepC = petPart(store.pets[c]);
    setActivePet(store, b);
    expect(removePet(store, b)).toBe(true);
    expect(store.order).toEqual([a, c]);
    expect(store.activePetId).toBe(a); // the active pet was removed → falls back to slot 1
    expect(petPart(store.pets[a])).toEqual(keepA);
    expect(petPart(store.pets[c])).toEqual(keepC);
    expect(canAddPet(store)).toBe(true);
    expect(removePet(store, 'nobody')).toBe(false);
    writeStore(store, st);
    expect(loadStore(st).store.order).toEqual([a, c]);
  });

  it('settings are global and survive switching pets (and a reload)', () => {
    const st = memStorage();
    const { store } = loadStore(st);
    const a = newSave('Biscuit', randomAppearance()), b = newSave('Mochi', randomAppearance());
    const ida = addPet(store, a)!, idb = addPet(store, b)!;
    store.settings.music = 0.1; store.settings.reducedMotion = true;
    expect(setActivePet(store, ida)!.settings).toBe(store.settings);
    expect(setActivePet(store, idb)!.settings.reducedMotion).toBe(true);
    writeStore(store, st);
    const back = loadStore(st).store;
    expect(back.settings.music).toBe(0.1);
    expect(back.pets[ida].settings).toBe(back.settings);
    expect(back.pets[idb].settings).toBe(back.settings);
    expect(JSON.parse(st.getItem(STORE_KEY)!).pets[ida].settings).toBeUndefined(); // stored once
  });
});

describe('saving never undoes changes made elsewhere (e.g. a second browser tab)', () => {
  it("one tab's saves keep a pet adopted in the other tab", () => {
    const st = memStorage({ [SAVE_KEY]: JSON.stringify(oldSave()) });
    const tabA = loadStore(st).store;
    const tabB = loadStore(st).store;
    const a = tabA.activePetId!;
    // tab B adopts Mochi
    let mochi: string | null = null;
    updateStore((s2) => { mochi = addPet(s2, newSave('Mochi', randomAppearance())); }, tabB, st);
    // tab A keeps playing Biscuit and saves (its in-memory copy has never heard of Mochi)
    const biscuit = tabA.pets[a]; biscuit.twinkles += 5;
    updateStore((s2) => { s2.pets[a] = biscuit; s2.activePetId = a; }, tabA, st);
    const now = readStore(st)!;
    expect(now.order.map((id) => now.pets[id].pet.name)).toEqual(['Biscuit', 'Mochi']);
    expect(now.pets[mochi!]).toBeTruthy();
    expect(now.pets[a].twinkles).toBe(biscuit.twinkles);
  });

  it('a pet removed elsewhere stays removed; the home is never overfilled', () => {
    const st = memStorage({ [SAVE_KEY]: JSON.stringify(oldSave()) });
    const tabA = loadStore(st).store;
    const a = tabA.activePetId!;
    let pip: string | null = null;
    updateStore((s2) => { addPet(s2, newSave('Mochi', randomAppearance())); pip = addPet(s2, newSave('Pip', randomAppearance())); }, tabA, st);
    const tabB = loadStore(st).store;
    updateStore((s2) => { removePet(s2, pip!); }, tabB, st);
    updateStore((s2) => { s2.pets[a].twinkles = 1; }, tabA, st); // tab A saves with its stale copy (still has Pip)
    expect(readStore(st)!.pets[pip!]).toBeUndefined();
    // both tabs now see one free slot; the first to adopt gets it, the second is refused
    let first: string | null = null, second: string | null = 'x';
    updateStore((s2) => { first = addPet(s2, newSave('Kit', randomAppearance())); }, tabA, st);
    updateStore((s2) => { second = addPet(s2, newSave('Bun', randomAppearance())); }, tabB, st);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(readStore(st)!.order.length).toBe(MAX_PETS);
  });

  it('a stored home is never trimmed, even past the limit (nothing is ever dropped)', () => {
    const pets: Record<string, SaveData> = {};
    for (const n of ['A', 'B', 'C', 'D']) pets[n] = newSave(n, randomAppearance());
    const st = memStorage({ [STORE_KEY]: JSON.stringify({ version: 2, activePetId: 'D', order: ['A', 'B', 'C', 'D'], pets, settings: {} }) });
    const { store } = loadStore(st);
    expect(store.order).toEqual(['A', 'B', 'C', 'D']);
    expect(canAddPet(store)).toBe(false);
  });
});

describe('removing a pet needs a deliberate hold', () => {
  it('taps never complete it; letting go resets; a 2 s hold completes exactly once', () => {
    const h = new HoldConfirm(2);
    for (let i = 0; i < 20; i++) { h.press(); expect(h.update(0.05)).toBe(false); h.release(); } // quick taps
    expect(h.done).toBe(false);
    h.press(); for (let i = 0; i < 30; i++) h.update(0.05); // 1.5 s…
    h.release(); // …then let go
    expect(h.progress).toBe(0);
    h.press();
    let completions = 0;
    for (let i = 0; i < 60; i++) if (h.update(0.05)) completions++;
    expect(completions).toBe(1);
    expect(h.done).toBe(true);
  });
  it('a stalled frame cannot skip the wait', () => {
    const h = new HoldConfirm(2);
    h.press();
    expect(h.update(5)).toBe(false);
    expect(h.progress).toBeLessThan(0.1);
  });
});
