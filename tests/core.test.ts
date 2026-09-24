import { describe, it, expect } from 'vitest';
import { newSave, randomAppearance, randomTraits, migrate, loadSave, writeSave, applyOffline, decayNeeds, OFFLINE_FLOOR, SAVE_KEY, makeHidden } from '../src/state';
import { tasteFood, petSpot, playToy, practiceTrick, reactionFor, expectedFood } from '../src/memory';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('save / load', () => {
  it('round-trips a save through storage', () => {
    const st = memStorage();
    const s = newSave('Mochi', randomAppearance());
    s.memory.foods.apple = { tastes: 3, liking: 0.7 };
    s.equipped.wear.head = 'bow';
    expect(writeSave(s, st)).toBe(true);
    const back = loadSave(st)!;
    expect(back.pet.name).toBe('Mochi');
    expect(back.memory.foods.apple.tastes).toBe(3);
    expect(back.equipped.wear.head).toBe('bow');
    expect(back.pet.hidden).toEqual(s.pet.hidden);
  });

  it('fills missing fields in older/partial saves', () => {
    const s: any = newSave('Pip', randomAppearance());
    delete s.settings;
    delete s.memory.counters;
    delete s.room;
    const m = migrate(JSON.parse(JSON.stringify(s)))!;
    expect(m.settings.music).toBeGreaterThanOrEqual(0);
    expect(m.memory.counters).toEqual({});
    expect(m.room.water).toBe(1);
    expect(m.pet.name).toBe('Pip');
  });

  it('rejects garbage and survives corrupt JSON', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ hello: 1 })).toBeNull();
    const st = memStorage();
    st.setItem(SAVE_KEY, '{not json');
    expect(loadSave(st)).toBeNull();
  });
});

describe('pet state', () => {
  it('needs decay gently and stay within 0..1', () => {
    const s = newSave('A', randomAppearance());
    const n = s.pet.needs;
    for (let i = 0; i < 60 * 60; i++) decayNeeds(n, s.pet.traits, 1, false); // one hour
    for (const v of Object.values(n)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(n.clean).toBeGreaterThan(0.5); // cleanliness never plummets
  });

  it('sleep restores energy', () => {
    const s = newSave('A', randomAppearance());
    s.pet.needs.energy = 0.2;
    for (let i = 0; i < 120; i++) decayNeeds(s.pet.needs, s.pet.traits, 1, true);
    expect(s.pet.needs.energy).toBeGreaterThan(0.6);
  });

  it('offline time never drops needs below the gentle floor', () => {
    const s = newSave('A', randomAppearance());
    applyOffline(s, 30 * 86400); // a month away
    const n = s.pet.needs;
    for (const k of ['hunger', 'clean', 'fun', 'affection'] as const) expect(n[k]).toBeGreaterThanOrEqual(OFFLINE_FLOOR);
    expect(n.energy).toBe(1);
  });

  it('personalities always have standout traits', () => {
    for (let i = 0; i < 50; i++) {
      const t = randomTraits();
      const extremes = Object.values(t).filter((v) => v < 0.25 || v > 0.75).length;
      expect(extremes).toBeGreaterThanOrEqual(1);
    }
  });

  it('hidden preferences always include one favourite food and are seed-stable', () => {
    const tr = randomTraits();
    const a = makeHidden(42, tr), b = makeHidden(42, tr);
    expect(a).toEqual(b);
    const loves = Object.entries(a.food).filter(([k, v]) => k !== 'kibble' && v > 0.9);
    expect(loves.length).toBeGreaterThanOrEqual(1);
  });
});

describe('memory & preferences', () => {
  it('a loved food emerges as the favourite after repeated tasting', () => {
    const s = newSave('A', randomAppearance());
    const fav = Object.entries(s.pet.hidden.food).find(([k, v]) => k !== 'kibble' && v > 0.9)![0];
    expect(expectedFood(s.memory, fav)).toBe('unknown');
    const r1 = tasteFood(s.memory, s.pet.hidden, fav);
    expect(r1.first).toBe(true);
    expect(r1.newFavorite).toBe(false); // not on the first bite
    tasteFood(s.memory, s.pet.hidden, fav);
    const r3 = tasteFood(s.memory, s.pet.hidden, fav);
    expect(r3.reaction).toBe('love');
    expect(r3.newFavorite).toBe(true);
    expect(s.memory.favFood).toBe(fav);
    expect(expectedFood(s.memory, fav)).toBe('love');
  });

  it('disliked foods are discovered but reactions stay gentle categories', () => {
    const s = newSave('A', randomAppearance());
    const dis = Object.entries(s.pet.hidden.food).sort((a, b) => a[1] - b[1])[0][0];
    tasteFood(s.memory, s.pet.hidden, dis);
    const r = tasteFood(s.memory, s.pet.hidden, dis);
    expect(['dislike', 'neutral']).toContain(r.reaction);
    expect(['love', 'like', 'neutral', 'dislike']).toContain(reactionFor(-5));
  });

  it('favourite petting spot is learned through petting', () => {
    const s = newSave('A', randomAppearance());
    const spot = Object.entries(s.pet.hidden.spot).find(([, v]) => v > 0.9)![0];
    let found = false;
    for (let i = 0; i < 20; i++) if (petSpot(s.memory, s.pet.hidden, spot, 1).newFavorite) found = true;
    expect(found).toBe(true);
    expect(s.memory.favSpot).toBe(spot);
  });

  it('favourite toy emerges from play', () => {
    const s = newSave('A', randomAppearance());
    const toy = Object.entries(s.pet.hidden.toy).find(([, v]) => v > 0.9)![0];
    for (let i = 0; i < 12; i++) playToy(s.memory, s.pet.hidden, toy);
    expect(s.memory.favToy).toBe(toy);
  });

  it('tricks are learned with practice', () => {
    const s = newSave('A', randomAppearance());
    let learned = false, n = 0;
    while (!learned && n < 20) { learned = practiceTrick(s.memory, 'sit', 1, 0.5); n++; }
    expect(learned).toBe(true);
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThan(8);
  });
});
