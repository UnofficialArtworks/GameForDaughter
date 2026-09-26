// PetBrain: needs → mood → utility-weighted behaviour choice. Behaviours are generator
// scripts, so they read like little animation storyboards.
//
// Behaviour weights read the pet's whole situation — needs, personality, friendship,
// favourites, what just happened (short-term memory) and slowly-formed habits — so what the
// pet chooses to do usually has a reason the player can spot. Most behaviours are short chains
// that start with a look (eyes → head → body) before the pet moves, and every request is
// paced, expires on its own and never has a downside when ignored.
import type { Game } from '../game';
import type { Pet, Gen, Expr } from './Pet';
import { decayNeeds } from '../state';
import { chance, clamp, clamp01, dist, pick, rand, randi, weighted } from '../util';
import { COLLECTIBLES, TOYS, TRICKS } from '../data';
import type { Zone } from '../world/world';
import { addJournal } from '../memory';
import { ShortTerm, RequestPacer, HabitId, habit, growHabit, HABIT_NOTES } from './context';

export type Mood = 'content' | 'playful' | 'sleepy' | 'hungry' | 'curious' | 'affectionate' | 'excited' | 'bored' | 'grumpy' | 'mischievous';
const MOOD_EXPR: Record<Mood, Expr> = {
  content: 'neutral', playful: 'happy', sleepy: 'sleepy', hungry: 'hungry', curious: 'curious',
  affectionate: 'happy', excited: 'excited', bored: 'bored', grumpy: 'pout', mischievous: 'mischief',
};
const TOY_IDS = TOYS.map((t) => t.id as string);
/** Two wishes are the same if they'd be satisfied by the same thing (any toy counts as play). */
const sameWish = (want: string, got: string) =>
  want === got || (want === 'heart' && got === 'belly') || (TOY_IDS.includes(want) && TOY_IDS.includes(got));
/** Autonomous behaviours that a sudden event (a bird, a new object) may interrupt. */
const INTERRUPTIBLE = new Set(['', 'wander', 'sniff', 'groom', 'stretch', 'watch', 'lounge', 'investigate', 'sing', 'lookBehind']);

// ---------- tiny generator helpers ----------
export function* wait(pet: Pet, s: number): Gen { let t = 0; while (t < s) { t += pet.dt; yield; } }
export function* walk(pet: Pet, x: number, y: number, speed = 110, timeout = 12): Gen {
  if (pet.body === 'lie' || pet.body === 'belly' || pet.body === 'sit' || pet.body === 'bow') pet.body = 'stand'; // get up before setting off
  pet.moveTo(x, y, speed);
  let t = 0;
  while (pet.moving && t < timeout) { t += pet.dt; yield; }
  pet.moving = false;
}
export function* until(pet: Pet, cond: () => boolean, timeout = 10): Gen { let t = 0; while (!cond() && t < timeout) { t += pet.dt; yield; } }
/**
 * Look first, then go: the eyes land on the target, the ears perk, the body turns, and only
 * then does the pet set off. That little delay is what makes a walk read as a decision.
 * Relaxed pets take a touch longer to get going than energetic ones.
 */
export function* approach(pet: Pet, x: number, y: number, speed = 110, look?: { x: number; y: number }): Gen {
  const tr = pet.g.save.pet.traits;
  const lk = look ?? { x, y: y - 60 };
  pet.moving = false;
  pet.lookAt = lk;
  const perk = pet.o.earPerk;
  pet.o.earPerk = 0.75;
  yield* wait(pet, 0.22 + (1 - tr.energy) * 0.3 + rand(0, 0.15));
  pet.faceToward(lk.x);
  yield* wait(pet, 0.14);
  pet.o.earPerk = perk;
  yield* walk(pet, x, y, speed);
  pet.lookAt = null;
}
function* lookAround(pet: Pet, s: number): Gen {
  let t = 0, nt = 0;
  while (t < s) {
    t += pet.dt;
    if (t > nt) { nt = t + rand(0.5, 1.3); pet.lookAt = { x: pet.x + rand(-300, 300), y: pet.y - rand(0, 250) }; }
    yield;
  }
  pet.lookAt = null;
}

/**
 * Ask for something: body language plus (only when it's polite to ask right now) a thought
 * bubble. Wait a little while for the player, then let it go with a small content sigh.
 * Returns true if the wish was granted. Ignoring a request never costs anything.
 */
function* askFor(b: Brain, kind: string, s: number, fidget?: (t: number) => void): Generator<void, boolean, void> {
  const pet = b.pet, t0 = b.g.time;
  const bubble = b.makeRequest(kind);
  let t = 0;
  while (t < s) {
    t += pet.dt;
    if (b.granted(kind, t0)) return true;
    fidget?.(t);
    yield;
  }
  if (bubble) b.expire(kind);
  pet.o = {}; pet.expr = 'neutral'; pet.o.eyeOpen = 0.3; pet.o.headTilt = 0.12; // a little "oh well"
  yield* wait(pet, 0.55);
  pet.o = {}; pet.expr = 'happy';
  yield* wait(pet, 0.4);
  pet.expr = null;
  return false;
}

interface Behavior {
  id: string;
  zone?: Zone;
  cd: number;
  w: (b: Brain) => number;
  run: (b: Brain) => Gen;
}

export class Brain {
  mood: Mood = 'content';
  excitement = 0;
  grump = 0;
  buzz = 0; // curiosity buzz from new things
  mischief = 0;
  sinceInteract = 0;
  idle = 1;
  cooldowns: Record<string, number> = {};
  recent: string[] = [];
  request: { kind: string; t: number } | null = null;
  zoneTime = 0;
  lastZone: Zone = 'room';
  behaviors: Behavior[];
  purr = 0;
  /** What happened in the last few minutes. */
  st = new ShortTerm();
  pacer = new RequestPacer();
  private lastGrant: { kind: string; t: number } | null = null;
  /** Seconds of extra post-bath poof left. */
  poof = 0;
  /** Post-bath messy fur, 1 = wild. Brushing smooths it (see CloseUp); left alone it settles in ~5 min. */
  ruffle = 0;
  /** Seconds of "just groomed" shine left. */
  shine = 0;
  /** Something new was placed in the world: the pet will want to check it out. */
  novel: { x: number; y: number; look?: number } | null = null;
  /** A friendly gesture the pet is offering (e.g. a raised paw for a high five). */
  offer: { kind: 'highfive'; taken: boolean } | null = null;
  private sawBird = false;

  constructor(public g: Game) {
    this.behaviors = makeBehaviors(this);
  }
  get pet(): Pet { return this.g.pet; }
  get n() { return this.g.save.pet.needs; }
  get tr() { return this.g.save.pet.traits; }
  get fl() { return this.g.friendLevel; }
  /** Just woke up: slow blinks, slower steps, a sleepy face for a little while. */
  get drowsy() { return this.st.within('woke', 30); }
  habit(id: HabitId) { return habit(this.g.save.memory, id); }
  /** Reinforce a habit; the first time it becomes noticeable the journal (and a toast) say so. */
  grow(id: HabitId, amt: number) {
    if (!growHabit(this.g.save.memory, id, amt)) return;
    const text = HABIT_NOTES[id].replace('{n}', this.g.save.pet.name);
    addJournal(this.g.save.memory, 'heart', text);
    this.g.toast('habit', text, 'heart');
  }
  /** Walking pace: tired pets amble, freshly woken pets dawdle, excited pets hurry. */
  pace() {
    let p = 0.72 + 0.28 * clamp01(this.n.energy * 2.2);
    if (this.drowsy) p *= 0.8;
    return p * (1 + this.excitement * 0.15);
  }
  learnedTricks() { return TRICKS.filter((t) => this.g.save.memory.tricks[t.id]?.learned).map((t) => t.id as string); }
  /** Owned toys the pet can pick up and carry. */
  carryToys(): string[] { return this.g.save.inventory.toys.filter((t) => t === 'ball' || t === 'squeaky'); }
  /** The toy the pet would reach for: its favourite if it can carry it, else the one it's played with most. */
  preferredToy() {
    const owned = this.carryToys();
    const fav = this.g.save.memory.favToy;
    if (fav && owned.includes(fav)) return fav;
    const m = this.g.save.memory.toys;
    return owned.sort((a, b) => (m[b]?.liking ?? 0) - (m[a]?.liking ?? 0))[0] ?? 'ball';
  }

  noteInteraction(excite = 0.1) {
    this.sinceInteract = 0;
    this.excitement = clamp01(this.excitement + excite);
  }

  moodExpr(): Expr {
    if (this.pet.asleep) return 'asleep';
    if (this.st.within('woke', 14)) return 'sleepy';
    return MOOD_EXPR[this.mood];
  }

  update(dt: number) {
    const g = this.g, pet = this.pet;
    this.st.now = g.time;
    decayNeeds(this.n, this.tr, dt, pet.asleep);
    this.excitement = Math.max(0, this.excitement - dt * 0.06);
    this.grump = Math.max(0, this.grump - dt * 0.08);
    this.buzz = Math.max(0, this.buzz - dt * 0.02);
    this.poof = Math.max(0, this.poof - dt);
    if (!this.g.closeup.groom) this.ruffle = Math.max(0, this.ruffle - dt / 300);
    this.shine = Math.max(0, this.shine - dt);
    this.sinceInteract += dt;
    this.mischief += dt * (0.002 + this.tr.playful * 0.004);
    if (this.mischief > 1) this.mischief = 0;
    if (g.zone !== this.lastZone) { this.lastZone = g.zone; this.zoneTime = 0; }
    this.zoneTime += dt;
    if (this.request && g.time - this.request.t > 30) this.expire(this.request.kind);
    this.mood = this.computeMood();
    // purr continues while content & being close
    g.audio.purr(this.purr);
    this.purr = Math.max(0, this.purr - dt * 1.5);
    this.watchEvents();

    if (pet.action || g.mode !== 'free') return;
    this.idle -= dt;
    if (this.idle > 0) return;
    this.choose();
  }

  /** Things that happen around the pet can catch its attention mid-activity. */
  private watchEvents() {
    const g = this.g, pet = this.pet;
    const bird = !!g.world.bird;
    const fresh = bird && !this.sawBird;
    this.sawBird = bird;
    if (!fresh || g.mode !== 'free' || g.zone !== 'room' || pet.asleep || pet.busy(1) || !INTERRUPTIBLE.has(pet.actionName)) return;
    if (!chance(0.1 + this.tr.curious * 0.4) || (this.cooldowns.window ?? 0) > g.time) return;
    const win = this.behaviors.find((x) => x.id === 'window')!;
    this.cooldowns.window = g.time + win.cd;
    pet.run(win.run(this), 'window');
  }

  computeMood(): Mood {
    const n = this.n, tr = this.tr;
    const night = this.g.world.isNight();
    const s: Record<Mood, number> = {
      content: 0.5 + (this.st.within('petted', 60) ? 0.2 : 0),
      sleepy: (1 - n.energy) * 1.5 + (night ? 0.2 : 0) - this.excitement * 0.5,
      hungry: (1 - n.hunger) * 1.35 - 0.2 - (this.st.within('fed', 90) ? 0.4 : 0),
      playful: (1 - n.fun) * 0.7 + tr.playful * 0.3 + n.energy * 0.15 - (this.st.count('fetch', 120) >= 3 ? 0.3 : 0),
      affectionate: (1 - n.affection) * 0.8 + tr.cuddly * 0.3 - (this.st.within('petted', 90) ? 0.35 : 0),
      curious: tr.curious * 0.4 + this.buzz,
      excited: this.excitement * 1.4,
      bored: this.sinceInteract > 120 && n.fun < 0.5 ? 0.7 : 0,
      grumpy: this.grump,
      mischievous: this.mischief > 0.85 ? 0.9 : 0,
    };
    s[this.mood] += 0.1; // hysteresis
    let best: Mood = 'content', bv = -1;
    for (const k in s) { const v = s[k as Mood]; if (v > bv) { bv = v; best = k as Mood; } }
    return best;
  }

  choose() {
    const g = this.g, pet = this.pet;
    // stay with the player: follow them to the zone they're looking at
    if (g.world.zoneOf(pet.x) !== g.zone) {
      pet.run(goToZone(this, g.zone), 'goZone');
      return;
    }
    const opts = this.behaviors
      .filter((b) => (!b.zone || b.zone === g.zone) && (this.cooldowns[b.id] ?? 0) <= g.time)
      .map((b) => {
        let w = Math.max(0, b.w(this));
        if (this.recent.includes(b.id)) w *= 0.25;
        return { item: b, w };
      });
    const b = weighted(opts);
    if (!b) { this.idle = 1; return; }
    this.cooldowns[b.id] = g.time + b.cd * rand(0.8, 1.3);
    this.recent.push(b.id);
    if (this.recent.length > 4) this.recent.shift();
    pet.run(b.run(this), b.id);
    // relaxed pets linger between activities; energetic ones bounce straight to the next thing
    this.idle = rand(0.4, 2.2) * (1.3 - this.tr.energy * 0.6);
  }

  /**
   * Put up a thought bubble asking for something — unless it asked for something very recently,
   * or asked for this and was ignored a little while ago. Returns whether it actually asked.
   */
  makeRequest(kind: string, force = false) {
    const g = this.g;
    const gap = 55 - this.tr.cuddly * 15 - this.fl * 3; // cuddly pets & close friends may ask a bit more often
    if (!force && !this.pacer.can(kind, g.time, gap)) return false;
    this.request = { kind, t: g.time };
    this.pacer.asked(g.time);
    this.st.mark('request', kind);
    this.pet.think(kind === 'belly' ? 'cuddle' : kind, 5);
    return true;
  }
  expire(kind: string) {
    if (this.request && this.request.kind === kind) this.request = null;
    this.pacer.expired(kind, this.g.time);
  }
  /** Was a wish like this ignored in the last `s` seconds? (Then the pet leaves that topic alone for a while.) */
  snubbed(kind: string, s = 150) {
    const now = this.g.time;
    return Object.entries(this.pacer.ignored).some(([k, t]) => now - t < s && sameWish(kind, k));
  }
  granted(kind: string, since: number) { return !!this.lastGrant && this.lastGrant.t >= since && sameWish(kind, this.lastGrant.kind); }

  /** Called by the game when the player satisfies something; returns true if it fulfilled a request. */
  fulfil(kind: string) {
    this.lastGrant = { kind, t: this.g.time };
    if (this.request && sameWish(this.request.kind, kind)) {
      this.pacer.fulfilled(this.request.kind);
      this.request = null;
      this.pet.thought = null;
      this.g.addFriend('request', 6);
      this.g.fx.hearts(this.pet.x, this.pet.y - 150, 3);
      return true;
    }
    return false;
  }

  // ---------- anticipation: reacting to what's *about* to happen ----------
  /** The player opened a tray in the free view (food / toys / care). */
  anticipate(kind: string) {
    const g = this.g, pet = this.pet;
    if (g.mode !== 'free' || pet.busy(1) || pet.carried) return;
    if (pet.asleep) { if (kind === 'feed' && this.tr.appetite > 0.7) pet.run(sniffAwake(this), 'anticipate', 1); return; }
    pet.run(anticipateTray(this, kind), 'anticipate', 1);
  }

  /** Something new appeared in the room (a new bed, rug…). */
  noticeNew(x: number, y: number, look?: number) {
    this.novel = { x, y, look };
    this.buzz = Math.min(1.5, this.buzz + 0.6);
    this.cooldowns.investigate = 0;
  }

  /** The pet raises a paw for a high five and waits a moment for you (tap it!). */
  *offerHighFive(): Generator<void, boolean, void> {
    const g = this.g, pet = this.pet;
    if (!this.learnedTricks().includes('highfive')) return false;
    this.offer = { kind: 'highfive', taken: false };
    pet.o = {}; pet.body = 'sit'; pet.lookCam = 1; pet.o.front = 0.55; pet.expr = 'excited'; pet.o.tailWag = 1;
    yield* wait(pet, 0.3);
    pet.o.paw = 1;
    g.hint('offerHighFive', 'Your pet is holding up a paw — tap them for a high five!');
    let t = 0;
    while (t < 3.5 && !this.offer.taken) { if (!g.ui.modalOpen()) t += pet.dt; yield; }
    const took = this.offer.taken;
    this.offer = null;
    if (took) {
      g.onHighFive(); pet.expr = 'joy'; g.audio.voice('giggle');
      g.addFriend('highfive', 2);
      yield* wait(pet, 0.7);
    } else {
      pet.o.paw = 0.3; pet.expr = 'happy'; // paw goes down, no big deal
      yield* wait(pet, 0.4);
    }
    pet.o.paw = 0; pet.o.front = 0;
    yield* wait(pet, 0.3);
    return took;
  }
  /** Tap on the pet while it's offering something. Returns true if that consumed the tap. */
  takeOffer() {
    if (!this.offer || this.offer.taken) return false;
    this.offer.taken = true;
    return true;
  }

  // ---------- greeting ----------
  /**
   * Welcome back. First the pet *recognises* you (eyes, ears, a double-take after a long time),
   * then greets you in its own way: energetic pets race over, cuddly ones ask for cuddles,
   * independent ones play it cool then sneak closer, sleepy ones wake up slowly and perk up,
   * playful friends bring their favourite toy. Long absences get a warmer (and sillier) welcome.
   */
  *greet(away: number, gift: boolean): Gen {
    const g = this.g, pet = this.pet, tr = this.tr, fl = this.fl;
    const long = away > 86400 * 0.75;
    const brief = away < 1800;
    this.st.mark('greeted');
    const napping = (g.world.isNight() && this.n.energy < 0.5) || (!brief && tr.energy < 0.35 && chance(0.6));
    if (napping) {
      pet.x = 150; pet.y = 560; pet.body = 'lie'; pet.asleep = true;
      yield* wait(pet, 1.4);
      pet.o.earPerk = 0.6; yield* wait(pet, 0.25); pet.o.earPerk = undefined; // an ear twitches at your voice
      yield* wait(pet, 0.5);
      pet.asleep = false; pet.o = {};
      pet.expr = 'sleepy'; pet.o.eyeOpen = 0.25; pet.lookCam = 0.7; // one sleepy look…
      yield* wait(pet, 0.9);
      pet.o = {}; pet.expr = 'surprised'; pet.emote('!'); g.audio.voice('surprise'); // …it's YOU!
      yield* wait(pet, 0.5);
      yield* wakeUp(pet);
    } else {
      pet.x = 820; pet.y = 575; pet.body = brief ? 'sit' : 'stand'; pet.face(1);
      pet.o.headDown = 0.6; pet.o.sniff = 1; // busy with something…
      yield* wait(pet, 0.7);
      pet.o = {}; pet.o.earPerk = 1; pet.lookAt = { x: pet.x - 200, y: pet.y - 80 }; // an ear turns…
      yield* wait(pet, 0.35);
      pet.lookAt = null; pet.lookCam = 1; // …eyes find you
      if (long) {
        // a double-take
        yield* wait(pet, 0.35);
        pet.lookCam = 0; pet.face(1); yield* wait(pet, 0.45);
        pet.lookCam = 1; pet.expr = 'surprised'; pet.emote('!'); pet.squash(0.4); g.audio.voice('surprise');
        yield* wait(pet, 0.5);
      } else yield* wait(pet, 0.3);
      pet.o = {};
    }
    const [fx, fy] = g.frontPoint();
    if (brief) {
      // back after a short while: a happy "oh, hi!" rather than a big fuss
      pet.expr = 'happy'; pet.o.tailWag = 1; g.audio.voice('happy');
      yield* walk(pet, fx + rand(-60, 60), fy, 170);
      pet.lookCam = 1; pet.body = 'sit';
      yield* wait(pet, 1.2);
      return;
    }
    const toy = this.preferredToy();
    const style = tr.cuddly < 0.35 ? 'cool'
      : fl >= 2 && tr.playful > 0.6 && this.carryToys().length && chance(0.6) ? 'toy'
      : tr.cuddly > 0.65 ? 'cuddle'
      : tr.energy > 0.62 ? 'zoom' : 'bounce';
    pet.expr = 'excited'; pet.o.tailWag = 1.4;
    if (style === 'cool') {
      // "oh, it's you." …casual grooming… then sneaking closer, step by step
      pet.lookCam = 0.4; pet.expr = 'neutral'; pet.body = 'sit';
      yield* wait(pet, 0.6);
      pet.lookCam = 0;
      for (let i = 0; i < 2; i++) { pet.o.paw = 0.7; pet.o.tongue = 0.7; pet.o.headDown = 0.3; yield* wait(pet, 0.35); pet.o = {}; yield* wait(pet, 0.2); }
      pet.lookCam = 0.8; yield* wait(pet, 0.4); pet.lookCam = 0; // a sneaky peek
      for (let i = 1; i <= 3; i++) {
        pet.body = 'stand'; pet.expr = 'mischief';
        yield* walk(pet, pet.x + (fx - pet.x) * (i / 3), pet.y + (fy - pet.y) * (i / 3), 90);
        pet.body = 'sit'; pet.lookCam = i === 3 ? 1 : 0.6; pet.o.tailWag = 0.3 + i * 0.3;
        yield* wait(pet, 0.5);
        pet.lookCam = 0;
      }
      pet.lookCam = 1; pet.expr = 'love'; pet.o.tailWag = 1.3; pet.emote('heart'); g.audio.voice('coo');
      yield* wait(pet, 1.2);
    } else if (style === 'toy') {
      // runs off to fetch the favourite toy to show you
      pet.emote('!'); g.audio.voice('excited');
      const [bx, by] = g.world.poi('basket');
      yield* walk(pet, bx, by, 300);
      pet.o.headDown = 1; yield* wait(pet, 0.45); pet.o.headDown = 0;
      pet.held = toy; if (toy === 'squeaky') g.audio.squeak();
      pet.lookCam = 1; yield* wait(pet, 0.3); pet.lookCam = 0;
      yield* walk(pet, fx, fy, 300);
      pet.lookCam = 1; pet.held = null;
      g.toys.dropFromPet(toy, pet.x + pet.facing * 45, pet.y + 8, true);
      pet.body = 'bow'; pet.expr = 'excited'; pet.o.tailWag = 1.5; g.audio.voice('excited');
      yield* wait(pet, 1.4);
      pet.body = 'sit';
    } else {
      pet.emote('!'); g.audio.voice('excited');
      yield* walk(pet, fx, fy, style === 'zoom' ? 360 : 300);
      pet.lookCam = 1;
      if (style === 'zoom') {
        // too excited to stop: a quick lap around you first
        const b = g.world.zoneBounds(g.zone);
        for (let i = 0; i < 2; i++) { yield* walk(pet, clamp(fx + (i ? -220 : 220), b.x0, b.x1), fy - 50, 380, 2); pet.jump(220); }
        yield* walk(pet, fx, fy, 320);
        pet.lookCam = 1;
      }
      const hops = 2 + (long ? 1 : 0) + (fl >= 3 ? 1 : 0);
      for (let i = 0; i < hops; i++) { pet.jump(260 + i * 20); g.fx.hearts(pet.x, pet.y - 170); yield* wait(pet, 0.42); }
      if (style === 'cuddle') {
        pet.body = 'belly'; pet.expr = 'joy'; g.audio.voice('giggle');
        yield* wait(pet, 1.2);
        pet.body = 'sit'; pet.expr = 'love'; pet.lookCam = 1;
        if (fl >= 1) this.makeRequest('heart', true);
        yield* wait(pet, 0.8);
      }
    }
    if (fl >= 2 && style !== 'cool') yield* TRICK_ANIMS.spin(pet);
    if (fl >= 4 && style !== 'cool') { yield* TRICK_ANIMS.rollover(pet); pet.expr = 'starry'; }
    pet.body = 'sit'; pet.expr = 'love'; pet.lookCam = 1;
    g.fx.hearts(pet.x, pet.y - 170, long ? 6 : 3);
    yield* wait(pet, 1.2);
    if (gift) {
      const c = pick(COLLECTIBLES.filter((c) => c.weight >= 5));
      pet.held = 'c:' + c.id; pet.expr = 'happy';
      g.toast('gift', `${g.save.pet.name} saved a gift for you!`, 'c:' + c.id);
      yield* wait(pet, 1.2);
      pet.held = null;
      g.collect(c.id, pet.x + pet.facing * 40, pet.y - 20);
      yield* wait(pet, 1);
    }
  }
}

// ---------- reusable actions ----------
function* goToZone(b: Brain, z: Zone): Gen {
  const pet = b.pet, g = b.g;
  pet.expr = 'happy';
  const [dx, dy] = g.world.poi('door');
  if (z === 'garden') {
    yield* walk(pet, dx, dy, 220);
    yield* walk(pet, 1120, 590, 220);
  } else {
    yield* walk(pet, 1040, dy, 220);
    yield* walk(pet, 900, 580, 220);
  }
  pet.expr = null;
}

/** The player opened a tray: the pet guesses what's coming and shows it with its body. */
function* anticipateTray(b: Brain, kind: string): Gen {
  const g = b.g, pet = b.pet, tr = b.tr, n = b.n;
  const [fx, fy] = g.frontPoint();
  pet.moving = false;
  pet.o.earPerk = 1;
  pet.lookCam = 1; // "what's that you've got?"
  yield* wait(pet, 0.25);
  if (kind === 'feed') {
    const keen = tr.appetite > 0.65 || n.hunger < 0.45;
    if (n.hunger < 0.45 && g.zone === 'room') {
      // a glance at the bowl, then back at you: hint hint
      pet.lookCam = 0; pet.lookAt = { x: g.world.poi('bowlFood')[0], y: 480 };
      yield* wait(pet, 0.55);
      pet.lookAt = null; pet.lookCam = 1;
    }
    pet.expr = keen ? 'excited' : 'happy'; pet.o.tongue = keen ? 0.7 : 0.3; pet.o.tailWag = keen ? 1.4 : 0.7;
    if (keen) {
      g.audio.voice('excited'); pet.jump(160);
      if (dist(pet.x, pet.y, fx, fy) > 160) { pet.body = 'stand'; yield* walk(pet, fx + rand(-60, 60), fy, 260); pet.lookCam = 1; }
    }
    pet.body = 'sit';
    yield* wait(pet, 2.5);
  } else if (kind === 'play') {
    const fav = g.save.memory.favToy;
    const eager = tr.playful > 0.55 || tr.energy > 0.65 || b.mood === 'playful';
    if (tr.cuddly < 0.35 && !eager) {
      // independent: one ear up, a look… "maybe"
      pet.expr = 'curious'; pet.o.headTilt = 0.3;
      yield* wait(pet, 1.5);
      return;
    }
    pet.expr = eager ? 'excited' : 'happy'; pet.o.tailWag = eager ? 1.5 : 0.8;
    if (eager) { pet.body = 'bow'; g.audio.voice('excited'); }
    if (b.habit('walkies') > 0.4 && g.walk.canStart() && chance(0.4)) pet.think('walk', 2.5); // "…walkies?"
    else if (fav && g.save.inventory.toys.includes(fav)) pet.think(fav, 2.5); // "the good one, please!"
    yield* wait(pet, 2.5);
    pet.body = 'stand';
  } else if (kind === 'care') {
    const brushFan = b.habit('brush') > 0.3 || tr.cuddly > 0.65;
    const bathShy = tr.brave < 0.4 && b.habit('bath') < HABIT_OK;
    if (bathShy && !brushFan) { pet.expr = 'surprised'; pet.o.earPerk = -0.7; pet.emote('sweat'); pet.o.tilt = -0.08; } // uh-oh… bath?
    else if (brushFan) { pet.expr = 'love'; pet.o.tailWag = 1; pet.body = 'sit'; g.audio.voice('coo'); }
    else { pet.expr = 'curious'; pet.o.headTilt = 0.25; }
    yield* wait(pet, 2.2);
  }
  pet.o = {};
}
const HABIT_OK = 0.45;

/** Deep asleep, but a food-lover's nose knows when snacks are out. */
function* sniffAwake(b: Brain): Gen {
  const pet = b.pet;
  pet.o.sniff = 1; pet.o.earPerk = 0.6;
  yield* wait(pet, 0.8);
  pet.asleep = false; pet.o = {};
  pet.expr = 'surprised'; pet.emote('!');
  yield* wakeUp(pet);
  yield* anticipateTray(b, 'feed');
}

export function* trickSit(pet: Pet): Gen { pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'happy'; yield* wait(pet, 1.1); }
export function* trickSpin(pet: Pet): Gen {
  pet.body = 'stand'; pet.expr = 'joy';
  pet.jump(200);
  for (let i = 0; i < 4; i++) { pet.face(-pet.facing); pet.g.fx.dust(pet.x, pet.y, 1); yield* wait(pet, 0.16); }
  pet.g.audio.voice('excited');
  yield* wait(pet, 0.5);
}
export function* trickHighFive(pet: Pet): Gen {
  pet.body = 'sit'; pet.lookCam = 1; pet.o.front = 0.55; pet.expr = 'excited';
  yield* wait(pet, 0.4);
  pet.o.paw = 1;
  yield* wait(pet, 0.5);
  pet.g.onHighFive();
  pet.expr = 'joy';
  yield* wait(pet, 0.7);
  pet.o.paw = 0;
  yield* wait(pet, 0.3);
}
export function* trickRoll(pet: Pet): Gen {
  pet.body = 'lie'; pet.expr = 'happy';
  yield* wait(pet, 0.4);
  pet.body = 'belly'; pet.expr = 'joy';
  pet.moveTo(pet.x + pet.facing * 40, pet.y, 80);
  yield* wait(pet, 0.9);
  pet.body = 'lie';
  yield* wait(pet, 0.4);
  pet.body = 'stand';
  yield* wait(pet, 0.2);
  pet.o.shake = 1; pet.g.audio.shake();
  yield* wait(pet, 0.45);
  pet.o.shake = 0;
}
export const TRICK_ANIMS: Record<string, (p: Pet) => Gen> = { sit: trickSit, spin: trickSpin, highfive: trickHighFive, rollover: trickRoll };

function* eatFrom(pet: Pet, s: number, crunch = true): Gen {
  pet.o.headDown = 1; pet.expr = 'chew';
  let t = 0, nx = 0;
  while (t < s) {
    t += pet.dt;
    pet.o.mouthOpen = Math.abs(Math.sin(t * 9)) * 0.5;
    if (t > nx) { nx = t + 0.45; if (crunch) pet.g.audio.crunch(); pet.g.fx.crumbs(...pet.mouthPos(), 2); }
    yield;
  }
  pet.o.headDown = 0; pet.o.mouthOpen = 0;
}

export function* sneeze(pet: Pet): Gen {
  pet.moving = false;
  pet.expr = 'surprised';
  pet.o.headTilt = -0.25; pet.o.eyeOpen = 0.3;
  yield* wait(pet, 0.25);
  pet.o.eyeOpen = 0.1;
  yield* wait(pet, 0.35);
  pet.g.audio.sneeze();
  yield* wait(pet, 0.3);
  pet.o.headTilt = 0.3; pet.o.headDown = 0.5; pet.squash(0.6);
  pet.o.eyeOpen = 0; pet.o.mouthOpen = 0.6;
  pet.g.fx.drops(...pet.mouthPos(), 4, 80);
  yield* wait(pet, 0.25);
  pet.o = {};
  pet.expr = 'surprised';
  pet.lookCam = 1;
  yield* wait(pet, 0.7);
  pet.expr = 'happy'; pet.o.blush = 1;
  yield* wait(pet, 0.8);
}

/** Sniffing something up close: brave noses dive straight in, cautious ones creep up first. */
function* sniffAt(b: Brain, x: number, y: number): Gen {
  const pet = b.pet, g = b.g;
  pet.expr = 'curious';
  pet.o.headTilt = rand(0.2, 0.4) * (chance(0.5) ? 1 : -1); // head tilt: "what IS that?"
  pet.lookAt = { x, y: y - 50 };
  yield* wait(pet, b.tr.brave > 0.6 ? 0.4 : 1);
  if (b.tr.brave < 0.35 && chance(0.6)) {
    // cautious hop back, a nervous look at you, then a braver, slower approach
    pet.expr = 'surprised'; pet.jump(180); pet.moveTo(pet.x - pet.facing * 40, pet.y, 120); g.audio.voice('surprise');
    yield* wait(pet, 0.6);
    pet.lookCam = 0.8; yield* wait(pet, 0.5); pet.lookCam = 0;
    pet.expr = 'curious'; pet.o.crouch = 0.6;
    yield* walk(pet, x - pet.facing * 30, y + 20, 45);
    pet.o.crouch = undefined;
  }
  pet.o.headDown = 0.6; pet.o.sniff = 1; g.audio.sniff();
  yield* wait(pet, b.tr.brave > 0.6 ? 0.8 : 1.3);
  pet.o = {};
  b.st.mark('sniffed');
}

function makeBehaviors(b: Brain): Behavior[] {
  const g = b.g;
  const P = () => b.pet;
  const st = b.st;
  const bounds = () => g.world.zoneBounds(g.zone);
  const front = () => g.frontPoint();
  // (a fresh greeting counts as social time too, so it doesn't pester right after saying hello)
  const played = (s: number) => st.within('fetch', s) || st.within('toy', s) || st.within('played', s) || st.within('greeted', Math.min(s, 45)) || st.within('walked', Math.min(s, 90));
  const L: Behavior[] = [
    {
      id: 'wander', cd: 3, w: (b) => 0.7 + b.tr.energy * 0.3,
      run: function* () {
        const pet = P();
        // close friends (and cuddly pets) tend to drift toward you
        const nearYou = chance(b.fl * 0.08 + b.tr.cuddly * 0.12);
        let [x, y] = g.world.randomPoint(g.zone);
        if (nearYou) { const [fx, fy] = front(); x = fx + rand(-160, 160); y = fy - rand(0, 50); }
        yield* walk(pet, x, y, 90 + b.tr.energy * 40);
        if (chance(0.5)) { pet.body = 'sit'; }
        if (nearYou) { pet.lookCam = 1; pet.o.tailWag = 0.8; yield* wait(pet, rand(1, 2)); pet.lookCam = 0; pet.o = {}; }
        yield* lookAround(pet, rand(1, 3));
      },
    },
    {
      id: 'sniff', cd: 8, w: (b) => 0.35 + b.tr.curious * 0.6,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.randomPoint(g.zone);
        yield* walk(pet, x, y, 80);
        pet.o.headDown = 0.9; pet.o.sniff = 1; pet.expr = 'curious';
        for (let i = 0; i < 3; i++) { g.audio.sniff(); pet.moveTo(pet.x + pet.facing * 25, pet.y + rand(-8, 8), 40); yield* wait(pet, 0.6); }
        pet.o.headDown = 0; pet.o.sniff = 0;
        st.mark('sniffed');
        // a good long sniff tickles the nose sometimes (flowers & grass even more)
        if (chance(g.zone === 'garden' ? 0.3 : 0.18)) { yield* sneeze(pet); }
        else if (chance(0.4)) { pet.emote('?'); pet.o.headTilt = 0.3; yield* wait(pet, 1); }
      },
    },
    {
      // SLEEPY: calmer steps → yawn → a look at the bed → walk over → circle → settle → sleep.
      // A tired, cuddly best friend beds down near you instead (and may ask for a goodnight cuddle).
      id: 'nap', cd: 40, w: (b) => Math.pow(1 - b.n.energy, 2) * 5 + (g.world.isNight() && b.n.energy < 0.8 ? 0.3 : 0) + (b.tr.energy < 0.3 ? 0.12 : 0) - (b.drowsy ? 1 : 0),
      run: function* () {
        const pet = P();
        const inRoom = g.zone === 'room';
        const nearYou = b.fl >= 3 && (b.tr.cuddly > 0.55 || b.habit('bedCuddle') > 0.3);
        let [x, y] = inRoom ? g.world.poi(g.world.isDay() && chance(0.3) ? 'sunbeam' : 'bed') : g.world.poi('sunny');
        if (nearYou) { const [fx, fy] = front(); x = fx + rand(-90, 90); y = fy - 20; }
        pet.expr = 'sleepy';
        pet.o.mouthOpen = 0.9; pet.o.eyeOpen = 0; g.audio.voice('yawn');
        yield* wait(pet, 0.9);
        pet.o = {};
        yield* approach(pet, x, y, 65);
        if (nearYou && b.n.affection < 0.8 && chance(0.4 + b.habit('bedCuddle'))) {
          pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'sleepy'; pet.o.blush = 0.7;
          yield* askFor(b, 'heart', 6, (t) => { pet.o.tilt = Math.sin(t * 2) * 0.05; });
          pet.lookCam = 0; pet.o = {};
        }
        // circle before lying down
        for (let i = 0; i < 3; i++) { pet.face(-pet.facing); pet.moveTo(x + (i % 2 ? 14 : -14), y + (i === 1 ? 6 : 0), 40); yield* wait(pet, 0.38); }
        pet.moving = false;
        pet.body = 'lie';
        // eyes slowly close
        let s = 0; while (s < 1.4) { s += pet.dt; pet.o.eyeOpen = 0.5 * (1 - s / 1.4); yield; }
        pet.asleep = true; pet.expr = null; pet.o = {};
        const dur = rand(25, 55) * (1.2 - b.tr.energy * 0.5);
        let t = 0, zt = 0;
        while (t < dur && b.n.energy < 0.98) {
          t += pet.dt; zt -= pet.dt;
          if (zt <= 0) { zt = 1.6; const [hx, hy] = pet.headPos(); g.fx.z(hx + 20 * pet.facing, hy - 40); }
          if (chance(pet.dt * 0.05)) { pet.o.smile = 0.9; } // dreaming smile
          if (chance(pet.dt * 0.03)) pet.o.kick = 1; else if (chance(pet.dt * 0.5)) pet.o.kick = 0;
          yield;
        }
        pet.asleep = false; pet.o = {};
        yield* wakeUp(pet);
      },
    },
    {
      // after romping outside, a pet is thirsty
      id: 'drink', zone: 'room', cd: 70, w: (b) => 0.3 + (st.within('fromGarden', 90) || st.within('walked', 120) ? 1.2 : 0) + (st.count('fetch', 180) >= 3 ? 0.5 : 0) + (b.n.energy < 0.4 ? 0 : 0.05),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('water');
        yield* approach(pet, x, y, 110);
        pet.face(1);
        if (g.save.room.water < 0.1) {
          pet.o.headDown = 0.8; pet.o.sniff = 1; yield* wait(pet, 0.8); pet.o = {};
          pet.body = 'sit'; pet.lookCam = 1; g.audio.voice('question');
          yield* askFor(b, 'water', 6);
          return;
        }
        pet.o.headDown = 1; pet.expr = 'happy';
        let t = 0;
        while (t < 2.2) { t += pet.dt; pet.o.tongue = Math.abs(Math.sin(t * 10)); if (Math.sin(t * 10) > 0.98) g.audio.slurp(); yield; }
        g.save.room.water = Math.max(0, g.save.room.water - 0.2);
        pet.o = {};
        pet.o.tongue = 0.6; pet.expr = 'happy';
        yield* wait(pet, 0.6);
      },
    },
    {
      id: 'eatBowl', zone: 'room', cd: 10, w: (b) => (g.save.room.bowl > 0.05 ? (1 - b.n.hunger) * 4 + 0.3 + b.tr.appetite * 0.3 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('food');
        // food-lovers hurry, and lick their lips on the way
        const keen = b.tr.appetite > 0.65 || b.n.hunger < 0.35;
        if (keen) { pet.o.tongue = 0.6; pet.o.tailWag = 1.3; }
        yield* approach(pet, x, y, keen ? 220 : 140);
        pet.face(1);
        pet.o = {};
        if (b.tr.appetite < 0.35) { pet.o.headDown = 0.6; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.7); pet.o = {}; } // a picky once-over
        yield* eatFrom(pet, 3);
        const eaten = Math.min(g.save.room.bowl, 0.5);
        g.save.room.bowl -= eaten;
        b.n.hunger = clamp01(b.n.hunger + eaten * 0.9);
        st.mark('fed', 'kibble');
        pet.o.tongue = 0.7; pet.expr = 'happy';
        yield* wait(pet, 0.8);
      },
    },
    {
      // HUNGRY: stop → a look at the bowl → walk over → sniff → empty! → look at you → a polite ask
      id: 'askFood', zone: 'room', cd: 50, w: (b) => (b.n.hunger < 0.4 && g.save.room.bowl < 0.05 && !st.within('fed', 60) ? (1 - b.n.hunger) * 2 * (0.7 + b.tr.appetite * 0.6) : 0),
      run: function* () {
        const pet = P();
        pet.moving = false; pet.expr = 'hungry';
        pet.lookAt = { x: g.world.poi('bowlFood')[0], y: 480 };
        yield* wait(pet, 0.7);
        const [x, y] = g.world.poi('food');
        yield* approach(pet, x, y, 120 + b.tr.appetite * 80);
        pet.face(1); pet.o.headDown = 0.7; pet.o.sniff = 1; g.audio.sniff();
        yield* wait(pet, 0.9);
        pet.o = {}; pet.o.headTilt = 0.3; pet.expr = 'curious'; // …empty?
        yield* wait(pet, 0.5);
        pet.o = {}; pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'hungry';
        g.audio.voice('question');
        yield* askFor(b, 'kibble', 7, (t) => {
          // every so often, a hopeful paw-tap on the bowl and a look back at you
          const ph = t % 3;
          pet.o.paw = ph > 2.2 && ph < 2.6 ? 0.6 : 0;
          pet.lookCam = ph > 2 && ph < 2.8 ? 0 : 1;
          pet.lookAt = ph > 2 && ph < 2.8 ? { x: x + 40, y: y - 20 } : null;
        });
      },
    },
    {
      // the window: watches birds (it may also notice one fly past mid-activity — see watchEvents)
      id: 'window', zone: 'room', cd: 45, w: (b) => (g.world.isDay() ? 0.3 : 0.15) + b.tr.curious * 0.4 + (g.world.bird ? 0.3 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('window');
        const bird0 = g.world.bird;
        if (bird0) {
          // eyes first — then a head tilt — then it trots over
          pet.moving = false; pet.lookAt = { x: bird0.x, y: bird0.y }; pet.o.earPerk = 1; pet.expr = 'curious';
          yield* wait(pet, 0.45);
          pet.o.headTilt = 0.3; yield* wait(pet, 0.3); pet.o.headTilt = undefined;
        }
        yield* approach(pet, x + rand(-30, 30), y, bird0 ? 200 : 100, { x, y: 250 });
        pet.body = 'sit'; pet.expr = 'curious';
        let t = 0;
        const dur = rand(6, 10);
        let saw = false;
        while (t < dur) {
          t += pet.dt;
          const bird = g.world.bird;
          if (bird) {
            pet.lookAt = { x: bird.x, y: bird.y };
            if (!saw) { saw = true; pet.emote('!'); pet.expr = 'focus'; g.audio.voice('excited'); pet.o.tailWag = 1; }
            pet.o.mouthOpen = Math.abs(Math.sin(t * 20)) * 0.3; // chattering
          } else { pet.lookAt = { x: 430 + Math.sin(t * 0.7) * 80, y: 200 }; pet.o.mouthOpen = 0; }
          yield;
        }
        pet.o = {};
        if (saw && chance(0.5)) { pet.lookCam = 1; pet.expr = 'excited'; pet.o.tailWag = 1.2; yield* wait(pet, 1); } // "did you SEE that?"
      },
    },
    {
      id: 'sunbathe', zone: 'room', cd: 90, w: (b) => (g.world.isDay() ? 0.2 + (1 - b.n.energy) * 0.6 + (1 - b.tr.energy) * 0.3 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('sunbeam');
        yield* approach(pet, x, y, 90);
        pet.body = 'lie'; pet.expr = 'bliss';
        yield* wait(pet, 2);
        pet.body = 'belly'; b.purr = 0.4;
        let t = 0; while (t < rand(5, 8)) { t += pet.dt; b.purr = 0.35; yield; }
        pet.body = 'lie'; yield* wait(pet, 1);
      },
    },
    {
      // plays alone: independent pets entertain themselves more
      id: 'basket', zone: 'room', cd: 60, w: (b) => ((1 - b.n.fun) * 1.2 + b.tr.playful * 0.4) * (b.tr.cuddly < 0.35 ? 1.6 : 1) * (1 + b.habit('fetch')),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('basket');
        yield* approach(pet, x, y, 130);
        pet.face(pet.x < x ? 1 : -1);
        pet.o.headDown = 1; pet.expr = 'focus';
        for (let i = 0; i < 3; i++) { pet.squash(0.2); g.audio.sniff(); yield* wait(pet, 0.35); }
        pet.o.headDown = 0;
        const toy = b.preferredToy();
        pet.held = toy; pet.expr = 'happy';
        if (toy === 'squeaky') g.audio.squeak();
        yield* walk(pet, pet.x + rand(-160, 160), pet.y + rand(20, 90), 170);
        // shake it!
        for (let i = 0; i < 6; i++) { pet.o.headTilt = i % 2 ? 0.35 : -0.35; if (toy === 'squeaky' && i % 2) g.audio.squeak(); yield* wait(pet, 0.09); }
        pet.o.headTilt = 0;
        pet.held = null;
        g.toys.dropFromPet(toy, pet.x + pet.facing * 50, pet.y + 6);
        pet.body = 'bow'; pet.expr = 'excited'; pet.o.tailWag = 1;
        yield* wait(pet, 1.2);
        pet.body = 'stand';
        st.mark('played', toy);
        g.memoryToy(toy);
      },
    },
    {
      id: 'chaseTail', cd: 150, w: (b) => (b.n.energy > 0.4 ? b.tr.playful * 0.25 + b.tr.energy * 0.15 + (b.mood === 'playful' || b.mood === 'mischievous' ? 0.2 : 0) : 0),
      run: function* () {
        const pet = P();
        pet.lookAt = { x: pet.x - pet.facing * 90, y: pet.y - 40 };
        pet.expr = 'focus';
        yield* wait(pet, 0.9);
        pet.emote('!');
        pet.expr = 'excited';
        for (let i = 0; i < randi(7, 11); i++) { pet.face(-pet.facing); pet.squash(0.1); yield* wait(pet, 0.17); if (i % 3 === 0) g.fx.dust(pet.x, pet.y, 1); }
        pet.expr = 'dizzy'; pet.body = 'sit'; g.audio.voice('giggle');
        let t = 0; while (t < 2) { t += pet.dt; pet.o.tilt = Math.sin(t * 5) * 0.12; yield; }
        pet.o.tilt = 0;
      },
    },
    {
      // energetic pets get zoomies — and so does anyone fresh out of the bath
      id: 'zoomies', cd: 180, w: (b) => (b.n.energy > 0.6 ? b.tr.energy * 0.4 + b.excitement * 0.6 * b.tr.energy : 0) + (st.within('bathed', 90) ? 1.2 : 0),
      run: function* () {
        const pet = P();
        pet.body = 'bow'; pet.expr = 'mischief'; yield* wait(pet, 0.6);
        pet.expr = 'excited'; pet.body = 'stand'; g.audio.voice('excited');
        const bb = bounds();
        for (let i = 0; i < randi(4, 6); i++) {
          const x = i % 2 ? bb.x0 + rand(0, 150) : bb.x1 - rand(0, 150);
          yield* walk(pet, x, rand(bb.y0, bb.y1), 330, 4);
          if (chance(0.5)) pet.jump(220);
        }
        pet.body = 'lie'; pet.expr = 'happy'; pet.o.tongue = 1; pet.o.mouthOpen = 0.4;
        b.n.energy = clamp01(b.n.energy - 0.05);
        yield* wait(pet, 2.5);
      },
    },
    {
      // AFFECTIONATE: come over → sit close → look up → lean & nudge → (only then) ask for pets.
      // A new friend just sits nearby and watches you; a best friend may flop over for belly rubs.
      id: 'cuddleUp', cd: 35, w: (b) => ((1 - b.n.affection) * 1.6 + b.tr.cuddly * 0.5 + b.fl * 0.1) * (0.45 + b.tr.cuddly * 0.8) * (st.within('petted', 90) || st.within('greeted', 45) ? 0.2 : 1) * (b.snubbed('heart') ? 0.3 : 1),
      run: function* () {
        const pet = P();
        const [fx, fy] = front();
        const shy = b.fl === 0 && b.tr.cuddly < 0.6;
        const tx = shy ? (pet.x + fx) / 2 + rand(-60, 60) : fx + rand(-80, 80);
        yield* approach(pet, tx, shy ? Math.min(fy, pet.y + 30) : fy, 140, { x: fx, y: 200 });
        pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'happy'; pet.o.blush = 0.8;
        if (shy) { yield* watchYou(b, rand(3, 5)); return; }
        // lean in & nudge
        for (let i = 0; i < 2; i++) {
          pet.o.tilt = 0.08; pet.o.headTilt = 0.3; g.audio.voice('coo');
          yield* wait(pet, 0.45);
          pet.o.tilt = 0; pet.o.headTilt = -0.1;
          yield* wait(pet, 0.5);
        }
        pet.o.headTilt = undefined;
        if (b.n.affection < 0.6) {
          const belly = b.fl >= 3 && chance(0.5);
          if (belly) { pet.body = 'belly'; g.audio.voice('giggle'); }
          yield* askFor(b, belly ? 'belly' : 'heart', rand(5, 7), (t) => { if (!belly) pet.o.tilt = Math.sin(t * 2.2) * 0.04; });
          if (belly) pet.body = 'lie';
        } else {
          yield* wait(pet, rand(2, 4));
        }
      },
    },
    {
      // a new friend keeps an eye on you from a little way off
      id: 'watch', cd: 30, w: (b) => (b.fl === 0 ? 0.45 : b.fl === 1 ? 0.2 : 0.04) * (0.5 + b.tr.curious),
      run: function* () {
        const pet = P();
        const [fx, fy] = front();
        const side = pet.x < fx ? -1 : 1;
        const x = clamp(fx + side * rand(180, 300), bounds().x0, bounds().x1);
        yield* approach(pet, x, fy - rand(40, 90), 100, { x: fx, y: 200 });
        pet.body = 'sit';
        yield* watchYou(b, rand(3, 6));
      },
    },
    {
      // RELAXED: a long, content lounge — close to you if you're good friends
      id: 'lounge', cd: 45, w: (b) => (1 - b.tr.energy) * 0.45 + (st.within('fed', 150) || st.within('walked', 150) ? 0.3 : 0) + (b.fl >= 3 ? b.tr.cuddly * 0.3 : 0) + (b.n.energy < 0.5 ? 0.15 : 0),
      run: function* () {
        const pet = P();
        let [x, y] = g.zone === 'room' ? g.world.poi(pick(['rug', 'rug', 'bed'])) : g.world.poi('sunny');
        const nearYou = b.fl >= 2 && chance(0.3 + b.tr.cuddly * 0.5);
        if (nearYou) { const [fx, fy] = front(); x = fx + rand(-120, 120); y = fy - 30; }
        yield* approach(pet, x + rand(-40, 40), y, 80);
        pet.body = 'lie'; pet.expr = 'bliss';
        const dur = rand(6, 10) * (1.4 - b.tr.energy * 0.6);
        let t = 0, nt = rand(1.5, 3);
        while (t < dur) {
          t += pet.dt;
          pet.o.tailWag = 0.25; b.purr = Math.max(b.purr, nearYou ? 0.25 : 0);
          if (t > nt) { // slow blink & a look at you now and then
            nt = t + rand(2, 4);
            pet.lookCam = nearYou || chance(0.4) ? 1 : 0;
            pet.expr = chance(0.5) ? 'bliss' : 'happy';
          }
          yield;
        }
        pet.lookCam = 0; pet.o = {};
        if (chance(0.5)) yield* wakeUp(pet, false);
      },
    },
    {
      // licks a paw & washes its face — very likely right after eating
      id: 'groom', cd: 60, w: () => 0.2 + (st.within('fed', 60) ? 0.9 : 0),
      run: function* () {
        const pet = P();
        pet.body = 'sit';
        yield* wait(pet, 0.4);
        for (let i = 0; i < 4; i++) {
          pet.o.paw = 0.7; pet.o.headDown = 0.35; pet.o.tongue = 0.8; pet.o.eyeOpen = 0.3;
          yield* wait(pet, 0.3);
          pet.o.tongue = 0.2;
          yield* wait(pet, 0.2);
        }
        pet.o.paw = 0; pet.o.headDown = 0; pet.o.tongue = 0;
        for (let i = 0; i < 3; i++) { pet.o.headTilt = 0.3; pet.o.paw = 0.9; yield* wait(pet, 0.2); pet.o.headTilt = -0.1; yield* wait(pet, 0.2); }
        pet.o = {};
        pet.expr = 'happy';
        yield* wait(pet, 0.5);
      },
    },
    {
      id: 'stretch', cd: 50, w: () => 0.15,
      run: function* () { yield* wakeUp(P(), false); },
    },
    {
      // rolls around on the rug — a favourite way to finish drying after a bath
      id: 'rug', zone: 'room', cd: 90, w: (b) => 0.2 + b.tr.playful * 0.2 + (st.within('bathed', 150) ? 1.5 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('rug');
        yield* approach(pet, x + rand(-60, 60), y, 110);
        pet.body = 'lie'; yield* wait(pet, 0.5);
        pet.body = 'belly'; pet.expr = 'joy'; g.audio.voice('giggle');
        let t = 0; while (t < 2.5) { t += pet.dt; pet.o.tilt = Math.sin(t * 8) * 0.15; yield; }
        pet.o.tilt = 0; pet.body = 'lie'; yield* wait(pet, 0.6); pet.body = 'stand';
      },
    },
    {
      // after a bath: one more big shake, just to be sure
      id: 'bathShake', cd: 40, w: () => (st.within('bathed', 150) ? 0.9 : 0),
      run: function* () {
        const pet = P();
        pet.moving = false; pet.expr = 'focus';
        yield* wait(pet, 0.5);
        pet.o.shake = 1; g.audio.shake(); g.fx.sparkles(pet.x, pet.y - 110, 6, 70);
        yield* wait(pet, 0.5);
        pet.o = {}; pet.expr = 'starry'; pet.lookCam = 1; // "look how fluffy I am!"
        yield* wait(pet, 1.2);
      },
    },
    {
      // CURIOUS: notice → eyes → head → approach → sniff → tilt → react. New things first!
      id: 'investigate', cd: 25, w: (b) => b.tr.curious * 0.6 + b.buzz * 2 + (b.novel ? 2 : 0),
      run: function* () {
        const pet = P();
        const nov = b.novel;
        b.novel = null;
        let x: number, y: number;
        if (nov) [x, y] = [nov.x, nov.y];
        else [x, y] = g.world.poi(pick(g.zone === 'room' ? ['plant', 'basket', 'bed', 'window', 'door', 'water'] : ['tree', 'flowers', 'decor', 'fence']));
        pet.moving = false;
        if (nov) { pet.lookAt = { x, y: y - 50 }; pet.o.earPerk = 1; pet.emote(b.tr.brave > 0.5 ? '!' : '?'); yield* wait(pet, 0.5); }
        const high = nov?.look; // something up on the wall: gaze up at it instead of sniffing
        yield* approach(pet, x + rand(-40, 40), y + 20, nov && b.tr.brave > 0.6 ? 200 : 100, high ? { x, y: high } : undefined);
        if (high) { pet.body = 'sit'; pet.lookAt = { x, y: high }; pet.expr = 'curious'; pet.o.headTilt = 0.35; yield* wait(pet, 1.6); pet.o = {}; }
        else yield* sniffAt(b, x, y);
        if (chance(0.15)) yield* sneeze(pet);
        else if (nov) {
          // verdict: it's great!
          pet.expr = 'joy'; pet.o.tailWag = 1.2; pet.emote('heart'); g.audio.voice('happy');
          if (b.tr.playful > 0.6) { pet.jump(180); }
          yield* wait(pet, 0.8);
          pet.lookCam = 1; yield* wait(pet, 0.8);
        } else if (chance(0.5)) pet.emote('?');
        else { pet.emote('note'); pet.expr = 'happy'; }
        g.observe('curious');
        yield* wait(pet, 1);
      },
    },
    {
      // PLAYFUL: comes over, bows, and thinks of its favourite toy. Not right after a big play session.
      id: 'askPlay', cd: 70, w: (b) => (b.n.fun < 0.45 && b.n.energy > 0.35 && !played(120) && !g.toys.active && !b.snubbed('ball') ? (1 - b.n.fun) * 1.3 * (0.5 + b.tr.playful) : 0),
      run: function* () {
        const pet = P();
        const [x, y] = front();
        yield* approach(pet, x, y - 20, 160, { x, y: 200 });
        pet.lookCam = 1; pet.body = 'bow'; pet.expr = 'excited';
        const fav = g.save.memory.favToy ?? 'ball';
        const toy = g.save.inventory.toys.includes(fav) ? fav : 'ball';
        g.audio.voice('excited');
        const ok = yield* askFor(b, toy, 6, (t) => {
          if (t % 1.4 < pet.dt) pet.jump(140);
          pet.o.tailWag = 1.3;
        });
        if (!ok && pet.g.toys.active === null) {
          // fine — it'll entertain itself for a bit
          pet.body = 'stand';
          yield* wait(pet, 0.3);
          pet.lookAt = { x: pet.x + pet.facing * 120, y: pet.y - 20 }; pet.body = 'crouch'; pet.expr = 'mischief';
          yield* wait(pet, 0.7);
          pet.body = 'stand'; pet.jump(260); pet.moveTo(pet.x + pet.facing * 110, pet.y, 260); g.audio.boing();
          yield* wait(pet, 0.7);
          pet.expr = 'happy';
        }
      },
    },
    {
      // waits by the garden door — a habit for pets that go outside a lot
      id: 'doorWait', zone: 'room', cd: 150, w: (b) => (b.fl >= 1 && b.zoneTime > 120 && !st.within('fromGarden', 120) ? 0.04 + b.habit('garden') * 0.9 + b.tr.energy * 0.08 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('door');
        yield* approach(pet, x - 40, y, 140, { x: 985, y: 330 });
        pet.face(1); pet.body = 'sit'; pet.lookAt = { x: 985, y: 330 }; pet.o.earPerk = 1;
        yield* wait(pet, 1.2);
        pet.lookAt = null; pet.lookCam = 1; // a look back at you…
        yield* wait(pet, 0.8);
        pet.lookCam = 0; pet.body = 'stand'; pet.face(1);
        pet.o.paw = 0.8; yield* wait(pet, 0.3); pet.o.paw = 0; yield* wait(pet, 0.3); pet.o.paw = 0.8; yield* wait(pet, 0.3); pet.o.paw = 0;
        pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'hungry'; g.audio.voice('question');
        const ok = yield* askFor(b, 'outside', 6);
        if (!ok) { pet.body = 'lie'; pet.lookAt = { x: 985, y: 330 }; yield* wait(pet, rand(2, 4)); }
      },
    },
    {
      // WALKIES habit: a pet that loves walks goes and sits by the garden gate now and then
      id: 'gateWait', zone: 'garden', cd: 200, w: (b) => (b.fl >= 1 && b.habit('walkies') > 0.25 && !st.within('walked', 300) && !b.snubbed('walk', 300) ? b.habit('walkies') * 0.7 : 0),
      run: function* () {
        const pet = P();
        yield* approach(pet, 1935, 525, 170, { x: 1985, y: 380 });
        pet.face(1); pet.body = 'sit'; pet.lookAt = { x: 1985, y: 380 }; pet.o.earPerk = 1; pet.o.tailWag = 1.2;
        yield* wait(pet, 1.2);
        pet.lookAt = null; pet.lookCam = 1; yield* wait(pet, 0.7); // a look back at you…
        pet.lookCam = 0; pet.lookAt = { x: 1985, y: 380 }; pet.o.paw = 0.7; yield* wait(pet, 0.3); pet.o.paw = 0; yield* wait(pet, 0.4);
        pet.lookAt = null; pet.lookCam = 1; g.audio.voice('question');
        yield* askFor(b, 'walk', 6, (t) => { pet.o.tailWag = 0.8 + Math.sin(t * 3) * 0.4; });
      },
    },
    {
      // SOCIAL PLAY: fetches its (favourite) toy, looks to you, brings it and waits for a throw.
      // If you're busy, it nudges it closer, then carries it back to the toy box. No sulking.
      id: 'bringToy', cd: 120, zone: 'room', w: (b) => {
        if (b.fl < 2 || g.toys.active || played(120) || b.n.energy < 0.3 || b.snubbed('ball')) return 0;
        const fav = g.save.memory.favToy;
        const favCarry = !!fav && b.carryToys().includes(fav);
        return 0.3 * (0.5 + b.tr.playful) * (1 + b.habit('fetch') * 2) * (favCarry ? 1.5 : 1) * (b.mood === 'playful' ? 1.6 : 1);
      },
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('basket');
        yield* approach(pet, x, y, 150);
        pet.o.headDown = 1; yield* wait(pet, 0.7); pet.o.headDown = 0;
        const toy = b.preferredToy();
        pet.held = toy; pet.expr = 'happy';
        if (toy === 'squeaky') g.audio.squeak();
        pet.lookCam = 1; pet.o.tailWag = 1.3; yield* wait(pet, 0.5); pet.lookCam = 0; // "look what I've got!"
        const [fx, fy] = front();
        yield* walk(pet, fx, fy, 170);
        pet.lookCam = 1; pet.face(fx - pet.x || 1);
        yield* wait(pet, 0.3);
        pet.held = null;
        g.toys.dropFromPet(toy, pet.x + pet.facing * 45, pet.y + 8, true);
        pet.body = 'bow'; pet.expr = 'excited'; g.audio.voice('excited');
        const thr = g.toys.thr;
        // wait for a throw (a throw takes the pet straight into the fetch game)
        let t = 0;
        while (t < 7) {
          t += pet.dt;
          const look = t % 2.4 < 1.2;
          pet.lookCam = look ? 1 : 0; pet.lookAt = look || !thr ? null : { x: thr.x, y: thr.y };
          if (t > 1.6) pet.body = 'sit';
          yield;
        }
        if (!thr || g.toys.thr !== thr || thr.carried) return;
        // a hopeful nudge closer to you…
        pet.lookCam = 0; pet.lookAt = { x: thr.x, y: thr.y }; pet.body = 'stand';
        pet.o.headDown = 0.7; pet.moveTo(thr.x - pet.facing * 30, thr.y, 60);
        yield* wait(pet, 0.5);
        thr.vx = (fx - thr.x) * 0.9; thr.vy = 20; thr.vz = 120; thr.z = 4; g.audio.boing();
        pet.o = {}; pet.lookCam = 1; pet.body = 'sit'; pet.o.tailWag = 1;
        t = 0; while (t < 4) { t += pet.dt; yield; }
        if (g.toys.thr !== thr || thr.carried || thr.grabbed) return;
        // …okay, maybe later: it tidies the toy back into the box
        pet.expr = 'happy'; pet.body = 'stand';
        yield* walk(pet, thr.x - pet.facing * 30, thr.y, 120);
        if (g.toys.thr !== thr) return;
        thr.carried = true; pet.held = thr.kind;
        yield* walk(pet, x, y, 120);
        pet.held = null; pet.o.headDown = 0.8;
        g.toys.clear(); g.ui.refresh();
        yield* wait(pet, 0.4);
        pet.o = {};
      },
    },
    {
      // shows off a trick unprompted — especially one it's been practising lately
      id: 'showTrick', cd: 80, w: (b) => {
        if (!b.learnedTricks().length) return 0;
        return 0.08 + b.excitement * 0.7 + (b.mood === 'playful' ? 0.15 : 0) + b.fl * 0.03 + b.habit('tricks') * 0.3 + (st.within('trick', 300) ? 0.25 : 0);
      },
      run: function* () {
        const pet = P();
        const learned = b.learnedTricks();
        const last = st.detail('trick');
        const tr = last && learned.includes(last) && chance(0.6) ? last : pick(learned);
        const [x, y] = front();
        yield* approach(pet, x + rand(-60, 60), y, 150, { x, y: 200 });
        pet.lookCam = 1;
        yield* wait(pet, 0.3);
        yield* TRICK_ANIMS[tr](pet);
        pet.o = {}; pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'happy'; pet.emote('spark');
        yield* wait(pet, 2);
      },
    },
    {
      // stalk & pounce on the player's pointer / last touch
      id: 'stalkPointer', cd: 30, w: (b) => {
        const p = g.pointer;
        if (!p.recent || p.wy < 440 || g.world.zoneOf(p.wx) !== g.zone) return 0;
        return (b.mood === 'mischievous' || b.mood === 'playful' ? 1.2 : 0.3) * (0.5 + b.tr.playful);
      },
      run: function* () {
        const pet = P();
        const tx = g.pointer.wx, ty = Math.max(g.pointer.wy, 470);
        pet.lookAt = { x: tx, y: ty }; pet.expr = 'mischief';
        yield* walk(pet, tx - Math.sign(tx - pet.x || 1) * 160, ty, 120, 4);
        pet.faceToward(tx);
        pet.body = 'crouch'; pet.expr = 'focus'; pet.o.tailWag = 1.2;
        let t = 0;
        while (t < 1.3) { t += pet.dt; pet.o.tilt = Math.sin(t * 25) * 0.04; pet.lookAt = { x: g.pointer.wx, y: g.pointer.wy }; yield; }
        pet.o = {}; pet.body = 'stand';
        pet.jump(330); pet.moveTo(g.pointer.wx, Math.max(g.pointer.wy, 470), 330); g.audio.boing();
        yield* wait(pet, 0.6);
        pet.expr = 'joy'; pet.lookCam = 1; g.audio.voice('giggle');
        g.observe('pounce');
        yield* wait(pet, 1);
      },
    },
    {
      // a big fetch session leaves a happy, panting heap on the rug
      id: 'pant', cd: 200, w: () => (st.count('fetch', 180) >= 4 ? 2.5 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.zone === 'room' ? g.world.poi('rug') : g.world.poi('sunny');
        yield* approach(pet, x + rand(-50, 50), y, 90);
        pet.body = 'belly'; pet.expr = 'happy'; pet.o.tongue = 1; pet.o.mouthOpen = 0.5; pet.lookCam = 0.5;
        let t = 0; while (t < 4) { t += pet.dt; pet.o.tilt = Math.sin(t * 9) * 0.02; yield; }
        pet.o = {}; pet.body = 'lie'; pet.expr = 'bliss';
        yield* wait(pet, 1.5);
      },
    },
    // ---------- surprises (rare, and tied to what just happened) ----------
    { id: 'sneeze', cd: 200, w: () => 0.03, run: function* () { yield* sneeze(P()); } },
    {
      // hiccups come from gobbling food — almost never out of nowhere
      id: 'hiccups', cd: 400, w: (b) => (st.within('fed', 90) ? 0.25 + b.tr.appetite * 0.2 : 0.004),
      run: function* () {
        const pet = P();
        pet.body = 'sit';
        for (let i = 0; i < randi(4, 6); i++) {
          yield* wait(pet, rand(0.7, 1.3));
          pet.jump(110); pet.emote('hic', 0.6); g.audio.hic(); pet.expr = 'surprised';
          yield* wait(pet, 0.3); pet.expr = null;
        }
        pet.expr = 'happy'; pet.o.blush = 1; pet.lookCam = 1;
        yield* wait(pet, 1);
      },
    },
    {
      id: 'lookBehind', cd: 220, w: (b) => 0.03 + (b.tr.brave < 0.35 ? 0.03 : 0),
      run: function* () {
        const pet = P();
        pet.moving = false;
        pet.expr = 'surprised'; pet.o.earPerk = 1;
        yield* wait(pet, 0.6);
        pet.face(-pet.facing); pet.emote('?');
        pet.expr = 'focus';
        yield* wait(pet, 1.4);
        pet.o.headTilt = 0.35;
        yield* wait(pet, 0.8);
        pet.face(-pet.facing); pet.o = {};
        pet.lookCam = 1; pet.expr = 'happy';
        yield* wait(pet, 0.8);
      },
    },
    {
      // nods off sitting up — only when actually sleepy
      id: 'dozeOff', cd: 300, w: (b) => (b.n.energy < 0.45 ? 0.3 : 0) + (b.drowsy ? 0.15 : 0),
      run: function* () {
        const pet = P();
        pet.body = 'sit'; pet.lookCam = 0.5;
        pet.expr = 'sleepy';
        yield* wait(pet, 1.5);
        for (let i = 0; i < 3; i++) {
          pet.o.eyeOpen = 0.05; pet.o.headDown = 0.5;
          yield* wait(pet, 1 + i * 0.4);
          pet.o.eyeOpen = 0.5; pet.o.headDown = 0;
          yield* wait(pet, 0.5);
        }
        pet.o.eyeOpen = 0; pet.o.headDown = 0.7;
        yield* wait(pet, 1.5);
        pet.o = {}; pet.jump(160); pet.expr = 'surprised'; g.audio.voice('surprise');
        yield* wait(pet, 0.6);
        pet.expr = 'happy'; pet.o.blush = 1; pet.lookCam = 1;
        yield* wait(pet, 1.2);
      },
    },
    {
      // hums a little song when all is well (after cuddles especially)
      id: 'sing', cd: 240, w: (b) => (b.mood === 'content' || b.mood === 'playful' ? 0.06 : 0.01) + (st.within('petted', 120) ? 0.1 : 0),
      run: function* () {
        const pet = P();
        pet.body = 'sit'; pet.lookCam = 0.4; pet.expr = 'love';
        let t = 0, nt = 0;
        while (t < 4) {
          t += pet.dt;
          pet.o.tilt = Math.sin(t * 3) * 0.1; pet.o.headTilt = Math.sin(t * 3) * 0.2;
          pet.o.mouthOpen = Math.abs(Math.sin(t * 6)) * 0.5;
          if (t > nt) { nt = t + 0.5; const [hx, hy] = pet.headPos(); g.fx.note(hx, hy - 40); g.audio.voice(chance(0.5) ? 'coo' : 'happy'); }
          yield;
        }
        pet.o = {};
      },
    },
    // ---------- garden ----------
    {
      id: 'butterfly', zone: 'garden', cd: 20, w: (b) => 0.5 + b.tr.playful * 0.5 + b.tr.curious * 0.3,
      run: function* () {
        const pet = P();
        const bf = g.world.nearestButterfly(pet.x, pet.y);
        if (!bf) return;
        // eyes first, then the ears, then a head tilt
        pet.moving = false; pet.lookAt = { x: bf.x, y: bf.y }; pet.o.earPerk = 1;
        yield* wait(pet, 0.35);
        pet.expr = 'focus'; pet.emote('!'); pet.o.headTilt = 0.25;
        yield* wait(pet, 0.25);
        pet.o = {};
        // a curious pet studies it first: follows it slowly, head tilting as it flutters
        if (b.tr.curious > 0.6) {
          pet.expr = 'curious';
          let s = 0;
          while (s < 3) {
            s += pet.dt; pet.lookAt = { x: bf.x, y: bf.y };
            pet.o.headTilt = Math.sin(s * 2.5) * 0.3;
            if (dist(pet.x, pet.y, bf.x, bf.y + 220) > 180) pet.moveTo(bf.x, clamp(bf.y + 220, 470, 680), 70); else pet.moving = false;
            yield;
          }
          pet.o = {};
          g.observe('curious');
        }
        pet.expr = 'focus';
        let t = 0;
        while (t < 6) {
          t += pet.dt;
          pet.lookAt = { x: bf.x, y: bf.y };
          const tx = bf.x, ty = Math.min(680, Math.max(470, bf.y + 220));
          const d = dist(pet.x, pet.y, tx, ty);
          if (d > 120) { pet.body = 'stand'; pet.moveTo(tx, ty, 200); }
          else { pet.moving = false; pet.body = 'crouch'; pet.o.tailWag = 1; pet.faceToward(tx); if (t > 2.5) break; }
          yield;
        }
        // pounce!
        pet.body = 'stand'; pet.expr = 'excited';
        pet.jump(420); pet.moveTo(bf.x, pet.y, 260); g.audio.boing();
        yield* wait(pet, 0.3);
        g.world.shooButterflies(pet.x, pet.y - 100);
        yield* wait(pet, 0.5);
        pet.lookAt = { x: bf.x, y: bf.y - 100 }; pet.expr = 'happy'; pet.body = 'sit';
        yield* wait(pet, 1.5);
        b.n.fun = clamp01(b.n.fun + 0.05);
      },
    },
    {
      id: 'dig', zone: 'garden', cd: 40, w: () => (g.world.digs.some((d) => d.ready) ? 0.6 : 0),
      run: function* () { const d = g.world.digs.find((d) => d.ready); if (d) yield* digAt(b, d.x, d.y, false); },
    },
    {
      id: 'flowers', zone: 'garden', cd: 40, w: (b) => 0.3 + b.tr.curious * 0.3,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('flowers');
        yield* approach(pet, x + rand(-150, 250), y + 10, 90, { x, y: y - 30 });
        pet.o.headDown = 0.2; pet.o.sniff = 1; pet.lookAt = { x: pet.x + pet.facing * 60, y: pet.y - 40 };
        pet.expr = 'bliss'; g.audio.sniff();
        yield* wait(pet, 1.5);
        pet.o = {};
        st.mark('sniffed');
        if (chance(0.45)) yield* sneeze(pet);
        else if (chance(0.4 + b.tr.curious * 0.2) && g.world.butterflies.length) {
          // butterfly lands on the nose!
          const [nx, ny] = pet.headPos();
          const bf = g.world.landButterflyOn(nx + 30 * pet.facing, ny - 50);
          if (bf) {
            pet.body = 'sit'; pet.expr = 'focus'; pet.lookAt = { x: bf.x, y: bf.y }; pet.o.pupil = 1.3; pet.o.lookX = 0;
            pet.lookCam = 0.6;
            yield* wait(pet, 2.5);
            pet.expr = 'joy'; g.audio.voice('giggle');
            g.world.shooButterflies(bf.x, bf.y);
            yield* wait(pet, 1);
            g.observe('butterfly');
          }
        }
      },
    },
    {
      id: 'puddle', zone: 'garden', cd: 25, w: (b) => (g.world.puddle > 0.3 ? 1.2 + b.tr.playful * 0.5 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('puddle');
        yield* approach(pet, x - 60, y, 200);
        pet.expr = 'joy';
        for (let i = 0; i < 4; i++) {
          pet.jump(260); pet.moveTo(x + (i % 2 ? -40 : 40), y, 120);
          yield* until(pet, () => pet.z > 0, 0.2);
          yield* until(pet, () => pet.z <= 0, 1);
          g.fx.drops(pet.x, pet.y - 10, 8, 200); g.audio.splash();
        }
        b.n.clean = clamp01(b.n.clean - 0.2); b.n.fun = clamp01(b.n.fun + 0.15);
        pet.o.wet = 0.6;
        yield* wait(pet, 0.5);
        pet.o.shake = 1; g.audio.shake(); g.fx.drops(pet.x, pet.y - 50, 12); yield* wait(pet, 0.6); pet.o.shake = 0; pet.o.wet = 0;
        g.observe('puddle');
      },
    },
    {
      id: 'tree', zone: 'garden', cd: 60, w: () => 0.3,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('tree');
        yield* approach(pet, x + rand(-80, 80), y + 30, 100, { x, y: 250 });
        pet.body = 'sit'; pet.lookAt = { x, y: 200 }; pet.expr = 'curious';
        yield* wait(pet, 2);
        if (chance(0.5)) {
          // a leaf lands on its head
          pet.o.headTilt = 0.1;
          g.pet.hatLeaf = 4;
          pet.expr = 'surprised'; pet.lookAt = { x: pet.x, y: pet.y - 300 };
          yield* wait(pet, 1.5);
          pet.o.shake = 1; g.audio.shake(); yield* wait(pet, 0.5); pet.o.shake = 0; g.pet.hatLeaf = 0;
          pet.expr = 'happy'; g.audio.voice('giggle');
          g.observe('leaf');
        }
        yield* wait(pet, 1.5);
      },
    },
    {
      id: 'sunnyNap', zone: 'garden', cd: 90, w: (b) => (g.world.isDay() ? 0.2 + (1 - b.n.energy) * 0.8 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('sunny');
        yield* approach(pet, x, y, 90);
        pet.body = 'belly'; pet.expr = 'bliss';
        let t = 0; while (t < 6) { t += pet.dt; b.purr = 0.3; yield; }
        pet.body = 'stand';
      },
    },
  ];
  return L;
}

/** Sits and watches you: little head tilts, ears swivelling, a wag when you move. */
function* watchYou(b: Brain, s: number): Gen {
  const pet = b.pet, g = b.g;
  pet.body = 'sit'; pet.expr = 'curious'; pet.lookCam = 1;
  let t = 0, nt = 0.8;
  while (t < s) {
    t += pet.dt;
    if (t > nt) { nt = t + rand(0.8, 1.6); pet.o.headTilt = chance(0.5) ? rand(-0.35, 0.35) : 0; }
    pet.o.tailWag = g.pointer.recent ? 0.9 : 0.3;
    yield;
  }
  pet.o = {}; pet.lookCam = 0;
}

/** Stretch & shake. After a real nap it also starts the short "just woke up" drowsy spell. */
export function* wakeUp(pet: Pet, fromSleep = true): Gen {
  if (fromSleep) pet.g.brain.st.mark('woke');
  pet.body = 'bow'; pet.expr = 'sleepy'; pet.o.eyeOpen = 0.1; pet.o.tailUp = 1;
  yield* wait(pet, 0.9);
  pet.o.mouthOpen = 0.95; pet.o.eyeOpen = 0; pet.g.audio.voice('yawn');
  yield* wait(pet, 0.8);
  pet.o = {}; pet.body = 'stand';
  pet.o.shake = 0.6; yield* wait(pet, 0.35); pet.o.shake = 0;
  pet.expr = fromSleep ? 'sleepy' : 'happy';
  yield* wait(pet, 0.4);
  pet.expr = null;
}

/** Dig something up, admire it proudly for a moment, then bring it to you. */
export function* digAt(b: Brain, x: number, y: number, minigame: boolean): Gen {
  const pet = b.pet, g = b.g;
  yield* walk(pet, x - 45, y + 4, 170);
  pet.face(1);
  pet.o.headDown = 0.8; pet.o.sniff = 1; pet.expr = 'focus'; g.audio.sniff();
  yield* wait(pet, 0.8);
  pet.o.sniff = 0; pet.body = 'bow'; pet.expr = 'excited';
  let t = 0, nt = 0;
  while (t < 1.8) {
    t += pet.dt;
    pet.o.paw = Math.abs(Math.sin(t * 16));
    if (t > nt) { nt = t + 0.18; g.fx.dirt(x, y, 2); g.audio.dig(); }
    yield;
  }
  pet.o = {}; pet.body = 'stand';
  const spot = g.world.digs.find((d) => Math.abs(d.x - x) < 5 && Math.abs(d.y - y) < 5);
  if (spot) spot.ready = false;
  g.world.digs = g.world.digs.filter((d) => d.ready);
  // find something
  const c = weighted(COLLECTIBLES.map((c) => ({ item: c, w: c.weight })))!;
  pet.held = 'c:' + c.id;
  pet.expr = 'starry'; pet.jump(200); g.audio.voice('excited');
  yield* wait(pet, 0.8);
  yield* admire(b);
  const [fx, fy] = g.frontPoint();
  pet.expr = 'happy';
  yield* walk(pet, fx, fy, 170);
  pet.lookCam = 1; pet.body = 'sit';
  yield* wait(pet, 0.3);
  pet.held = null;
  g.collect(c.id, pet.x + pet.facing * 30, pet.y - 30);
  b.st.mark('treasure', c.id);
  b.n.clean = clamp01(b.n.clean - 0.06);
  pet.expr = 'joy';
  yield* wait(pet, 1);
  void minigame;
}

/** Holding a treasure: a proud little strut, then a moment gazing at it. */
export function* admire(b: Brain): Gen {
  const pet = b.pet, g = b.g;
  pet.expr = 'happy'; pet.o.tailWag = 1.3; pet.o.tailUp = 1; pet.o.earPerk = 0.8;
  const bb = g.world.zoneBounds(g.zone);
  yield* walk(pet, clamp(pet.x + pet.facing * 90, bb.x0, bb.x1), pet.y, 120, 2); // strut
  pet.body = 'sit'; pet.o.headDown = 0.35; pet.expr = 'love';
  pet.lookAt = { x: pet.x + pet.facing * 40, y: pet.y - 40 };
  yield* wait(pet, 1.1);
  pet.o.headDown = 0; pet.lookAt = null; pet.lookCam = 1; pet.expr = 'starry'; // …and shows you
  yield* wait(pet, 0.7);
  pet.o = {}; pet.lookCam = 0; pet.body = 'stand';
}

