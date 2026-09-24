// Toys: throwable ball & squeaky donut, feather wand, bubble wand — plus the pet's play logic.
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait, walk } from './pet/brain';
import { drawIcon } from './art';
import { chance, clamp, clamp01, dist, ellipse, rand, Spring } from './util';
import { FLOOR_TOP } from './world/world';

interface Throwable { kind: 'ball' | 'squeaky'; x: number; y: number; z: number; vx: number; vy: number; vz: number; grabbed: boolean; carried: boolean; squash: number; rest: number; }
interface Bubble { x: number; y: number; vx: number; vy: number; r: number; life: number; t: number; gold: boolean; on: boolean; }

export class Toys {
  active: 'ball' | 'squeaky' | 'wand' | 'bubbles' | null = null;
  thr: Throwable | null = null;
  wand = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, caught: 0, idle: 0, sx: new Spring(60, 9), sy: new Spring(60, 9) };
  bubbles: Bubble[] = Array.from({ length: 40 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0, t: 0, gold: false, on: false }));
  private drag: { id: number; lx: number; ly: number; lt: number; vx: number; vy: number; moved: number } | null = null;
  petTaps = 0;
  throws = 0;
  onBubblePop: ((byPet: boolean, gold: boolean) => void) | null = null;
  private lastBlow = { x: 0, y: 0 };

  constructor(public g: Game) {}

  spawn(id: 'ball' | 'squeaky' | 'wand' | 'bubbles') {
    this.clear();
    this.active = id;
    const g = this.g;
    const [fx, fy] = g.frontPoint();
    if (id === 'ball' || id === 'squeaky') {
      this.thr = { kind: id, x: fx + (g.pet.x > fx ? -90 : 90), y: fy - 10, z: 160, vx: 0, vy: 0, vz: 0, grabbed: false, carried: false, squash: 0, rest: 0 };
    } else if (id === 'wand') {
      this.wand.x = this.wand.tx = fx + 120; this.wand.y = this.wand.ty = fy - 200;
    }
    g.pet.run(this.playLoop(), 'toy', 2);
    this.reactToToy(id);
  }

  dropFromPet(kind: string, x: number, y: number, invite = false) {
    if (this.active || (kind !== 'ball' && kind !== 'squeaky')) return;
    this.active = kind as 'ball' | 'squeaky';
    this.thr = { kind: kind as 'ball' | 'squeaky', x, y, z: 30, vx: 0, vy: 0, vz: 60, grabbed: false, carried: false, squash: 0, rest: 0 };
    this.g.ui.refresh();
    if (invite) this.g.hint('toyInvite', 'Your pet brought you a toy! Flick it to throw!');
  }

  /** One-button play for keyboard / limited motor control. */
  quickAction() {
    const g = this.g;
    g.audio.unlock();
    if (this.thr && !this.thr.carried && !this.thr.grabbed) {
      const b = g.world.zoneBounds(g.zone), t = this.thr;
      const tx = rand(b.x0 + 60, b.x1 - 60), ty = rand(b.y0, b.y1);
      t.vx = (tx - t.x) / 0.9; t.vy = (ty - t.y) / 0.9; t.vz = 500; t.z = Math.max(t.z, 5);
      if (t.kind === 'squeaky') { t.squash = 1; g.audio.squeak(); }
      this.onThrow();
    } else if (this.active === 'wand') {
      const p = g.pet;
      this.wand.tx = p.x + rand(-220, 220); this.wand.ty = p.y - rand(40, 200); this.wand.idle = 0;
    } else if (this.active === 'bubbles') {
      const [hx, hy] = g.pet.headPos();
      this.blow(hx + rand(-150, 150), hy - rand(20, 120), 4);
    }
  }

  clear() {
    if (this.active && this.g.pet.actionName === 'toy') this.g.pet.stop();
    if (this.thr?.carried) this.g.pet.held = null;
    this.active = null; this.thr = null; this.drag = null;
    for (const b of this.bubbles) b.on = false;
  }

  private reactToToy(id: string) {
    const g = this.g, pet = g.pet;
    const liking = g.save.memory.toys[id]?.liking ?? 0.4;
    if (g.save.memory.favToy === id) { pet.expr = 'starry'; pet.jump(260); g.audio.voice('excited'); pet.emote('heart'); }
    else if (liking > 0.55) { pet.expr = 'excited'; pet.jump(180); g.audio.voice('happy'); }
    else if (!g.save.memory.toys[id]) { pet.expr = 'curious'; pet.emote('?'); g.audio.voice('question'); g.brain.buzz += 0.3; }
    else { pet.expr = 'happy'; }
  }

  // ---------- input ----------
  onDown(wx: number, wy: number, id: number): boolean {
    if (!this.active) return false;
    const g = this.g;
    if (this.thr && !this.thr.carried) {
      const t = this.thr;
      const s = g.world.depthScale(t.y);
      if (dist(wx, wy, t.x, t.y - t.z - 18 * s) < 60) {
        if (t.kind === 'squeaky') { t.squash = 1; g.audio.squeak(); this.onSqueak(); }
        t.grabbed = true;
        this.drag = { id, lx: wx, ly: wy, lt: performance.now(), vx: 0, vy: 0, moved: 0 };
        return true;
      }
      // tap elsewhere → throw toward that point (accessible throw)
      if (!g.pet.hitZone(wx, wy)) {
        if (t.z < 1 || t.rest > 0.2) {
          const ty = clamp(wy, FLOOR_TOP + 30, 680);
          const dx = wx - t.x, dy = ty - t.y;
          const T = 0.9;
          t.vx = dx / T; t.vy = dy / T; t.vz = 500; t.z = Math.max(t.z, 5);
          this.onThrow();
          return true;
        }
      }
      return false;
    }
    if (this.active === 'wand') {
      this.wand.tx = wx; this.wand.ty = wy; this.wand.idle = 0;
      this.drag = { id, lx: wx, ly: wy, lt: performance.now(), vx: 0, vy: 0, moved: 0 };
      return true;
    }
    if (this.active === 'bubbles') {
      // pop a bubble?
      for (const b of this.bubbles) if (b.on && dist(wx, wy, b.x, b.y) < b.r + 18) { this.pop(b, false); return true; }
      this.blow(wx, wy, 3);
      this.lastBlow = { x: wx, y: wy };
      this.drag = { id, lx: wx, ly: wy, lt: performance.now(), vx: 0, vy: 0, moved: 0 };
      return true;
    }
    return false;
  }

  onMove(wx: number, wy: number, id: number) {
    const d = this.drag;
    if (!d || d.id !== id) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lt) / 1000;
    d.vx = d.vx * 0.5 + ((wx - d.lx) / dt) * 0.5;
    d.vy = d.vy * 0.5 + ((wy - d.ly) / dt) * 0.5;
    d.moved += Math.hypot(wx - d.lx, wy - d.ly);
    d.lx = wx; d.ly = wy; d.lt = now;
    if (this.thr?.grabbed) {
      const t = this.thr;
      t.x = wx; t.z = Math.max(0, t.y - wy); t.vx = t.vy = t.vz = 0;
    } else if (this.active === 'wand') {
      this.wand.tx = wx; this.wand.ty = wy; this.wand.idle = 0;
    } else if (this.active === 'bubbles') {
      if (dist(wx, wy, this.lastBlow.x, this.lastBlow.y) > 45) { this.blow(wx, wy, 1); this.lastBlow = { x: wx, y: wy }; }
    }
  }

  onUp(id: number) {
    const d = this.drag;
    if (!d || d.id !== id) return;
    this.drag = null;
    if (this.thr?.grabbed) {
      const t = this.thr;
      t.grabbed = false;
      const age = performance.now() - d.lt;
      const flick = age < 80 && Math.hypot(d.vx, d.vy) > 250;
      if (flick) {
        t.vx = clamp(d.vx * 0.9, -1100, 1100);
        t.vz = clamp(-d.vy * 0.6, 150, 700);
        t.vy = clamp(-d.vy * 0.25, -260, 60);
        this.onThrow();
      } else if (d.moved < 10) {
        // tap on the toy: small toss up
        t.vz = 320; t.vx = rand(-120, 120);
        if (t.kind === 'ball') this.onThrow();
      }
    }
  }

  private onThrow() {
    const g = this.g;
    this.throws++;
    g.audio.whoosh();
    g.brain.noteInteraction(0.15);
    g.observe('throw');
    if (g.pet.actionName !== 'toy') g.pet.run(this.playLoop(), 'toy', 2);
  }

  private squeaks = 0;
  private onSqueak() {
    this.squeaks++;
    this.g.brain.noteInteraction(0.08);
  }

  private blow(x: number, y: number, n: number) {
    this.g.audio.pop();
    for (let i = 0; i < n; i++) this.addBubble(x + rand(-20, 20), y + rand(-20, 20), rand(-40, 40), rand(-60, -20), false);
  }

  addBubble(x: number, y: number, vx: number, vy: number, gold: boolean): Bubble | null {
    const b = this.bubbles.find((q) => !q.on);
    if (!b) return null;
    b.on = true; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.r = rand(14, 26); b.life = rand(6, 10); b.t = rand(0, 6); b.gold = gold;
    return b;
  }

  pop(b: Bubble, byPet: boolean) {
    b.on = false;
    this.g.audio.pop();
    this.g.fx.sparkles(b.x, b.y, b.gold ? 8 : 3, b.r);
    this.onBubblePop?.(byPet, b.gold);
    if (byPet) this.g.bump('bubblesPopped');
  }

  // ---------- update ----------
  update(dt: number) {
    const g = this.g;
    const t = this.thr;
    if (t && !t.grabbed && !t.carried) {
      t.vz -= 1100 * dt;
      t.z += t.vz * dt;
      t.x += t.vx * dt; t.y += t.vy * dt;
      if (t.z <= 0) {
        t.z = 0;
        if (t.vz < -120) {
          t.vz = -t.vz * (t.kind === 'ball' ? 0.55 : 0.35); t.squash = 0.6;
          if (t.kind === 'ball') g.audio.boing(); else g.audio.squeak();
        } else t.vz = 0;
        const fr = Math.exp(-2.8 * dt);
        t.vx *= fr; t.vy *= fr;
      }
      const b = g.world.zoneBounds(g.zone);
      if (t.x < b.x0 - 30) { t.x = b.x0 - 30; t.vx = Math.abs(t.vx) * 0.6; }
      if (t.x > b.x1 + 30) { t.x = b.x1 + 30; t.vx = -Math.abs(t.vx) * 0.6; }
      if (t.y < b.y0) { t.y = b.y0; t.vy = Math.abs(t.vy) * 0.5; }
      if (t.y > b.y1 + 10) { t.y = b.y1 + 10; t.vy = -Math.abs(t.vy) * 0.5; }
      const moving = Math.hypot(t.vx, t.vy) > 8 || t.z > 1;
      t.rest = moving ? 0 : t.rest + dt;
    }
    if (t) t.squash = Math.max(0, t.squash - dt * 4);
    if (this.active === 'wand') {
      const w = this.wand;
      w.idle += dt;
      let tx = w.tx, ty = w.ty;
      if (w.idle > 2.5) { tx += Math.sin(g.time * 1.3) * 60; ty += Math.sin(g.time * 2.1) * 30; }
      const px = w.x, py = w.y;
      w.x = w.x + w.sx.update(tx - w.x, dt) * dt * 8;
      w.y = w.y + w.sy.update(ty - w.y, dt) * dt * 8;
      w.vx = (w.x - px) / dt; w.vy = (w.y - py) / dt;
      w.caught = Math.max(0, w.caught - dt);
    }
    for (const b of this.bubbles) {
      if (!b.on) continue;
      b.t += dt; b.life -= dt;
      b.x += (b.vx + Math.sin(b.t * 2) * 25) * dt; b.y += b.vy * dt;
      b.vx *= 0.99; b.vy = b.vy * 0.99 - 3 * dt;
      if (b.life <= 0 || b.y < -250) { b.on = false; if (b.life <= 0) g.fx.sparkles(b.x, b.y, 2, b.r); }
    }
  }

  // ---------- the pet's play loop (runs as the pet's action while a toy is out) ----------
  *playLoop(): Gen {
    const g = this.g, pet = g.pet;
    while (this.active) {
      if (this.active === 'ball' || this.active === 'squeaky') yield* this.fetchStep();
      else if (this.active === 'wand') yield* this.wandStep();
      else if (this.active === 'bubbles') yield* this.bubbleStep();
      yield;
    }
    pet.o = {};
  }

  private *fetchStep(): Gen {
    const g = this.g, pet = g.pet, t = this.thr!;
    const tr = g.save.pet.traits;
    pet.o = {};
    // watch the toy while it's in the player's hand / at rest near player
    if (t.grabbed || (t.rest > 0.4 && dist(pet.x, pet.y, t.x, t.y) < 150)) {
      pet.moving = false;
      pet.lookAt = { x: t.x, y: t.y - t.z };
      pet.body = t.grabbed ? 'crouch' : 'sit';
      pet.expr = 'focus';
      pet.o.tailWag = 0.8;
      if (t.kind === 'squeaky' && this.squeaks >= 1 && !t.grabbed) {
        // head tilt at the squeak, then pounce
        this.squeaks = 0;
        pet.o.headTilt = 0.4; pet.expr = 'curious'; pet.emote('?'); yield* wait(pet, 0.5);
        pet.o.headTilt = -0.4; yield* wait(pet, 0.5);
        pet.o.headTilt = 0;
        if (chance(0.6)) yield* this.pounceSqueaky();
      }
      yield;
      return;
    }
    if (t.rest > 3 && dist(pet.x, pet.y, t.x, t.y) > 150) {
      // lost interest while it lies still far away? go get it anyway if playful
      if (!chance(0.5 + tr.playful * 0.5)) { pet.body = 'sit'; pet.lookAt = { x: t.x, y: t.y }; yield* wait(pet, 1); return; }
    }
    // anticipation crouch then chase
    pet.lookAt = { x: t.x, y: t.y - t.z };
    pet.body = 'crouch'; pet.expr = 'focus';
    yield* wait(pet, 0.35 - tr.energy * 0.2 + (tr.brave < 0.3 ? 0.2 : 0));
    pet.body = 'stand'; pet.expr = 'excited';
    let time = 0;
    while (this.active && !t.carried && time < 8) {
      time += pet.dt;
      if (t.grabbed) return;
      pet.lookAt = { x: t.x, y: t.y - t.z };
      pet.moveTo(t.x - pet.facing * 30, t.y + 4, 300);
      if (dist(pet.x, pet.y, t.x, t.y) < 55 && t.z < 40) {
        t.carried = true; pet.held = t.kind; pet.squash(0.3);
        if (t.kind === 'squeaky') g.audio.squeak(); else g.audio.thud();
        break;
      }
      if (t.z > 80 && dist(pet.x, pet.y, t.x, t.y) < 80 && pet.z === 0) pet.jump(380);
      yield;
    }
    if (!t.carried) return;
    const pr = g.memoryToy(t.kind);
    g.addFriend('fetch', 2);
    const n = g.save.pet.needs;
    n.fun = clamp01(n.fun + 0.07); n.energy = clamp01(n.energy - 0.015);
    // how does it bring it back?
    const r = Math.random();
    const mischief = tr.playful * 0.25 + (g.brain.mood === 'mischievous' ? 0.35 : 0);
    const [fx, fy] = g.frontPoint();
    if (r < mischief) {
      yield* this.keepAway();
    } else if (r < mischief + 0.12 + tr.curious * 0.1 - g.friendLevel * 0.02) {
      // gets distracted halfway
      yield* walk(pet, (pet.x + fx) / 2, (pet.y + fy) / 2, 150);
      pet.o.headDown = 0.8; pet.o.sniff = 1; pet.expr = 'curious';
      this.release(pet.x + pet.facing * 40, pet.y);
      g.audio.sniff();
      yield* wait(pet, 1.2);
      pet.o = {}; pet.emote('?');
      yield* wait(pet, 0.5);
    } else if (r < mischief + 0.3 && tr.energy > 0.55) {
      // victory lap!
      pet.expr = 'joy';
      const b = g.world.zoneBounds(g.zone);
      for (let i = 0; i < 2; i++) yield* walk(pet, rand(b.x0, b.x1), rand(b.y0, b.y1), 320, 3);
      yield* walk(pet, fx, fy - 10, 220);
      this.release(pet.x + pet.facing * 40, pet.y + 6);
      yield* this.proud();
    } else {
      yield* walk(pet, fx + (pet.x > fx ? 40 : -40), fy - 10, 220);
      pet.face(fx - pet.x || 1);
      this.release(pet.x + pet.facing * 45, pet.y + 8);
      yield* this.proud();
    }
    if (pr.newFavorite) g.discoverToy(t.kind);
  }

  private release(x: number, y: number) {
    const t = this.thr;
    if (!t) return;
    t.carried = false; this.g.pet.held = null;
    t.x = x; t.y = y; t.z = 20; t.vz = 50; t.vx = 0; t.vy = 0; t.rest = 0;
  }

  private *proud(): Gen {
    const pet = this.g.pet;
    pet.lookCam = 1; pet.body = 'bow'; pet.expr = 'excited'; pet.o.tailWag = 1;
    this.g.audio.voice('happy');
    yield* wait(pet, 0.9);
    pet.body = 'sit'; pet.expr = 'happy';
    yield* wait(pet, 0.3);
    pet.lookCam = 0;
  }

  private *keepAway(): Gen {
    const g = this.g, pet = g.pet;
    const [fx, fy] = g.frontPoint();
    yield* walk(pet, fx + rand(-150, 150), fy - 40, 200);
    pet.lookCam = 1; pet.body = 'bow'; pet.expr = 'mischief'; pet.o.tailWag = 1;
    g.hint('keepaway', 'Tap your pet to chase it!');
    this.petTaps = 0;
    let dodges = 0, t = 0;
    while (dodges < 3 && t < 7) {
      t += pet.dt;
      if (this.petTaps > 0) {
        this.petTaps = 0; dodges++;
        pet.body = 'stand'; pet.expr = 'joy'; g.audio.voice('giggle');
        const b = g.world.zoneBounds(g.zone);
        yield* walk(pet, clamp(pet.x + rand(-250, 250), b.x0, b.x1), clamp(pet.y + rand(-60, 60), b.y0, b.y1), 300, 2);
        pet.lookCam = 1; pet.body = 'bow'; pet.expr = 'mischief';
        t = 0;
      }
      yield;
    }
    pet.expr = 'happy'; pet.body = 'stand';
    this.release(pet.x + pet.facing * 45, pet.y + 8);
    g.observe('keepaway');
    yield* this.proud();
  }

  private *pounceSqueaky(): Gen {
    const g = this.g, pet = g.pet, t = this.thr!;
    pet.body = 'crouch'; pet.expr = 'focus';
    yield* wait(pet, 0.5);
    pet.body = 'stand'; pet.jump(300); pet.moveTo(t.x - pet.facing * 20, t.y, 260);
    yield* wait(pet, 0.45);
    // chomp chomp
    pet.o.headDown = 0.8; pet.expr = 'joy';
    for (let i = 0; i < 4; i++) { t.squash = 1; g.audio.squeak(); pet.squash(0.15); yield* wait(pet, 0.22); }
    pet.o = {};
    g.memoryToy('squeaky');
    g.addFriend('squeak', 1.5);
    g.save.pet.needs.fun = clamp01(g.save.pet.needs.fun + 0.05);
  }

  private *wandStep(): Gen {
    const g = this.g, pet = g.pet, w = this.wand;
    const tr = g.save.pet.traits;
    pet.lookAt = { x: w.x, y: w.y };
    const reachY = pet.y - 230;
    const dx = w.x - pet.x;
    const d = Math.abs(dx);
    const speed = Math.hypot(w.vx, w.vy);
    if (w.caught > 0) { yield; return; }
    if (w.y < reachY - 60) {
      // too high: sit and stare, maybe reach up
      pet.moving = false; pet.body = 'sit'; pet.expr = 'focus'; pet.faceToward(w.x);
      if (d < 120 && chance(pet.dt * 1.2)) { pet.o.paw = 1; yield* wait(pet, 0.3); pet.o.paw = 0; }
      if (d > 200) pet.moveTo(w.x - Math.sign(dx) * 120, pet.y, 150);
      yield; return;
    }
    if (d > 260) { pet.body = 'stand'; pet.expr = 'excited'; pet.moveTo(w.x - Math.sign(dx) * 150, clamp(w.y + 150, FLOOR_TOP + 30, 680), 230); yield; return; }
    // stalk
    pet.moving = false; pet.faceToward(w.x);
    pet.body = 'crouch'; pet.expr = 'focus'; pet.o.tailWag = 1.2;
    let t = 0;
    const need = 0.6 + (1 - tr.brave) * 0.8 + rand(0, 0.6);
    while (t < need) {
      t += pet.dt;
      pet.lookAt = { x: w.x, y: w.y };
      pet.o.tilt = Math.sin(t * 25) * 0.04; // butt wiggle
      if (this.active !== 'wand' || w.y < reachY - 60 || Math.abs(w.x - pet.x) > 300) { pet.o = {}; return; }
      yield;
    }
    pet.o = {};
    // POUNCE
    pet.body = 'stand'; pet.expr = 'excited';
    pet.jump(300 + Math.min(200, (pet.y - w.y) * 0.8));
    pet.moveTo(w.x - pet.facing * 20, clamp(w.y + 170, FLOOR_TOP + 30, 680), 340);
    g.audio.boing();
    yield* wait(pet, 0.45);
    const [hx, hy] = pet.headPos();
    if (dist(hx, hy, w.x, w.y) < 110 && speed < 900) {
      w.caught = 1.4;
      pet.body = 'lie'; pet.expr = 'joy';
      w.tx = hx + pet.facing * 40; w.ty = pet.y - 40;
      g.audio.voice('giggle'); g.fx.sparkles(w.x, w.y, 4, 20);
      for (let i = 0; i < 5; i++) { pet.o.paw = i % 2; yield* wait(pet, 0.15); }
      pet.o = {};
      g.memoryToy('wand');
      g.addFriend('wand', 2);
      g.save.pet.needs.fun = clamp01(g.save.pet.needs.fun + 0.08);
      g.save.pet.needs.energy = clamp01(g.save.pet.needs.energy - 0.015);
      yield* wait(pet, 0.5);
      pet.body = 'stand';
    } else {
      pet.expr = 'surprised';
      yield* wait(pet, 0.4);
      pet.lookCam = 0.5; pet.expr = 'happy';
      yield* wait(pet, 0.3); pet.lookCam = 0;
    }
  }

  private *bubbleStep(): Gen {
    const g = this.g, pet = g.pet;
    let best: Bubble | null = null, bd = 1e9;
    for (const b of this.bubbles) {
      if (!b.on || b.y < pet.y - 330) continue;
      const d = Math.abs(b.x - pet.x) + Math.abs(b.y - (pet.y - 150)) * 0.5;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) {
      pet.moving = false; pet.body = 'sit'; pet.expr = 'happy';
      const any = this.bubbles.find((b) => b.on);
      if (any) { pet.lookAt = { x: any.x, y: any.y }; pet.o.headTilt = 0.2; } else { pet.lookCam = 0.6; }
      yield* wait(pet, 0.3);
      pet.lookCam = 0; pet.o = {};
      return;
    }
    const b = best;
    pet.body = 'stand'; pet.expr = 'excited';
    pet.lookAt = { x: b.x, y: b.y };
    pet.moveTo(b.x - pet.facing * 25, clamp(b.y + 160, FLOOR_TOP + 30, 680), 260);
    const [hx, hy] = pet.headPos();
    const vd = hy - b.y;
    if (Math.abs(hx - b.x) < 70 && vd > 30 && vd < 200 && pet.z === 0) pet.jump(260 + vd * 2);
    if (dist(hx, hy - 20, b.x, b.y) < b.r + 45) {
      this.pop(b, true);
      pet.expr = 'joy'; pet.squash(0.2);
      g.save.pet.needs.fun = clamp01(g.save.pet.needs.fun + 0.02);
      g.addFriend('bubbles', 0.8);
      if (chance(0.3)) g.audio.voice('giggle');
      g.memoryToyThrottled('bubbles');
    }
    yield;
  }

  // ---------- draw ----------
  draw(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const t = this.thr;
    if (t && !t.carried) {
      const s = g.world.depthScale(t.y);
      ctx.fillStyle = 'rgba(60,40,30,0.18)';
      ellipse(ctx, t.x, t.y + 2, 18 * s / (1 + t.z / 200), 5 * s / (1 + t.z / 200)); ctx.fill();
      ctx.save();
      ctx.translate(t.x, t.y - t.z - 16 * s);
      ctx.scale(s * (1 + t.squash * 0.25), s * (1 - t.squash * 0.25));
      ctx.rotate(t.x * 0.02);
      drawIcon(ctx, t.kind, 38);
      ctx.restore();
      if (t.grabbed) { ctx.save(); ctx.translate(t.x + 18, t.y - t.z + 4); ctx.globalAlpha = 0.9; drawIcon(ctx, 'hand', 40); ctx.restore(); }
    }
    if (this.active === 'wand') {
      const w = this.wand;
      const ax = w.x + 60, ay = w.y - 380;
      ctx.strokeStyle = '#a0764f'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax + 80, ay - 60); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.strokeStyle = 'rgba(90,70,80,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + w.x) / 2 - w.vx * 0.05, (ay + w.y) / 2 + 60, w.x, w.y); ctx.stroke();
      ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(clamp(w.vx * 0.002, -0.8, 0.8) + Math.sin(g.time * 3) * 0.1);
      for (const [c, a, r] of [['#ff7fb8', 0, 1], ['#7fd3ff', 0.5, 0.85], ['#ffe066', -0.5, 0.8]] as [string, number, number][]) {
        ctx.save(); ctx.rotate(a); ellipse(ctx, 0, 22 * r, 8, 24 * r); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = '#4a3340'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 44 * r); ctx.stroke(); ctx.restore();
      }
      ellipse(ctx, 0, 0, 6, 6); ctx.fillStyle = '#ff5c8a'; ctx.fill();
      ctx.restore();
    }
    for (const b of this.bubbles) {
      if (!b.on) continue;
      const wob = Math.sin(b.t * 5) * 0.06;
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(1 + wob, 1 - wob);
      const a = Math.min(1, b.life);
      ctx.globalAlpha = a;
      ellipse(ctx, 0, 0, b.r, b.r);
      ctx.fillStyle = b.gold ? 'rgba(255,220,100,0.35)' : 'rgba(200,235,255,0.25)'; ctx.fill();
      ctx.strokeStyle = b.gold ? 'rgba(230,170,40,0.9)' : `hsla(${(b.t * 60) % 360},80%,70%,0.8)`; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ellipse(ctx, -b.r * 0.35, -b.r * 0.4, b.r * 0.22, b.r * 0.14, -0.6); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
