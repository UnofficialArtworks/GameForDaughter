// Recent context & habits: what just happened (session-only), what keeps happening
// (a few slow-moving saved tendencies), and a polite pacing rule for requests.
// Pure logic, no rendering, so it's easy to test.
import type { MemoryData } from '../state';

/** Things the pet remembers for a few minutes. */
export type Recent = 'fed' | 'favFood' | 'petted' | 'favSpot' | 'fetch' | 'fetchMiss' | 'toy' | 'trick' | 'bathed' | 'brushed'
  | 'woke' | 'garden' | 'fromGarden' | 'treasure' | 'greeted' | 'sniffed' | 'played' | 'request';

/** Short-term memory: timestamps (game seconds) of recent events, plus an optional detail. */
export class ShortTerm {
  private log: { k: Recent; t: number; d?: string }[] = [];
  now = 0;
  mark(k: Recent, d?: string) {
    this.log.push({ k, t: this.now, d });
    if (this.log.length > 60) this.log.shift();
  }
  /** Seconds since the last `k` (Infinity if it hasn't happened this session). */
  ago(k: Recent) {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].k === k) return this.now - this.log[i].t;
    return Infinity;
  }
  within(k: Recent, s: number) { return this.ago(k) <= s; }
  count(k: Recent, s: number) { let n = 0; for (const e of this.log) if (e.k === k && this.now - e.t <= s) n++; return n; }
  detail(k: Recent) { for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].k === k) return this.log[i].d; return undefined; }
}

// ---------- habits ----------
/**
 * A handful of long-term tendencies that grow when something keeps happening and fade very
 * slowly when it stops. 0 = no habit, 1 = a firm routine.
 * - fetch: plays fetch a lot → brings the ball on its own
 * - bedCuddle: cuddled when tired → seeks cuddles (and naps near you) when sleepy
 * - garden: taken outside often → sometimes waits by the garden door
 * - brush: brushed often → leans into the brush as soon as it appears
 * - tricks: practises tricks often → sits attentively for lessons, shows off unprompted
 * - bath: bathed regularly → stops hesitating at bath time
 */
export type HabitId = 'fetch' | 'bedCuddle' | 'garden' | 'brush' | 'tricks' | 'bath';
export const HABITS: HabitId[] = ['fetch', 'bedCuddle', 'garden', 'brush', 'tricks', 'bath'];
/** Journal lines written once, when a habit first becomes noticeable. */
export const HABIT_NOTES: Record<HabitId, string> = {
  fetch: '{n} has started bringing the ball over on their own.',
  bedCuddle: '{n} likes a cuddle before sleepy time now.',
  garden: '{n} has started waiting by the garden door.',
  brush: '{n} gets excited whenever the brush comes out!',
  tricks: '{n} loves lessons — they sit up straight when it\'s trick time.',
  bath: '{n} isn\'t nervous about baths anymore.',
};
export const HABIT_NOTICE = 0.45;

export function habit(mem: MemoryData, id: HabitId): number {
  return mem.habits?.[id] ?? 0;
}

/** Strengthen a habit with diminishing returns. Returns true the moment it becomes noticeable. */
export function growHabit(mem: MemoryData, id: HabitId, amt: number): boolean {
  const h = (mem.habits ??= {});
  const before = h[id] ?? 0;
  const after = Math.min(1, before + amt * (1 - before));
  h[id] = after;
  return before < HABIT_NOTICE && after >= HABIT_NOTICE;
}

/** Habits fade gently with each day that passes (never all at once). */
export function fadeHabits(mem: MemoryData, days: number) {
  const h = (mem.habits ??= {});
  const f = Math.pow(0.97, Math.min(60, Math.max(0, days)));
  for (const k of Object.keys(h)) h[k] = (h[k] ?? 0) * f;
}

// ---------- request pacing ----------
/**
 * Requests (thought bubbles asking for something) must never turn into nagging:
 * a minimum quiet gap between any two requests, a longer one after being ignored,
 * and requests simply expire. Ignoring one never has a downside.
 */
export class RequestPacer {
  last = -Infinity;
  ignored: Record<string, number> = {};
  /** `gap` seconds between requests; a kind that was ignored is left alone for `ignoreGap`. */
  can(kind: string, now: number, gap = 45, ignoreGap = 150) {
    if (now - this.last < gap) return false;
    const ig = this.ignored[kind];
    return ig === undefined || now - ig > ignoreGap;
  }
  asked(now: number) { this.last = now; }
  expired(kind: string, now: number) { this.ignored[kind] = now; }
  fulfilled(kind: string) { delete this.ignored[kind]; }
}
