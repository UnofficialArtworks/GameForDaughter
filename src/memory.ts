// Pet memory & emergent preferences. Pure functions over save data.
import type { MemoryData, Hidden } from './state';

export type FoodReaction = 'love' | 'like' | 'neutral' | 'dislike';

export function reactionFor(liking: number): FoodReaction {
  if (liking > 0.55) return 'love';
  if (liking > 0.2) return 'like';
  if (liking > -0.25) return 'neutral';
  return 'dislike';
}

/** What the pet *expects* from a food before tasting it (drives anticipation). */
export function expectedFood(mem: MemoryData, id: string): FoodReaction | 'unknown' {
  const f = mem.foods[id];
  if (!f || f.tastes === 0) return 'unknown';
  return reactionFor(f.liking);
}

export interface TasteResult { reaction: FoodReaction; first: boolean; newFavorite: boolean; newDislike: boolean; }

/**
 * Pet tastes a food. Learned liking converges toward the hidden affinity, and
 * repeated exposure gently nudges liked foods further up (so favourites *emerge*).
 */
export function tasteFood(mem: MemoryData, hidden: Hidden, id: string): TasteResult {
  const truth = hidden.food[id] ?? 0;
  const rec = mem.foods[id] ?? (mem.foods[id] = { tastes: 0, liking: 0 });
  const first = rec.tastes === 0;
  rec.tastes++;
  // first taste is a noisy guess; later tastes settle
  const rate = first ? 0.55 : 0.3;
  rec.liking += (truth - rec.liking) * rate;
  if (truth > 0.3) rec.liking = Math.min(1, rec.liking + 0.04 * Math.min(rec.tastes, 6));
  const reaction = reactionFor(rec.liking);
  let newFavorite = false, newDislike = false;
  if (rec.tastes >= 3 && reaction === 'love' && id !== 'kibble') {
    const cur = mem.favFood ? mem.foods[mem.favFood]?.liking ?? -9 : -9;
    if (mem.favFood !== id && rec.liking > cur) { mem.favFood = id; newFavorite = true; }
  }
  if (rec.tastes >= 2 && reaction === 'dislike' && mem.dislikedFood !== id) {
    mem.dislikedFood = id;
    newDislike = true;
  }
  return { reaction, first, newFavorite, newDislike };
}

/** Petting a spot. Returns 0..1.5 pleasure intensity. */
export function petSpot(mem: MemoryData, hidden: Hidden, spot: string, amount: number): { intensity: number; newFavorite: boolean } {
  const truth = hidden.spot[spot] ?? 0.3;
  const rec = mem.spots[spot] ?? (mem.spots[spot] = { pets: 0, liking: 0.3 });
  rec.pets += amount;
  rec.liking += (truth - rec.liking) * Math.min(1, 0.08 * amount);
  let newFavorite = false;
  if (rec.pets >= 12 && rec.liking > 0.6 && mem.favSpot !== spot) {
    const cur = mem.favSpot ? mem.spots[mem.favSpot]?.liking ?? 0 : 0;
    if (rec.liking > cur) { mem.favSpot = spot; newFavorite = true; }
  }
  return { intensity: 0.5 + truth, newFavorite };
}

export function playToy(mem: MemoryData, hidden: Hidden, toy: string): { newFavorite: boolean; liking: number } {
  const truth = hidden.toy[toy] ?? 0.4;
  const rec = mem.toys[toy] ?? (mem.toys[toy] = { plays: 0, liking: 0.4 });
  rec.plays++;
  rec.liking += (truth - rec.liking) * 0.2 + 0.01;
  rec.liking = Math.min(1, rec.liking);
  let newFavorite = false;
  if (rec.plays >= 5 && rec.liking > 0.65 && mem.favToy !== toy) {
    const cur = mem.favToy ? mem.toys[mem.favToy]?.liking ?? 0 : 0;
    if (rec.liking > cur + 0.02) { mem.favToy = toy; newFavorite = true; }
  }
  return { newFavorite, liking: rec.liking };
}

/** Practise a trick. gain is 0..1 from reward quality; returns true when newly learned. */
export function practiceTrick(mem: MemoryData, id: string, gain: number, learnSpeed: number): boolean {
  const rec = mem.tricks[id] ?? (mem.tricks[id] = { prof: 0, learned: false, performed: 0 });
  rec.performed++;
  if (rec.learned) return false;
  rec.prof = Math.min(100, rec.prof + gain * (18 + learnSpeed * 14));
  if (rec.prof >= 100) { rec.learned = true; return true; }
  return false;
}

export function trickSuccessChance(mem: MemoryData, id: string, excitement: number): number {
  const rec = mem.tricks[id];
  if (!rec) return 0.3;
  if (rec.learned) return 0.96;
  return Math.min(0.92, 0.5 + (rec.prof / 100) * 0.4 - excitement * 0.1);
}

export function addJournal(mem: MemoryData, icon: string, text: string, t = Date.now()) {
  mem.journal.push({ t, icon, text });
  if (mem.journal.length > 200) mem.journal.splice(0, mem.journal.length - 200);
}

export function addRecent(mem: MemoryData, what: string, t = Date.now()) {
  mem.recent.push({ t, what });
  if (mem.recent.length > 30) mem.recent.shift();
}

export function bump(mem: MemoryData, key: string, n = 1) {
  mem.counters[key] = (mem.counters[key] ?? 0) + n;
  return mem.counters[key];
}
