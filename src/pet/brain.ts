// PetBrain: needs → mood → utility-weighted behaviour choice. Behaviours are generator
// scripts, so they read like little animation storyboards.
import type { Game } from '../game';
import type { Pet, Gen, Expr } from './Pet';
import { decayNeeds } from '../state';
import { chance, clamp01, dist, pick, rand, randi, weighted } from '../util';
import { COLLECTIBLES, TRICKS } from '../data';
import type { Zone } from '../world/world';

export type Mood = 'content' | 'playful' | 'sleepy' | 'hungry' | 'curious' | 'affectionate' | 'excited' | 'bored' | 'grumpy' | 'mischievous';
const MOOD_EXPR: Record<Mood, Expr> = {
  content: 'neutral', playful: 'happy', sleepy: 'sleepy', hungry: 'hungry', curious: 'curious',
  affectionate: 'happy', excited: 'excited', bored: 'bored', grumpy: 'pout', mischievous: 'mischief',
};

// ---------- tiny generator helpers ----------
export function* wait(pet: Pet, s: number): Gen { let t = 0; while (t < s) { t += pet.dt; yield; } }
export function* walk(pet: Pet, x: number, y: number, speed = 110, timeout = 12): Gen {
  pet.moveTo(x, y, speed);
  let t = 0;
  while (pet.moving && t < timeout) { t += pet.dt; yield; }
  pet.moving = false;
}
export function* until(pet: Pet, cond: () => boolean, timeout = 10): Gen { let t = 0; while (!cond() && t < timeout) { t += pet.dt; yield; } }
function* lookAround(pet: Pet, s: number): Gen {
  let t = 0, nt = 0;
  while (t < s) {
    t += pet.dt;
    if (t > nt) { nt = t + rand(0.5, 1.3); pet.lookAt = { x: pet.x + rand(-300, 300), y: pet.y - rand(0, 250) }; }
    yield;
  }
  pet.lookAt = null;
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

  constructor(public g: Game) {
    this.behaviors = makeBehaviors(this);
  }
  get pet(): Pet { return this.g.pet; }
  get n() { return this.g.save.pet.needs; }
  get tr() { return this.g.save.pet.traits; }

  noteInteraction(excite = 0.1) {
    this.sinceInteract = 0;
    this.excitement = clamp01(this.excitement + excite);
  }

  moodExpr(): Expr { return this.pet.asleep ? 'asleep' : MOOD_EXPR[this.mood]; }

  update(dt: number) {
    const g = this.g, pet = this.pet;
    decayNeeds(this.n, this.tr, dt, pet.asleep);
    this.excitement = Math.max(0, this.excitement - dt * 0.06);
    this.grump = Math.max(0, this.grump - dt * 0.08);
    this.buzz = Math.max(0, this.buzz - dt * 0.02);
    this.sinceInteract += dt;
    this.mischief += dt * (0.002 + this.tr.playful * 0.004);
    if (this.mischief > 1) this.mischief = 0;
    if (g.zone !== this.lastZone) { this.lastZone = g.zone; this.zoneTime = 0; }
    this.zoneTime += dt;
    if (this.request && g.time - this.request.t > 60) this.request = null;
    this.mood = this.computeMood();
    // purr continues while content & being close
    g.audio.purr(this.purr);
    this.purr = Math.max(0, this.purr - dt * 1.5);

    if (pet.action || g.mode !== 'free') return;
    this.idle -= dt;
    if (this.idle > 0) return;
    this.choose();
  }

  computeMood(): Mood {
    const n = this.n, tr = this.tr;
    const night = this.g.world.isNight();
    const s: Record<Mood, number> = {
      content: 0.5,
      sleepy: (1 - n.energy) * 1.5 + (night ? 0.2 : 0) - this.excitement * 0.5,
      hungry: (1 - n.hunger) * 1.35 - 0.2,
      playful: (1 - n.fun) * 0.7 + tr.playful * 0.3 + n.energy * 0.15,
      affectionate: (1 - n.affection) * 0.8 + tr.cuddly * 0.3,
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
    this.idle = rand(0.4, 2.2) * (1.3 - this.tr.energy * 0.6);
  }

  makeRequest(kind: string) {
    this.request = { kind, t: this.g.time };
    this.pet.think(kind, 5);
  }

  /** Called by the game when the player satisfies something; returns true if it fulfilled a request. */
  fulfil(kind: string) {
    if (this.request && this.request.kind === kind) {
      this.request = null;
      this.g.addFriend('request', 6);
      this.g.fx.hearts(this.pet.x, this.pet.y - 150, 3);
      return true;
    }
    return false;
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

function makeBehaviors(b: Brain): Behavior[] {
  const g = b.g;
  const P = () => b.pet;
  const bounds = () => g.world.zoneBounds(g.zone);
  const front = () => g.frontPoint();
  const L: Behavior[] = [
    {
      id: 'wander', cd: 3, w: (b) => 0.7 + b.tr.energy * 0.3,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.randomPoint(g.zone);
        yield* walk(pet, x, y, 90 + b.tr.energy * 40);
        if (chance(0.5)) { pet.body = 'sit'; }
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
        if (chance(0.25)) { yield* sneeze(pet); }
        else if (chance(0.4)) { pet.emote('?'); pet.o.headTilt = 0.3; yield* wait(pet, 1); }
      },
    },
    {
      id: 'nap', cd: 40, w: (b) => Math.pow(1 - b.n.energy, 2) * 5 + (g.world.isNight() && b.n.energy < 0.8 ? 0.3 : 0) + (b.tr.energy < 0.3 ? 0.12 : 0),
      run: function* () {
        const pet = P();
        const inRoom = g.zone === 'room';
        const [x, y] = inRoom ? g.world.poi(g.world.isDay() && chance(0.3) ? 'sunbeam' : 'bed') : g.world.poi('sunny');
        pet.expr = 'sleepy';
        if (chance(0.6)) { pet.o.mouthOpen = 0.9; pet.o.eyeOpen = 0; g.audio.voice('yawn'); yield* wait(pet, 0.9); pet.o = {}; }
        yield* walk(pet, x, y, 70);
        // circle before lying down
        for (let i = 0; i < 2; i++) { pet.face(-pet.facing); yield* wait(pet, 0.35); }
        pet.body = 'lie';
        yield* wait(pet, 0.8);
        pet.asleep = true; pet.expr = null;
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
      id: 'drink', zone: 'room', cd: 70, w: () => 0.35,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('water');
        yield* walk(pet, x, y, 110);
        pet.face(1);
        if (g.save.room.water < 0.1) {
          pet.o.headDown = 0.8; pet.o.sniff = 1; yield* wait(pet, 0.8); pet.o = {};
          pet.body = 'sit'; pet.lookCam = 1; b.makeRequest('water'); g.audio.voice('question');
          yield* wait(pet, 4);
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
      id: 'eatBowl', zone: 'room', cd: 10, w: (b) => (g.save.room.bowl > 0.05 ? (1 - b.n.hunger) * 4 + 0.3 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('food');
        yield* walk(pet, x, y, 150);
        pet.face(1);
        yield* eatFrom(pet, 3);
        const eaten = Math.min(g.save.room.bowl, 0.5);
        g.save.room.bowl -= eaten;
        b.n.hunger = clamp01(b.n.hunger + eaten * 0.9);
        pet.o.tongue = 0.7; pet.expr = 'happy';
        yield* wait(pet, 0.8);
      },
    },
    {
      id: 'askFood', zone: 'room', cd: 50, w: (b) => (b.n.hunger < 0.4 && g.save.room.bowl < 0.05 ? (1 - b.n.hunger) * 2 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('food');
        yield* walk(pet, x, y, 120);
        pet.face(1); pet.o.headDown = 0.7; pet.o.sniff = 1;
        yield* wait(pet, 0.9);
        pet.o = {}; pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'hungry';
        b.makeRequest('kibble'); g.audio.voice('question');
        yield* wait(pet, 2.5);
        pet.o.paw = 0.6; yield* wait(pet, 0.4); pet.o.paw = 0; // taps the bowl
        yield* wait(pet, 2);
      },
    },
    {
      id: 'window', zone: 'room', cd: 45, w: (b) => (g.world.isDay() ? 0.3 : 0.15) + b.tr.curious * 0.5,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('window');
        yield* walk(pet, x + rand(-30, 30), y, 100);
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
      },
    },
    {
      id: 'sunbathe', zone: 'room', cd: 90, w: (b) => (g.world.isDay() ? 0.2 + (1 - b.n.energy) * 0.6 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('sunbeam');
        yield* walk(pet, x, y, 90);
        pet.body = 'lie'; pet.expr = 'bliss';
        yield* wait(pet, 2);
        pet.body = 'belly'; b.purr = 0.4;
        let t = 0; while (t < rand(5, 8)) { t += pet.dt; b.purr = 0.35; yield; }
        pet.body = 'lie'; yield* wait(pet, 1);
      },
    },
    {
      id: 'basket', zone: 'room', cd: 60, w: (b) => (1 - b.n.fun) * 1.2 + b.tr.playful * 0.4,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('basket');
        yield* walk(pet, x, y, 130);
        pet.face(pet.x < x ? 1 : -1);
        pet.o.headDown = 1; pet.expr = 'focus';
        for (let i = 0; i < 3; i++) { pet.squash(0.2); g.audio.sniff(); yield* wait(pet, 0.35); }
        pet.o.headDown = 0;
        const owned: string[] = g.save.inventory.toys.filter((t) => t === 'ball' || t === 'squeaky');
        const fav = g.save.memory.favToy;
        const toy = fav && owned.includes(fav) ? fav : pick(owned.length ? owned : ['ball']);
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
        g.memoryToy(toy);
      },
    },
    {
      id: 'chaseTail', cd: 150, w: (b) => (b.n.energy > 0.4 ? b.tr.playful * 0.25 + b.tr.energy * 0.15 : 0),
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
      id: 'zoomies', cd: 180, w: (b) => (b.n.energy > 0.6 ? b.tr.energy * 0.35 + b.excitement * 0.6 : 0),
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
      id: 'cuddleUp', cd: 35, w: (b) => (1 - b.n.affection) * 1.6 + b.tr.cuddly * 0.5 + (g.friendLevel >= 2 ? 0.2 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = front();
        yield* walk(pet, x + rand(-80, 80), y, 140);
        pet.body = g.friendLevel >= 3 && chance(0.3) ? 'lie' : 'sit';
        pet.lookCam = 1; pet.expr = 'happy'; pet.o.blush = 0.8;
        if (b.n.affection < 0.55) {
          if (g.friendLevel >= 3 && chance(0.5)) {
            pet.body = 'belly'; b.makeRequest('belly'); g.audio.voice('coo');
          } else { b.makeRequest('heart'); g.audio.voice('coo'); }
        }
        yield* wait(pet, rand(4, 7));
      },
    },
    {
      id: 'groom', cd: 60, w: () => 0.25,
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
      id: 'stretch', cd: 50, w: () => 0.2,
      run: function* () { yield* wakeUp(P()); },
    },
    {
      id: 'rug', zone: 'room', cd: 90, w: (b) => 0.2 + b.tr.playful * 0.2,
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('rug');
        yield* walk(pet, x + rand(-60, 60), y, 110);
        pet.body = 'lie'; yield* wait(pet, 0.5);
        pet.body = 'belly'; pet.expr = 'joy'; g.audio.voice('giggle');
        let t = 0; while (t < 2.5) { t += pet.dt; pet.o.tilt = Math.sin(t * 8) * 0.15; yield; }
        pet.o.tilt = 0; pet.body = 'lie'; yield* wait(pet, 0.6); pet.body = 'stand';
      },
    },
    {
      id: 'investigate', cd: 25, w: (b) => b.tr.curious * 0.6 + b.buzz * 2,
      run: function* () {
        const pet = P();
        const spots = g.zone === 'room' ? ['plant', 'basket', 'bed', 'window', 'door', 'water'] : ['tree', 'flowers', 'decor', 'fence'];
        const [x, y] = g.world.poi(pick(spots));
        yield* walk(pet, x + rand(-40, 40), y + 20, 100);
        pet.expr = 'curious'; pet.o.headTilt = rand(0.2, 0.4) * (chance(0.5) ? 1 : -1);
        pet.lookAt = { x, y: y - 60 };
        yield* wait(pet, 1);
        if (b.tr.brave < 0.35 && chance(0.5)) {
          // cautious hop back, then braver approach
          pet.expr = 'surprised'; pet.jump(180); pet.moveTo(pet.x - pet.facing * 40, pet.y, 120); g.audio.voice('surprise');
          yield* wait(pet, 0.8);
          pet.expr = 'curious';
          yield* walk(pet, x, y + 20, 50);
        }
        pet.o.headDown = 0.6; pet.o.sniff = 1; g.audio.sniff();
        yield* wait(pet, 1.2);
        pet.o = {};
        if (chance(0.5)) pet.emote('?'); else { pet.emote('note'); pet.expr = 'happy'; }
        g.observe('curious');
        yield* wait(pet, 1);
      },
    },
    {
      id: 'askPlay', cd: 70, w: (b) => (b.n.fun < 0.45 && b.n.energy > 0.35 ? (1 - b.n.fun) * 1.3 * (0.5 + b.tr.playful) : 0),
      run: function* () {
        const pet = P();
        const [x, y] = front();
        yield* walk(pet, x, y - 20, 160);
        pet.lookCam = 1; pet.body = 'bow'; pet.expr = 'excited';
        const toy = g.save.memory.favToy ?? 'ball';
        b.makeRequest(g.save.inventory.toys.includes(toy) ? toy : 'ball');
        g.audio.voice('excited');
        for (let i = 0; i < 3; i++) { yield* wait(pet, 0.6); pet.jump(140); }
        pet.body = 'sit';
        yield* wait(pet, 2);
      },
    },
    {
      id: 'askOutside', zone: 'room', cd: 150, w: (b) => (g.friendLevel >= 1 && b.zoneTime > 150 ? 0.3 + b.tr.energy * 0.3 : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('door');
        yield* walk(pet, x - 40, y, 140);
        pet.face(1);
        pet.o.paw = 0.8; yield* wait(pet, 0.3); pet.o.paw = 0; yield* wait(pet, 0.3); pet.o.paw = 0.8; yield* wait(pet, 0.3); pet.o.paw = 0;
        pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'hungry';
        b.makeRequest('outside'); g.audio.voice('question');
        yield* wait(pet, 5);
      },
    },
    {
      id: 'bringToy', cd: 150, zone: 'room', w: (b) => (g.friendLevel >= 2 && !g.toys.active ? 0.3 * (0.5 + b.tr.playful) : 0),
      run: function* () {
        const pet = P();
        const [x, y] = g.world.poi('basket');
        yield* walk(pet, x, y, 150);
        pet.o.headDown = 1; yield* wait(pet, 0.7); pet.o.headDown = 0;
        const owned: string[] = g.save.inventory.toys.filter((t) => t === 'ball' || t === 'squeaky');
        const fav = g.save.memory.favToy;
        const toy = fav && owned.includes(fav) ? fav : owned[0] ?? 'ball';
        pet.held = toy; pet.expr = 'happy';
        const [fx, fy] = front();
        yield* walk(pet, fx, fy, 170);
        pet.lookCam = 1; pet.face(fx - pet.x || 1);
        yield* wait(pet, 0.3);
        pet.held = null;
        g.toys.dropFromPet(toy, pet.x + pet.facing * 45, pet.y + 8, true);
        pet.body = 'bow'; pet.expr = 'excited'; g.audio.voice('excited');
        yield* wait(pet, 1.5);
        pet.body = 'sit';
        yield* wait(pet, 1.5);
      },
    },
    {
      id: 'showTrick', cd: 80, w: (b) => {
        const learned = TRICKS.filter((t) => g.save.memory.tricks[t.id]?.learned).length;
        return learned ? 0.12 + b.excitement * 0.8 + (b.mood === 'playful' ? 0.15 : 0) : 0;
      },
      run: function* () {
        const pet = P();
        const learned = TRICKS.filter((t) => g.save.memory.tricks[t.id]?.learned).map((t) => t.id);
        const tr = pick(learned);
        const [x, y] = front();
        yield* walk(pet, x + rand(-60, 60), y, 150);
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
    // ---------- surprises (rare) ----------
    { id: 'sneeze', cd: 200, w: () => 0.06, run: function* () { yield* sneeze(P()); } },
    {
      id: 'hiccups', cd: 400, w: () => 0.05,
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
      id: 'lookBehind', cd: 220, w: () => 0.06,
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
      id: 'dozeOff', cd: 300, w: (b) => (b.n.energy < 0.6 ? 0.1 : 0.03),
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
      id: 'sing', cd: 240, w: (b) => (b.mood === 'content' || b.mood === 'playful' ? 0.08 : 0.02),
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
      id: 'butterfly', zone: 'garden', cd: 20, w: (b) => 0.5 + b.tr.playful * 0.5 + b.tr.curious * 0.2,
      run: function* () {
        const pet = P();
        const bf = g.world.nearestButterfly(pet.x, pet.y);
        if (!bf) return;
        pet.expr = 'focus'; pet.emote('!');
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
        yield* walk(pet, x + rand(-150, 250), y + 10, 90);
        pet.o.headDown = 0.2; pet.o.sniff = 1; pet.lookAt = { x: pet.x + pet.facing * 60, y: pet.y - 40 };
        pet.expr = 'bliss'; g.audio.sniff();
        yield* wait(pet, 1.5);
        pet.o = {};
        if (chance(0.45)) yield* sneeze(pet);
        else if (chance(0.4) && g.world.butterflies.length) {
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
        yield* walk(pet, x - 60, y, 200);
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
        yield* walk(pet, x + rand(-80, 80), y + 30, 100);
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
        yield* walk(pet, x, y, 90);
        pet.body = 'belly'; pet.expr = 'bliss';
        let t = 0; while (t < 6) { t += pet.dt; b.purr = 0.3; yield; }
        pet.body = 'stand';
      },
    },
  ];
  return L;
}

export function* wakeUp(pet: Pet): Gen {
  pet.body = 'bow'; pet.expr = 'sleepy'; pet.o.eyeOpen = 0.1; pet.o.tailUp = 1;
  yield* wait(pet, 0.9);
  pet.o.mouthOpen = 0.95; pet.o.eyeOpen = 0; pet.g.audio.voice('yawn');
  yield* wait(pet, 0.8);
  pet.o = {}; pet.body = 'stand';
  pet.o.shake = 0.6; yield* wait(pet, 0.35); pet.o.shake = 0;
  pet.expr = 'happy';
  yield* wait(pet, 0.4);
}

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
  const [fx, fy] = g.frontPoint();
  pet.expr = 'happy';
  yield* walk(pet, fx, fy, 170);
  pet.lookCam = 1; pet.body = 'sit';
  yield* wait(pet, 0.3);
  pet.held = null;
  g.collect(c.id, pet.x + pet.facing * 30, pet.y - 30);
  b.n.clean = clamp01(b.n.clean - 0.06);
  pet.expr = 'joy';
  yield* wait(pet, 1);
}
