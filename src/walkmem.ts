// Walkies memory & route planning. Pure logic over save data (no rendering), so it's testable.
import type { Traits } from './state';

export type WalkKind = 'flowers' | 'puddle' | 'leaves' | 'butterfly' | 'bush' | 'bench' | 'sound' | 'dig' | 'stick' | 'picnic';
export const WALK_KINDS: WalkKind[] = ['flowers', 'puddle', 'leaves', 'butterfly', 'bush', 'bench', 'sound', 'dig', 'stick', 'picnic'];
/** How the Memory Book names a favourite spot: "{name} seems to LOVE {…}". */
export const SPOT_TEXT: Record<WalkKind, string> = {
  flowers: 'the flowers', puddle: 'puddles', leaves: 'leaf piles', butterfly: 'butterflies', bush: 'sniffing bushes',
  bench: 'the bench', sound: 'mystery sounds', dig: 'digging spots', stick: 'sticks', picnic: 'picnic smells',
};

export type PathTheme = 'flowers' | 'pond' | 'woods' | 'meadow';
export const PATHS: Record<PathTheme, { name: string; icon: string; blurb: string; kinds: WalkKind[] }> = {
  flowers: { name: 'Flower Path', icon: 'path_flowers', blurb: 'blossoms & butterflies', kinds: ['flowers', 'butterfly', 'bench'] },
  pond: { name: 'Pond Path', icon: 'path_pond', blurb: 'splashy & muddy', kinds: ['puddle', 'sound', 'dig'] },
  woods: { name: 'Shady Woods', icon: 'path_woods', blurb: 'leaves, sticks & rustles', kinds: ['leaves', 'bush', 'stick', 'sound'] },
  meadow: { name: 'Sunny Meadow', icon: 'path_meadow', blurb: 'open grass & picnics', kinds: ['picnic', 'dig', 'bench', 'butterfly'] },
};

/** Saved walk memory. Missing in older saves → filled with these defaults by migrate(). */
export interface WalkMem {
  walks: number;
  /** Accumulated enjoyment per kind of spot, and how many times it was visited. */
  joy: Record<string, number>;
  visits: Record<string, number>;
  /** Favourite kind of spot, once it has emerged ('' = not yet). */
  fav: string;
  /** Sticks carried home or along. Enough of them and it's an obsession. */
  sticks: number;
}
export const emptyWalkMem = (): WalkMem => ({ walks: 0, joy: {}, visits: {}, fav: '', sticks: 0 });

/**
 * Record how much the pet enjoyed a stop (0..~1.5). A favourite only emerges after several
 * visits and a clear lead in enjoyment — never on the first walk. Returns true when a new favourite appears.
 */
export function recordStop(w: WalkMem, kind: WalkKind, joy: number): boolean {
  w.visits[kind] = (w.visits[kind] ?? 0) + 1;
  w.joy[kind] = (w.joy[kind] ?? 0) + Math.max(0, joy);
  if (w.walks < 2) return false;
  let best: string | null = null, bv = 0, second = 0;
  for (const k of Object.keys(w.joy)) {
    const v = w.joy[k], n = w.visits[k] ?? 0;
    if (n < 3 || v / n < 0.75) continue;
    if (v > bv) { second = bv; bv = v; best = k; } else if (v > second) second = v;
  }
  if (!best || best === w.fav || bv < 3.2 || bv - second < 0.8) return false;
  if (w.fav && bv < (w.joy[w.fav] ?? 0) + 1) return false; // an existing favourite isn't replaced lightly
  w.fav = best;
  return true;
}

/** How likely each kind of stop is, from personality, habits and the favourite spot. */
export function kindWeight(kind: WalkKind, tr: Traits, w: WalkMem, night: boolean): number {
  let v = 1;
  switch (kind) {
    case 'flowers': v = 0.8 + tr.curious * 0.4 + (1 - tr.energy) * 0.3; break;
    case 'puddle': v = 0.7 + tr.playful * 0.5; break;
    case 'leaves': v = 0.6 + tr.energy * 0.8; break;
    case 'butterfly': v = 0.6 + tr.playful * 0.6; break;
    case 'bush': v = 0.6 + tr.curious * 0.8; break;
    case 'bench': v = 0.5 + (1 - tr.energy) * 0.6 + tr.cuddly * 0.3; break;
    case 'sound': v = 0.5 + tr.curious * 0.3; break;
    case 'dig': v = 0.7; break;
    case 'stick': v = 0.6 + tr.playful * 0.4 + Math.min(1, w.sticks * 0.1); break;
    case 'picnic': v = (night ? 0.1 : 0.3) + tr.appetite * 0.9; break;
  }
  if (w.fav === kind) v *= 2.5;
  return v;
}

function pickWeighted<T>(items: { item: T; w: number }[], rng: () => number): T | null {
  const tot = items.reduce((a, b) => a + Math.max(0, b.w), 0);
  if (tot <= 0) return null;
  let r = rng() * tot;
  for (const i of items) { r -= Math.max(0, i.w); if (r <= 0) return i.item; }
  return items[items.length - 1].item;
}

/** Pick `n` different kinds (not in `used`), optionally limited to a path theme. */
export function pickKinds(n: number, tr: Traits, w: WalkMem, night: boolean, used: WalkKind[], rng: () => number, from: WalkKind[] = WALK_KINDS): WalkKind[] {
  const out: WalkKind[] = [];
  for (let i = 0; i < n; i++) {
    const k = pickWeighted(from.filter((x) => !used.includes(x) && !out.includes(x)).map((x) => ({ item: x, w: kindWeight(x, tr, w, night) })), rng);
    if (!k) break;
    out.push(k);
  }
  return out;
}

/** Two different path themes to choose between (each still has something new to offer). */
export function pickChoice(tr: Traits, w: WalkMem, night: boolean, used: WalkKind[], rng: () => number): [PathTheme, PathTheme] {
  const themes = (Object.keys(PATHS) as PathTheme[]).filter((t) => PATHS[t].kinds.some((k) => !used.includes(k)));
  const score = (t: PathTheme) => {
    const ks = PATHS[t].kinds.filter((k) => !used.includes(k));
    return ks.reduce((a, k) => a + kindWeight(k, tr, w, night), 0) / Math.max(1, ks.length);
  };
  const a = pickWeighted(themes.map((t) => ({ item: t, w: score(t) })), rng) ?? 'flowers';
  const b = pickWeighted(themes.filter((t) => t !== a).map((t) => ({ item: t, w: score(t) })), rng) ?? (a === 'woods' ? 'meadow' : 'woods');
  return [a, b];
}

/** Which way the pet itself would pick (it leans toward its favourite spot, else its personality). */
export function petPrefers(choice: [PathTheme, PathTheme], tr: Traits, w: WalkMem, night: boolean): 0 | 1 {
  const s = (t: PathTheme) => PATHS[t].kinds.reduce((a, k) => a + kindWeight(k, tr, w, night), 0) / PATHS[t].kinds.length;
  return s(choice[1]) > s(choice[0]) ? 1 : 0;
}
