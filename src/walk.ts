// Walkies: a short outing to the park with your own pet.
//
// One side-scrolling park path (procedural art, drawn live) with 4–6 stops and one fork where the
// player picks a path. At each stop the PET notices something first (eyes → head → body), then
// reacts in its own way: personality, habits, favourite spots and friendship all change what
// happens. A little story is collected along the way and written into the Memory Book.
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait, walk, sneeze, admire } from './pet/brain';
import { drawPet, newRig } from './pet/render';
import { drawIcon } from './art';
import { COLLECTIBLES, KEEPSAKES } from './data';
import { chance, clamp, clamp01, ellipse, rand, weighted, pick } from './util';
import { CACHE_Y0, CACHE_Y1, FLOOR_TOP, FLOOR_BOT } from './world/world';
import { WalkKind, PathTheme, PATHS, pickKinds, pickChoice, petPrefers, recordStop, SPOT_TEXT } from './walkmem';
import { addJournal } from './memory';

export const PARK0 = 3000;
const PATH_Y = 592;
const GAP = 1000;

export type WalkPhase = 'out' | 'travel' | 'event' | 'wait' | 'choice' | 'home';
interface Stop { kind: WalkKind; x: number; y: number; theme: PathTheme | null; state: number; t: number; big?: boolean; }
interface Deco { kind: 'tree' | 'rock' | 'grass' | 'lamp'; x: number; y: number; s: number; }
interface Leaf { x: number; y: number; z: number; vx: number; vz: number; rot: number; vr: number; col: string; rest: number; }
interface Fly { x: number; y: number; tx: number; ty: number; t: number; col: string; glow: boolean; gone: boolean; land: { x: number; y: number } | null; }
const PLACE: Record<WalkKind, string> = {
  flowers: 'the flowers', puddle: 'the puddle', leaves: 'the leaf pile', butterfly: 'the butterflies', bush: 'the bush',
  bench: 'the bench', sound: 'the old tree', dig: 'the digging spot', stick: 'the stick spot', picnic: 'the picnic',
};
const LEAF_COLS = ['#f08a3c', '#f2b640', '#d9562b', '#e8a23a', '#b8742e'];

export class Walk {
  active = false;
  phase: WalkPhase = 'out';
  stops: Stop[] = [];
  idx = 0;
  choice: [PathTheme, PathTheme] | null = null;
  chosen: PathTheme | null = null;
  prefer: 0 | 1 = 0;
  forkX = 0;
  deco: Deco[] = [];
  leaves: Leaf[] = [];
  flies: Fly[] = [];
  squirrel: { x: number; y: number; vx: number; vy: number; t: number; up: boolean } | null = null;
  owl = 0;
  /** The walk's little story: phrases with how memorable they were (-1 = not scored yet). */
  story: { s: string; w: number }[] = [];
  found: string[] = [];
  carry: string | null = null;
  muddy = false;
  tip = '';
  goOn = false;
  homeNow = false;
  allowTouch = false;
  /** Where the walk is being shown: the park, or back in the room for the homecoming. */
  scene: 'park' | 'home' = 'park';
  private flow: Generator<void, void, void> | null = null;
  private fade = 0;
  /** Seconds since the Home button was pressed (the flow must get going home promptly). */
  private homeT = 0;
  /** Seconds the flow has been waiting on something the pet is doing that isn't part of the walk. */
  private foreignT = 0;
  /** Travel legs in a row where the pet didn't get anywhere. */
  private stuckLegs = 0;
  private pokesThisLeg = 0;
  private finished = false;
  private walkT = 0;
  private poke: { x: number; y: number; kind: string } | null = null;
  private pokeFinds = 0;
  private throwAt: number | null = null;
  private throwReady = false;
  private joyV = 0;
  private surprised = false;
  private tiredDone = false;
  private sfxT = 2;
  private night = false;
  private eve = false;
  private scratchRig = newRig();
  private camLead = 60;
  private focus: { x: number; y: number } | null = null;

  constructor(public g: Game) {}

  get name() { return this.g.save.pet.name; }
  get tr() { return this.g.save.pet.traits; }
  get mem() { return this.g.save.memory.walk; }
  get endX() { const l = this.stops[this.stops.length - 1]; return l ? l.x + 520 : PARK0 + 2600; }
  bounds() { return { x0: PARK0 + 20, x1: this.endX + 200, y0: FLOOR_TOP + 60, y1: FLOOR_BOT - 18 }; }
  private cur() { return this.stops[this.idx]; }

  canStart() { return this.g.friendLevel >= 1; }
  get hasFlow() { return !!this.flow; }
  get fadeLevel() { return this.fade; }
  clearFade() { this.fade = 0; }

  // ---------- lifecycle ----------
  start() {
    const g = this.g;
    if (this.active || !this.canStart()) return;
    if (g.mode === 'closeup') g.closeup.close();
    if (g.mode !== 'free') return;
    g.ui.closeTray();
    g.toys.clear();
    g.input.cancelAll('walk start');
    g.brain.fulfil('walk');
    const w = this.mem, tr = this.tr;
    this.night = g.world.isNight(); this.eve = g.world.isEvening();
    this.active = true; this.phase = 'out'; this.idx = 0;
    this.story = []; this.found = []; this.carry = null; this.muddy = false; this.tip = '';
    this.goOn = false; this.homeNow = false; this.allowTouch = false; this.poke = null; this.pokeFinds = 0;
    this.leaves = []; this.flies = []; this.squirrel = null; this.owl = 0; this.focus = null;
    this.surprised = false; this.tiredDone = false; this.throwReady = false; this.throwAt = null;
    this.choice = null; this.chosen = null;
    this.scene = 'park'; this.fade = 0; this.homeT = 0; this.foreignT = 0; this.stuckLegs = 0; this.pokesThisLeg = 0; this.finished = false; this.walkT = 0;
    // plan: two stops, a fork (the player picks a path), then two or three more
    const first = pickKinds(2, tr, w, this.night, [], Math.random);
    this.stops = first.map((k, i) => this.mkStop(k, i, null));
    this.forkX = this.stops[1].x + GAP * 0.55;
    this.camLead = 30 + (1 - tr.cuddly) * 110; // independent pets wander further ahead of you
    this.buildDeco();
    g.mode = 'walk';
    g.pet.hatLeaf = 0; g.pet.nosePetal = 0; g.pet.heldScale = 1;
    this.flow = this.flowGen();
    g.diag.log('walk', 'start');
    g.ui.refresh();
  }

  private mkStop(kind: WalkKind, i: number, theme: PathTheme | null): Stop {
    const extra = i >= 2 ? GAP * 0.6 : 0;
    const x = PARK0 + 620 + i * GAP + extra;
    const y = { flowers: 528, puddle: 606, leaves: 600, butterfly: 530, bush: 532, bench: 520, sound: 596, dig: 612, stick: 604, picnic: 536 }[kind];
    return { kind, x, y, theme, state: 0, t: 0, big: kind === 'stick' && chance(0.07 + (this.mem.sticks >= 5 ? 0.12 : 0)) };
  }

  private buildDeco() {
    this.deco = [];
    const end = this.stops[1].x + GAP * 6;
    let x = PARK0 - 100;
    while (x < end) {
      x += rand(150, 260);
      this.deco.push({ kind: 'tree', x, y: 478 + rand(-6, 10), s: rand(0.8, 1.2) });
    }
    for (let i = 0; i < 40; i++) {
      const rx = PARK0 + rand(0, end - PARK0);
      if (this.stops.some((s) => Math.abs(s.x - rx) < 120)) continue;
      const r = Math.random();
      this.deco.push({ kind: r < 0.3 ? 'rock' : 'grass', x: rx, y: chance(0.5) ? rand(505, 540) : rand(640, 675), s: rand(0.8, 1.2) });
    }
    for (let lx = PARK0 + 300; lx < end; lx += 900) this.deco.push({ kind: 'lamp', x: lx + rand(-60, 60), y: 520, s: 1 });
    this.deco.sort((a, b) => a.y - b.y);
  }

  /** Called every frame by the game (also while the homecoming plays in the room). */
  update(dt: number) {
    if (!this.active) return;
    const g = this.g;
    this.walkT += dt;
    if (this.flow) {
      let r: IteratorResult<void, void>;
      try { r = this.flow.next(); } catch (e) { g.diag.error('walk flow', e); this.abort('error in the walk'); return; }
      if (r.done) { this.flow = null; this.active = false; if (g.mode === 'walk') this.abort('walk ended without finishing'); }
    }
    if (!this.active) return;
    // safety nets (legitimate walks never trip these)
    if (this.homeNow && this.phase !== 'home') { this.homeT += dt; if (this.homeT > 10) { g.diag.watchdog('Home pressed but the walk did not head home'); this.abort('home stalled'); return; } }
    if (this.walkT > 20 * 60) { g.diag.watchdog('walk ran for 20 minutes'); this.abort('too long'); return; }
    // particles & critters
    for (const l of this.leaves) {
      if (l.z > 0 || l.vz > 0) { l.vz -= 420 * dt; l.z += l.vz * dt; l.x += l.vx * dt + Math.sin(l.rot * 2) * 20 * dt; l.rot += l.vr * dt; if (l.z <= 0) { l.z = 0; l.vz = 0; l.vx = 0; } }
      else l.rest += dt;
    }
    if (this.leaves.length > 80) this.leaves.splice(0, this.leaves.length - 80);
    for (const f of this.flies) {
      f.t += dt;
      if (f.land) { f.x += (f.land.x - f.x) * Math.min(1, dt * 3); f.y += (f.land.y - f.y) * Math.min(1, dt * 3); continue; }
      if (Math.hypot(f.tx - f.x, f.ty - f.y) < 12 || chance(dt * 0.5)) { f.tx = f.x + rand(-120, 120); f.ty = clamp(f.y + rand(-80, 60), f.gone ? -300 : 330, 540); }
      if (f.gone) { f.ty = -400; }
      const sp = f.gone ? 160 : 70;
      const a = Math.atan2(f.ty - f.y, f.tx - f.x);
      f.x += Math.cos(a) * sp * dt; f.y += Math.sin(a) * sp * dt + Math.sin(f.t * 9) * 25 * dt;
    }
    this.flies = this.flies.filter((f) => f.y > -350);
    const sq = this.squirrel;
    if (sq) { sq.t += dt; sq.x += sq.vx * dt; sq.y += sq.vy * dt; if (sq.t > 4) this.squirrel = null; }
    this.owl = Math.max(0, this.owl - dt);
    for (const s of this.stops) s.t = Math.max(0, s.t - dt);
    // ambience
    if (g.mode === 'walk' && this.scene === 'park') {
      this.sfxT -= dt;
      if (this.sfxT <= 0) {
        this.sfxT = rand(2.5, 6);
        if (this.night) g.audio.cricket(); else if (chance(0.75)) g.audio.chirp(); else g.audio.breeze();
      }
    }
  }

  /** Camera x while walking: the pet walks a little ahead of "you"; at a stop, frame pet + thing. */
  camX() {
    const g = this.g, pet = g.pet;
    // on narrow screens keep the pet comfortably in view, leaning toward what it's looking at
    const halfW = g.W / 2 / g.S;
    if (this.focus) return pet.x + clamp((this.focus.x - pet.x) / 2, -(halfW - 120), halfW - 120);
    const ahead = this.phase === 'travel' ? this.camLead : 20;
    const b = this.bounds();
    return clamp(pet.x - ahead * pet.facing, b.x0 + 150, b.x1);
  }

  // ---------- input ----------
  onDown(wx: number, wy: number): boolean {
    const g = this.g, pet = g.pet;
    if (this.phase === 'out' || this.phase === 'home' || this.homeNow) { if (pet.hitZone(wx, wy, 1.15)) pet.emote('heart', 1); return true; }
    if (this.throwReady) { this.throwAt = wx; return true; }
    if (pet.hitZone(wx, wy, 1.15)) {
      if (this.phase === 'wait' || this.allowTouch) return false; // normal petting & taps
      pet.emote('heart', 1); g.audio.voice('coo'); // mid-adventure: a quick happy look, no interruption
      return true;
    }
    // tapped something interesting?
    const st = this.cur();
    if (st && Math.abs(wx - st.x) < 110 && Math.abs(wy - (st.y - 30)) < 110 && (this.phase === 'travel' || this.phase === 'wait')) {
      this.poke = { x: st.x, y: st.y, kind: 'stop' };
      if (this.phase === 'wait') this.goOn = true;
      return true;
    }
    for (const d of this.deco) {
      if (d.kind === 'lamp') continue;
      const hy = d.kind === 'tree' ? d.y - 120 : d.y - 12, r = d.kind === 'tree' ? 90 : 45;
      if (Math.abs(wx - d.x) < r && Math.abs(wy - hy) < r * 1.3 && Math.abs(d.x - pet.x) < 600) {
        if (this.phase === 'travel' || this.phase === 'wait') this.poke = { x: d.x, y: d.y, kind: d.kind };
        g.audio.click();
        return true;
      }
    }
    // tap ahead of the pet to keep walking
    if (this.phase === 'wait' && wx > pet.x + 40) { this.goOn = true; return true; }
    return true;
  }

  /** "Keep walking" button / auto-continue. */
  next() { if (this.phase === 'wait') this.goOn = true; }
  pick(i: 0 | 1) { if (this.phase === 'choice' && this.choice && !this.chosen) { this.chosen = this.choice[i]; this.g.audio.click(); } }
  /** The Home button: always works, from any phase. */
  goHomeNow() {
    if (!this.active || this.homeNow) return;
    this.homeNow = true; this.goOn = true; this.homeT = 0;
    this.throwReady = false; this.allowTouch = false; this.tip = '';
    if (this.phase === 'choice' && this.choice && !this.chosen) this.chosen = this.choice[0];
    this.g.diag.log('walk', `Home pressed (${this.phase})`);
    this.g.ui.refresh();
  }

  // ---------- flow ----------
  private *flowGen(): Generator<void, void, void> {
    if (!(yield* this.leaveHome())) return;
    for (let i = 0; i < this.stops.length; i++) {
      if (this.homeNow) break;
      this.idx = i;
      this.setPhase('travel');
      yield* this.doPet(this.travel(this.stops[i]));
      if (this.homeNow) break;
      this.setPhase('event');
      this.joyV = 0.5;
      yield* this.doPet(this.event(this.stops[i]));
      this.allowTouch = false; this.throwReady = false;
      this.focus = null;
      if (this.homeNow) break;
      const st = this.stops[i];
      for (const e of this.story) if (e.w < 0) e.w = this.joyV + (this.found.length ? 0.1 : 0);
      if (recordStop(this.mem, st.kind, this.joyV)) {
        this.g.discover('walk', `${this.name} seems to LOVE ${SPOT_TEXT[st.kind]}!`, 10);
      }
      if (this.homeNow || (i === this.stops.length - 1 && this.chosen)) break;
      yield* this.waitForGo(st);
      // after the first two stops the path forks: the player picks where to go next
      if (i === 1 && !this.chosen && !this.homeNow) yield* this.fork();
    }
    yield* this.goHome();
  }

  private setPhase(p: WalkPhase) {
    if (p !== this.phase) this.g.diag.log('walk', `phase ${p} (stop ${this.idx + 1}/${this.stops.length})`);
    this.phase = p; this.tip = ''; this.allowTouch = false; this.pokesThisLeg = 0;
    this.g.ui.refresh();
  }

  /**
   * Run a pet script and wait for it. If petting or a tap interrupts it, let that finish and carry
   * on. Pressing Home abandons the script (except on the way home). Anything else holding on to
   * the pet for a long time is stopped, so the walk can never wait forever.
   */
  private *doPet(gen: Gen, pri = 3): Generator<void, void, void> {
    const pet = this.g.pet;
    pet.run(gen, 'walk', pri);
    const a = pet.action;
    this.foreignT = 0;
    while (true) {
      if (this.homeNow && this.phase !== 'home') return;
      if (a && pet.action === a) { yield; continue; }
      if (pet.action && pet.actionName !== 'walk') {
        this.foreignT += pet.dt;
        if (this.foreignT > 20) { this.g.diag.watchdog(`walk waited 20s on "${pet.actionName}"`); pet.stop(); this.foreignT = 0; }
        yield; continue;
      }
      return;
    }
  }

  private *fadeTo(v: number, s = 0.45): Generator<void, void, void> {
    const reduced = this.g.settings.reducedMotion;
    const from = this.fade;
    let t = 0; const dur = reduced ? 0.2 : s;
    while (t < dur) { t += this.g.pet.dt; this.fade = from + (v - from) * clamp01(t / dur); yield; }
    this.fade = v;
  }

  private snapCam() { const g = this.g; g.cam.x = g.camT.x = this.camX(); g.cam.y = g.camT.y = g.freeCamY(); g.cam.zoom = g.camT.zoom = 1; }

  private *leaveHome(): Generator<void, boolean, void> {
    const g = this.g, pet = g.pet, b = g.brain;
    const knows = b.habit('walkies') > 0.3 || this.mem.walks >= 3;
    const self = this;
    // in the garden: off to the gate (a pet that knows walks gets very excited)
    yield* this.doPet((function* (): Gen {
      pet.expr = 'excited'; pet.o.tailWag = 1.5; pet.o.earPerk = 1;
      if (knows) { pet.emote('!'); g.audio.voice('excited'); pet.jump(260); yield* wait(pet, 0.5); }
      if (g.zone === 'garden' && g.world.zoneOf(pet.x) === 'garden') {
        yield* walk(pet, 1940, 520, knows ? 300 : 200, 6);
        pet.face(1); pet.lookAt = { x: 1985, y: 380 };
        if (knows) { yield* wait(pet, 0.2); pet.face(-1); yield* wait(pet, 0.17); pet.face(1); pet.jump(200); g.audio.voice('excited'); }
        else { pet.expr = 'curious'; pet.o.headTilt = 0.3; yield* wait(pet, 0.7); }
      } else yield* wait(pet, 0.4);
      void self;
    })(), 3);
    if (this.homeNow) { this.callOff(); return false; } // Home before we even left: never mind!
    yield* this.fadeTo(1);
    pet.stop(); pet.o = {}; pet.lookAt = null; pet.held = null;
    pet.x = PARK0 + 70; pet.y = PATH_Y; pet.z = 0; pet.face(1); pet.body = 'stand';
    this.snapCam();
    this.setPhase('travel');
    yield* this.fadeTo(0);
    // arriving: a big sniff of the fresh air, looking all around
    yield* this.doPet((function* (): Gen {
      pet.lookAt = { x: pet.x + 250, y: 300 }; pet.o.sniff = 1; pet.o.earPerk = 1; g.audio.sniff();
      yield* wait(pet, 0.6);
      pet.lookAt = { x: pet.x - 200, y: 380 }; yield* wait(pet, 0.45);
      pet.o = {}; pet.lookAt = null; pet.lookCam = 1;
      pet.expr = self.mem.walks === 0 ? 'starry' : 'happy'; g.audio.voice('happy'); pet.o.tailWag = 1.2;
      yield* wait(pet, 0.7);
      pet.lookCam = 0; pet.o = {};
    })());
    return true;
  }

  // ---------- travelling between stops ----------
  private *travel(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr, self = this;
    const fav = this.mem.fav === st.kind;
    const foodie = st.kind === 'picnic' && tr.appetite > 0.65;
    const noticeAt = st.x - (foodie ? 430 : fav ? 330 : 190 + tr.curious * 90);
    const speed = (90 + tr.energy * 90) * (tr.cuddly < 0.35 ? 1.15 : 1);
    pet.body = 'stand'; pet.expr = null; pet.o = {};
    while (pet.x < noticeAt - 6) {
      if (this.homeNow) return;
      if (this.poke) {
        // it happily checks out what you point at (but not forever: the walk goes on)
        if (++this.pokesThisLeg <= 4) { yield* this.pokeGen(); continue; }
        this.poke = null;
      }
      const seg = Math.min(noticeAt, pet.x + rand(150, 260));
      const x0 = pet.x;
      yield* walk(pet, seg, PATH_Y + rand(-22, 22), speed, 8);
      // safety net: the pet should always make progress along the path
      if (pet.x - x0 < 8) {
        if (++this.stuckLegs >= 3) { g.diag.watchdog('pet could not move along the path'); pet.carried = false; pet.x = Math.min(noticeAt, pet.x + 220); this.stuckLegs = 0; }
      } else this.stuckLegs = 0;
      if (pet.x >= noticeAt - 6) break;
      // little personality flourishes along the way
      if (!this.surprised && chance(0.16)) { this.surprised = true; yield* this.surprise(); continue; }
      if (!this.tiredDone && g.save.pet.needs.energy < 0.28) { this.tiredDone = true; yield* this.tooTired(); continue; }
      const r = Math.random();
      if (tr.cuddly > 0.55 && r < 0.3 + g.friendLevel * 0.04) {
        // checks on you: a look back over the shoulder, a wag, then on
        pet.moving = false; pet.lookCam = 1; pet.o.tailWag = 1.2; yield* wait(pet, 0.7); pet.lookCam = 0; pet.o = {};
      } else if (tr.energy > 0.65 && r < 0.3) {
        pet.jump(230); pet.expr = 'joy'; yield* walk(pet, Math.min(noticeAt, pet.x + 120), pet.y, speed * 1.8, 2); pet.expr = null;
      } else if (tr.energy < 0.35 && r < 0.3) {
        pet.moving = false; pet.body = 'sit'; pet.expr = 'bliss'; pet.lookAt = { x: pet.x + 200, y: 250 }; // enjoys the view
        yield* wait(pet, rand(1.2, 2)); pet.body = 'stand'; pet.expr = null; pet.lookAt = null;
      } else if (tr.cuddly < 0.35 && r < 0.3) {
        yield* walk(pet, Math.min(noticeAt, pet.x + 140), pet.y, speed * 1.4, 2); // a bit further ahead…
        pet.moving = false; pet.lookCam = 0.8; yield* wait(pet, 0.4); pet.lookCam = 0; // "coming?"
      } else if (tr.curious > 0.55 && r < 0.3) {
        pet.moving = false; pet.o.headDown = 0.8; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.8); pet.o = {};
      }
    }
    pet.moving = false;
    void self;
  }

  /** The player pointed at something: the pet looks, and (if curious enough) goes to check. */
  private *pokeGen(): Gen {
    const g = this.g, pet = g.pet, p = this.poke!, tr = this.tr;
    this.poke = null;
    if (p.kind === 'stop') return; // it's coming up anyway: travel continues straight there
    pet.moving = false;
    pet.lookAt = { x: p.x, y: p.kind === 'tree' ? p.y - 200 : p.y - 20 }; pet.o.earPerk = 1;
    yield* wait(pet, 0.35);
    if (tr.curious > 0.45 || chance(0.5)) {
      yield* walk(pet, p.x - 50 * Math.sign(p.x - pet.x || 1), clamp(p.y + 30, 520, 670), 140, 4);
      pet.faceToward(p.x);
      if (p.kind === 'tree') { pet.body = 'sit'; pet.expr = 'curious'; pet.lookAt = { x: p.x, y: p.y - 220 }; yield* wait(pet, 1.2); if (!this.night && chance(0.3)) { this.squirrelRun(p.x, p.y - 60, true); pet.emote('!'); yield* wait(pet, 1); } }
      else {
        pet.o.headDown = 0.8; pet.o.sniff = 1; pet.expr = 'curious'; g.audio.sniff(); yield* wait(pet, 1);
        pet.o = {};
        if (p.kind === 'rock' && this.pokeFinds === 0 && chance(0.35)) { this.pokeFinds++; yield* this.findThing('smoothstone', 'found a Smooth Stone by a rock you pointed at'); }
        else if (chance(0.25)) yield* sneeze(pet);
        else { pet.o.headTilt = 0.3; pet.emote('?'); yield* wait(pet, 0.6); }
      }
    } else { pet.o.headTilt = 0.25; yield* wait(pet, 0.6); }
    pet.o = {}; pet.lookAt = null; pet.body = 'stand'; pet.expr = null;
  }

  /** A rare surprise on the way (at most one per walk). */
  private *surprise(): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const r = Math.random();
    if (!this.night && r < 0.4) {
      // a squirrel darts across the path
      this.squirrelRun(pet.x + 320, PATH_Y + 40, false);
      pet.moving = false; pet.expr = 'surprised'; pet.o.earPerk = 1; pet.emote('!');
      let t = 0; while (t < 1.2) { t += pet.dt; const s = this.squirrel; if (s) pet.lookAt = { x: s.x, y: s.y - 20 }; yield; }
      if (tr.energy > 0.55 && tr.brave > 0.4) {
        pet.expr = 'excited'; g.audio.voice('excited'); yield* walk(pet, pet.x + 180, PATH_Y + 40, 330, 2);
        pet.body = 'sit'; pet.expr = 'happy'; pet.lookCam = 1; yield* wait(pet, 0.8);
        this.say('gave chase to a squirrel (it won)', 0.6);
      } else {
        pet.body = 'sit'; pet.expr = 'focus'; pet.o.tailWag = 1.2; yield* wait(pet, 1);
        this.say('spotted a squirrel', 0.6);
      }
    } else if (!this.night && r < 0.75) {
      // a leaf drifts down and lands right on its head
      const leaf: Leaf = { x: pet.x + 10, y: pet.y, z: 260, vx: 0, vz: -10, rot: 0, vr: 3, col: pick(LEAF_COLS), rest: 0 };
      this.leaves.push(leaf);
      pet.moving = false; pet.lookAt = { x: pet.x, y: pet.y - 320 }; pet.expr = 'curious';
      yield* until(pet, () => leaf.z < 150, 3);
      leaf.z = -999; // gone: it's on the pet now
      pet.hatLeaf = 1; pet.leafCol = leaf.col; pet.expr = 'surprised'; pet.squash(0.2);
      yield* wait(pet, 0.9);
      if (tr.playful > 0.5 || chance(0.5)) { pet.expr = 'happy'; pet.lookCam = 1; yield* wait(pet, 1); this.say('wore a leaf hat for a while', 0.6); }
      else { pet.o.shake = 1; g.audio.shake(); yield* wait(pet, 0.5); pet.o.shake = 0; pet.hatLeaf = 0; this.say('got bonked by a falling leaf', 0.6); }
      pet.lookCam = 0; pet.lookAt = null; pet.expr = null;
    } else {
      // too excited to walk normally: a tiny zoomie loop
      if (tr.energy > 0.5) {
        pet.body = 'bow'; pet.expr = 'mischief'; yield* wait(pet, 0.4); pet.body = 'stand'; pet.expr = 'excited';
        for (let i = 0; i < 3; i++) yield* walk(pet, pet.x + (i % 2 ? -140 : 180), clamp(PATH_Y + rand(-50, 60), 530, 670), 360, 2);
        this.say('did a happy little zoomie', 0.6);
      } else {
        pet.moving = false; pet.body = 'sit'; pet.expr = 'love'; pet.lookCam = 1; g.audio.voice('coo'); yield* wait(pet, 1.4);
        this.say('stopped just to look at you', 0.6);
      }
      pet.lookCam = 0; pet.expr = null; pet.body = 'stand';
    }
  }

  /** Low on energy: a dramatic sit-down. It gets up again when you encourage it (or after a bit). */
  private *tooTired(): Gen {
    const g = this.g, pet = g.pet;
    pet.moving = false; pet.body = 'sit'; pet.expr = 'sleepy'; g.audio.voice('sleepy');
    yield* wait(pet, 0.8);
    pet.body = 'lie'; pet.o.headDown = 0.4; pet.lookCam = 1; // "carry me?"
    this.tip = `${this.name} is pooped! Give a pat to cheer them on.`; g.ui.refresh();
    this.allowTouch = true;
    let t = 0; while (t < 5) { t += pet.dt; yield; }
    this.allowTouch = false; this.tip = ''; g.ui.refresh();
    pet.o = {}; pet.body = 'stand'; pet.expr = 'happy'; pet.lookCam = 0;
    this.say('sat down dramatically because it was all too much', 0.6);
  }

  // ---------- stops ----------
  /** First the pet notices; then it goes over in its own way. Returns when it has arrived. */
  private *meet(st: Stop, tx: number, ty: number): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const fav = this.mem.fav === st.kind;
    const unfamiliar = (this.mem.visits[st.kind] ?? 0) < 2;
    this.focus = { x: st.x, y: st.y };
    pet.moving = false;
    pet.lookAt = { x: st.x, y: st.y - 40 };          // eyes…
    pet.o.earPerk = 1;
    yield* wait(pet, 0.3);
    pet.o.headTilt = 0.22;                          // …head…
    if (fav) { pet.emote('heart'); pet.expr = 'starry'; pet.o.tailWag = 1.6; g.audio.voice('excited'); }
    else pet.emote(tr.brave > 0.55 ? '!' : '?');
    yield* wait(pet, 0.35);
    pet.o.headTilt = undefined;
    const hesitant = !fav && ((tr.brave < 0.4 && (unfamiliar || chance(0.35))) || (tr.curious < 0.35 && unfamiliar && chance(0.5)));
    if (hesitant) {
      // cautious: stop, look back at you, creep closer, a hop back… then brave enough
      pet.lookCam = 1; pet.expr = 'curious'; yield* wait(pet, 0.8); pet.lookCam = 0;
      pet.o.crouch = 0.6;
      yield* walk(pet, (pet.x + tx) / 2, ty, 55, 4);
      pet.o.crouch = undefined; pet.expr = 'surprised'; pet.jump(170); pet.moveTo(pet.x - 50, pet.y, 130); g.audio.voice('surprise');
      yield* wait(pet, 0.6);
      pet.expr = 'curious'; pet.lookCam = 0.8; yield* wait(pet, 0.4); pet.lookCam = 0;
      yield* walk(pet, tx, ty, 70, 5);
    } else {
      const sp = fav ? 300 : tr.brave > 0.6 || tr.curious > 0.7 ? 200 : 130;
      yield* walk(pet, tx, ty, sp, 5);                 // …then the body
    }
    pet.faceToward(st.x);
    pet.o = {}; pet.expr = null;
  }

  private say(s: string, w = -1) { this.story.push({ s, w }); }
  private joy(v: number) { this.joyV = v; }

  private *findThing(id: string, phrase: string): Gen {
    const g = this.g, pet = g.pet;
    pet.held = 'c:' + id; pet.heldScale = 1;
    pet.expr = 'starry'; pet.jump(180); g.audio.voice('excited');
    yield* wait(pet, 0.7);
    pet.lookCam = 1; pet.body = 'sit'; pet.expr = 'happy';
    yield* wait(pet, 0.6);
    pet.held = this.carry;
    g.collect(id, pet.x + pet.facing * 40, pet.y - 60);
    this.found.push(id);
    this.say(phrase);
    pet.lookCam = 0;
  }

  /** A random keepsake (rare ones are rare). */
  private keepsake(pool?: string[]) {
    const list = KEEPSAKES.filter((k) => k.weight > 0 && (!pool || pool.includes(k.id)));
    return weighted(list.map((k) => ({ item: k, w: k.weight })))!;
  }

  private *event(st: Stop): Gen {
    switch (st.kind) {
      case 'flowers': yield* this.evFlowers(st); break;
      case 'puddle': yield* this.evPuddle(st); break;
      case 'leaves': yield* this.evLeaves(st); break;
      case 'butterfly': yield* this.evButterfly(st); break;
      case 'bush': yield* this.evBush(st); break;
      case 'bench': yield* this.evBench(st); break;
      case 'sound': yield* this.evSound(st); break;
      case 'dig': yield* this.evDig(st); break;
      case 'stick': yield* this.evStick(st); break;
      case 'picnic': yield* this.evPicnic(st); break;
    }
    const pet = this.g.pet;
    pet.o = {}; pet.lookAt = null; pet.expr = null;
    if (this.carry) { pet.held = this.carry; }
    yield* this.afterglow(st);
  }

  /** A little beat after each stop, in the pet's own style, so the moment can sink in. */
  private *afterglow(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const r = Math.random();
    if (tr.cuddly > 0.55 && r < 0.6) {
      pet.lookCam = 1; pet.body = 'sit'; pet.expr = this.joyV > 1 ? 'love' : 'happy'; pet.o.tailWag = 1.2;
      if (g.friendLevel >= 2 && chance(0.4)) { g.fx.hearts(...pet.headPos()); g.audio.voice('coo'); }
      yield* wait(pet, 1.6);
    } else if (tr.curious > 0.6 && r < 0.6) {
      pet.o.headDown = 0.7; pet.o.sniff = 1; g.audio.sniff();
      yield* walk(pet, pet.x + rand(-40, 40), clamp(pet.y + rand(-20, 20), 540, 660), 60, 2);
      pet.o = {}; pet.lookAt = { x: st.x, y: st.y - 30 }; pet.o.headTilt = 0.25; yield* wait(pet, 0.8);
    } else if (tr.energy > 0.65 && r < 0.6) {
      pet.expr = 'joy'; pet.jump(230); g.audio.voice('happy'); yield* wait(pet, 0.5); pet.jump(200); yield* wait(pet, 0.7);
    } else if (tr.energy < 0.4 && r < 0.6) {
      pet.body = 'sit'; pet.expr = 'bliss'; pet.lookAt = { x: pet.x + 250, y: 300 }; yield* wait(pet, 2);
    } else {
      pet.lookCam = 1; pet.expr = 'happy'; yield* wait(pet, 1);
    }
    pet.o = {}; pet.lookAt = null; pet.lookCam = 0; pet.expr = null;
    if (this.carry) pet.held = this.carry;
  }

  private *evFlowers(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    yield* this.meet(st, st.x - 70, st.y + 38);
    pet.o.headDown = 0.3; pet.o.sniff = 1; pet.expr = 'bliss'; pet.lookAt = { x: st.x, y: st.y - 20 }; g.audio.sniff();
    yield* wait(pet, 1.3 + tr.curious * 0.8);
    pet.o = {};
    const r = Math.random();
    if (r < 0.28 + tr.curious * 0.1) { yield* sneeze(pet); this.say('sniffed the flowers — ACHOO!'); this.joy(0.7); }
    else if (r < 0.55) {
      const f = this.spawnFly(st.x + 10, st.y - 30);
      pet.expr = 'focus'; pet.emote('!');
      let t = 0; while (t < 1.8) { t += pet.dt; pet.lookAt = { x: f.x, y: f.y }; yield; }
      if (!this.night && (tr.curious > 0.5 || g.friendLevel >= 2) && chance(0.5)) {
        yield* this.noseLanding(f);
        this.say(`had a butterfly land on ${this.name}'s nose`); this.joy(1.3);
      } else { this.say(this.night ? 'watched a firefly drift out of the flowers' : 'watched a butterfly flutter out of the flowers'); this.joy(0.9); f.gone = true; }
    } else if (r < 0.78) {
      pet.nosePetal = 7; pet.expr = 'surprised'; pet.lookAt = { x: pet.x + pet.facing * 30, y: pet.y - 90 }; pet.o.lookX = 0; pet.o.pupil = 1.3;
      yield* wait(pet, 1.2);
      pet.o = {}; pet.expr = 'happy'; pet.lookCam = 1; g.audio.voice('giggle');
      yield* wait(pet, 1);
      this.say('came away with a petal stuck on their nose'); this.joy(0.9);
    } else {
      const k = this.keepsake(['petal', 'dandelion', 'heartleaf']);
      yield* this.findThing(k.id, `found ${an(k.name)} among the flowers`); this.joy(1.1);
    }
  }

  private *noseLanding(f: Fly): Gen {
    const g = this.g, pet = g.pet;
    const [hx, hy] = pet.headPos();
    f.land = { x: hx + pet.facing * 40, y: hy - 8 };
    pet.body = 'sit'; pet.moving = false;
    let t = 0;
    while (t < 2.6) { t += pet.dt; pet.lookAt = { x: f.x, y: f.y }; pet.o.lookX = 0; pet.o.pupil = 1.35; pet.expr = t > 1 ? 'love' : 'focus'; yield; }
    pet.o = {}; pet.expr = 'joy'; g.audio.voice('giggle');
    f.land = null; f.gone = true;
    yield* wait(pet, 0.8);
  }

  private *evPuddle(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr, b = g.brain;
    const loves = (tr.playful > 0.6 && tr.brave > 0.45) || b.habit('bath') > 0.55 || this.mem.fav === 'puddle';
    const picky = tr.appetite < 0.35 && !loves;
    const cautious = tr.brave < 0.4 && !loves;
    this.focus = { x: st.x, y: st.y };
    const splashIn = function* (self: Walk): Gen {
      pet.expr = 'joy'; g.audio.voice('excited');
      for (let i = 0; i < 3; i++) {
        pet.jump(250); pet.moveTo(st.x + (i % 2 ? -40 : 40), st.y - 4, 120);
        yield* until(pet, () => pet.z > 0, 0.2); yield* until(pet, () => pet.z <= 0, 1);
        g.fx.drops(pet.x, pet.y - 10, 10, 220); g.audio.splash();
      }
      self.muddy = true;
      const n = g.save.pet.needs; n.clean = Math.max(0, n.clean - 0.45); n.fun = clamp01(n.fun + 0.1);
      pet.o.wet = 0.6;
      yield* wait(pet, 0.4);
      pet.o.shake = 1; g.audio.shake(); g.fx.drops(pet.x, pet.y - 50, 12); yield* wait(pet, 0.5); pet.o.shake = 0; pet.o.wet = 0.3;
      pet.lookCam = 1; pet.expr = 'joy'; yield* wait(pet, 0.7);
    };
    if (loves) {
      pet.lookAt = { x: st.x, y: st.y }; pet.emote('!'); pet.o.earPerk = 1; yield* wait(pet, 0.3);
      yield* walk(pet, st.x - 90, st.y - 4, 320, 4);
      yield* splashIn(this);
      this.say('spotted the puddle and cannonballed right in'); this.joy(1.4);
    } else if (cautious) {
      yield* this.meet(st, st.x - 95, st.y - 4);
      pet.lookCam = 1; yield* wait(pet, 0.6); pet.lookCam = 0; // "is this okay?"
      pet.o.crouch = 0.5; pet.lookAt = { x: st.x - 40, y: st.y };
      for (let i = 0; i < 2; i++) { pet.o.paw = 1; yield* wait(pet, 0.3); g.fx.drops(st.x - 55, st.y - 5, 3, 60); g.audio.plop(); pet.o.paw = 0; yield* wait(pet, 0.35); }
      pet.o = {}; pet.expr = 'surprised'; pet.jump(160); pet.moveTo(pet.x - 40, pet.y, 120);
      yield* wait(pet, 0.7);
      if (tr.playful > 0.45 || chance(0.4)) {
        pet.lookCam = 1; pet.expr = 'mischief'; yield* wait(pet, 0.5); pet.lookCam = 0;
        yield* walk(pet, st.x - 70, st.y - 4, 160, 3);
        yield* splashIn(this);
        this.say('tested the puddle with one paw… then jumped right in'); this.joy(1.2);
      } else {
        pet.expr = 'happy';
        yield* walk(pet, st.x, st.y - 60, 90, 4); yield* walk(pet, st.x + 110, st.y, 90, 4);
        this.say('tested the puddle with one paw and decided: nope'); this.joy(0.4);
      }
    } else if (picky) {
      yield* this.meet(st, st.x - 100, st.y - 4);
      pet.o.headDown = 0.5; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.7);
      pet.o = {}; pet.expr = 'pout'; pet.o.headTilt = -0.25; yield* wait(pet, 0.8);
      // tiptoes carefully all the way around
      pet.o = {}; pet.expr = 'focus';
      yield* walk(pet, st.x - 30, st.y - 62, 70, 4); yield* walk(pet, st.x + 60, st.y - 58, 70, 4); yield* walk(pet, st.x + 120, st.y, 70, 4);
      pet.o.shake = 0.4; yield* wait(pet, 0.3); pet.o.shake = 0; pet.expr = 'happy'; pet.lookCam = 1; yield* wait(pet, 0.6);
      this.say('tiptoed very carefully around the puddle'); this.joy(0.3);
    } else {
      yield* this.meet(st, st.x - 90, st.y - 4);
      if (tr.curious > 0.5 || chance(0.35)) {
        // the other pet in the puddle!
        pet.body = 'sit'; pet.o.headDown = 0.5; pet.lookAt = { x: st.x - 20, y: st.y + 20 }; pet.expr = 'curious';
        for (let i = 0; i < 3; i++) { pet.o.headTilt = i % 2 ? -0.35 : 0.35; yield* wait(pet, 0.6); }
        pet.o.paw = 1; g.audio.plop(); g.fx.drops(st.x - 45, st.y - 4, 3, 50); yield* wait(pet, 0.3); pet.o.paw = 0;
        pet.expr = 'surprised'; yield* wait(pet, 0.4); pet.expr = 'joy'; g.audio.voice('giggle'); yield* wait(pet, 0.8);
        this.say('was fascinated by the pet in the puddle'); this.joy(1);
      } else {
        pet.o.headDown = 0.8; pet.o.tongue = 0.7; pet.expr = 'happy';
        let t = 0; while (t < 1.6) { t += pet.dt; pet.o.tongue = Math.abs(Math.sin(t * 10)); yield; }
        pet.o = {};
        if (chance(0.4)) { yield* splashIn(this); this.say('had a drink from the puddle and a big splash'); this.joy(1.1); }
        else { this.say('lapped a little drink from the puddle'); this.joy(0.6); }
      }
    }
  }

  private *evLeaves(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const zoomy = tr.energy > 0.6 || tr.playful > 0.72;
    const relaxed = tr.energy < 0.4;
    if (zoomy) {
      this.focus = { x: st.x, y: st.y };
      pet.lookAt = { x: st.x, y: st.y - 20 }; pet.o.earPerk = 1; pet.emote('!'); yield* wait(pet, 0.3);
      yield* walk(pet, st.x - 180, st.y, 200, 3);
      pet.body = 'crouch'; pet.expr = 'mischief'; pet.faceToward(st.x);
      let t = 0; while (t < 0.9) { t += pet.dt; pet.o.tilt = Math.sin(t * 25) * 0.05; yield; } // butt wiggle
      pet.o = {}; pet.body = 'stand'; pet.expr = 'excited'; g.audio.voice('excited');
      yield* walk(pet, st.x - 60, st.y, 380, 2);
      pet.jump(360); pet.moveTo(st.x + 10, st.y, 200);
      yield* until(pet, () => pet.z <= 0 && pet.vz <= 0, 1.5);
      this.scatter(st, 1); g.audio.rustle();
      pet.expr = 'joy'; g.audio.voice('giggle');
      yield* wait(pet, 0.5);
      pet.jump(240); this.scatter(st, 0.5); g.audio.rustle();
      yield* wait(pet, 0.7);
      if (chance(0.35 + tr.playful * 0.2)) {
        pet.hatLeaf = 1; pet.leafCol = pick(LEAF_COLS);
        pet.lookCam = 1; pet.expr = 'happy'; yield* wait(pet, 1.2);
        this.say('charged into the leaf pile and came out wearing a leaf'); this.joy(1.4);
      } else { pet.lookCam = 1; yield* wait(pet, 0.8); this.say('charged into the leaf pile — leaves everywhere!'); this.joy(1.3); }
    } else if (relaxed) {
      yield* this.meet(st, st.x - 30, st.y);
      for (let i = 0; i < 3; i++) { pet.face(-pet.facing); pet.moveTo(st.x + (i % 2 ? 14 : -14), st.y, 40); yield* wait(pet, 0.38); }
      pet.moving = false; g.audio.rustle(); this.scatter(st, 0.15);
      pet.body = 'lie'; pet.expr = 'bliss';
      yield* wait(pet, 1.2);
      pet.body = 'belly'; let t = 0; while (t < 3.5) { t += pet.dt; g.brain.purr = 0.35; yield; }
      pet.body = 'lie'; yield* wait(pet, 0.6);
      this.say('flopped onto the leaf pile for a cozy rest'); this.joy(tr.energy < 0.3 ? 1.3 : 1);
    } else {
      yield* this.meet(st, st.x - 80, st.y);
      pet.o.headDown = 0.7; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.7);
      pet.o = {};
      if (tr.brave < 0.4) {
        // a leaf skitters at it!
        this.scatter(st, 0.12); g.audio.rustle();
        pet.expr = 'surprised'; pet.jump(200); pet.moveTo(pet.x - 50, pet.y, 140); g.audio.voice('surprise');
        yield* wait(pet, 0.7); pet.expr = 'joy'; g.audio.voice('giggle'); yield* wait(pet, 0.6);
        this.say('was ambushed by a single leaf (and then giggled)'); this.joy(0.7);
      } else {
        pet.o.paw = 1; this.scatter(st, 0.25); g.audio.rustle(); yield* wait(pet, 0.3); pet.o.paw = 0;
        pet.body = 'crouch'; yield* wait(pet, 0.4); pet.body = 'stand'; pet.jump(260); this.scatter(st, 0.35);
        yield* wait(pet, 0.8);
        this.say('pounced on the leaf pile'); this.joy(1);
      }
    }
    if (chance(0.3)) { const k = this.keepsake(['mapleleaf', 'heartleaf']); yield* this.findThing(k.id, `picked out ${an(k.name)}`); }
  }

  private *evButterfly(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const f = this.spawnFly(st.x + 40, st.y - 120);
    const f2 = this.night ? this.spawnFly(st.x - 60, st.y - 150) : null;
    this.focus = { x: st.x, y: st.y };
    pet.moving = false; pet.lookAt = { x: f.x, y: f.y }; pet.o.earPerk = 1;
    yield* wait(pet, 0.4);
    pet.expr = 'focus'; pet.emote('!');
    yield* wait(pet, 0.3);
    const track = (s: number) => (function* (): Gen { let t = 0; while (t < s) { t += pet.dt; pet.lookAt = { x: f.x, y: f.y }; yield; } })();
    if (tr.playful > 0.6 || tr.energy > 0.65) {
      let t = 0;
      while (t < 3) { t += pet.dt; pet.lookAt = { x: f.x, y: f.y }; pet.moveTo(f.x - 60 * pet.facing, clamp(f.y + 250, 540, 660), 230); yield; }
      pet.moving = false; pet.body = 'crouch'; pet.expr = 'focus'; pet.faceToward(f.x);
      yield* track(0.7);
      pet.body = 'stand'; pet.expr = 'excited'; pet.jump(430); pet.moveTo(f.x, pet.y, 240); g.audio.boing();
      f.ty = f.y - 150; f.tx = f.x + 60; // it flutters up, unharmed
      yield* wait(pet, 0.7);
      pet.body = 'sit'; pet.expr = 'happy'; yield* track(1.2);
      pet.lookCam = 1; yield* wait(pet, 0.5);
      this.say(this.night ? 'pounced at a firefly and missed (on purpose, surely)' : 'pounced at a butterfly and missed (the butterfly didn\'t mind)'); this.joy(1.2);
    } else if (tr.brave < 0.4) {
      let t = 0;
      while (t < 3.5) { t += pet.dt; pet.lookAt = { x: f.x, y: f.y }; pet.o.headTilt = Math.sin(t * 2.5) * 0.3; pet.moveTo(f.x - 90 * pet.facing, clamp(f.y + 260, 540, 660), 60); yield; }
      pet.moving = false; pet.o = {};
      this.say(this.night ? 'followed a firefly very politely' : 'followed a butterfly very politely'); this.joy(0.9);
    } else {
      pet.body = 'sit';
      yield* track(1.5);
      if (!this.night && chance(0.3 + (tr.curious > 0.6 ? 0.2 : 0))) { yield* this.noseLanding(f); this.say(`had a butterfly land on ${this.name}'s nose`); this.joy(1.4); }
      else { pet.expr = 'love'; yield* track(2); this.say(this.night ? 'sat and watched the fireflies glow' : 'sat and watched a butterfly dance'); this.joy(tr.energy < 0.4 ? 1.1 : 0.8); }
    }
    f.gone = true; if (f2) f2.gone = true;
  }

  private *evBush(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    if (tr.brave < 0.4) {
      // the bush rustles first…
      this.focus = { x: st.x, y: st.y };
      pet.lookAt = { x: st.x, y: st.y - 40 }; st.t = 0.8; g.audio.rustle(); pet.expr = 'surprised'; pet.o.earPerk = 1; pet.jump(140);
      yield* wait(pet, 0.8);
      pet.lookCam = 1; yield* wait(pet, 0.6); pet.lookCam = 0;
    }
    yield* this.meet(st, st.x - 90, st.y + 34);
    pet.o.headDown = 0.6; pet.o.sniff = 1; pet.expr = 'focus';
    for (let i = 0; i < 3; i++) { st.t = 0.4; g.audio.rustle(); g.audio.sniff(); yield* wait(pet, 0.45); }
    pet.o = {};
    const r = Math.random() * (1 + tr.curious * 0.5);
    if (r < 0.25) {
      pet.expr = 'neutral'; pet.lookCam = 1; pet.o.headTilt = 0.3; yield* wait(pet, 1); // nothing! a very serious look at you
      this.say('sniffed a bush very thoroughly (nothing there)'); this.joy(0.5 + tr.curious * 0.3);
    } else if (r < 0.5) {
      pet.hatLeaf = 1; pet.leafCol = '#6cc25a'; pet.expr = 'happy'; pet.lookCam = 1; g.audio.voice('giggle'); yield* wait(pet, 1);
      this.say('poked their head into a bush and came out wearing it'); this.joy(0.9);
    } else if (r < 0.7) {
      yield* this.takeStick(st, false);
    } else {
      const k = this.keepsake(chance(0.12) ? ['goldfeather'] : ['speckfeather', 'mapleleaf', 'dandelion']);
      yield* this.findThing(k.id, `nosed ${an(k.name)} out of a bush`); this.joy(1.2);
    }
  }

  private *evBench(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr, fl = g.friendLevel;
    yield* this.meet(st, st.x + 20, st.y + 70);
    this.allowTouch = true;
    this.tip = 'Rest a moment — give them a pat!'; g.ui.refresh();
    pet.face(-1); pet.lookCam = 1;
    const tired = g.save.pet.needs.energy < 0.45 || tr.energy < 0.3;
    if (fl >= 3) {
      // head in your lap: lies down facing you, eyes closing
      pet.body = 'lie'; pet.expr = 'love'; pet.o.headTilt = 0.3; g.audio.voice('coo');
      let t = 0; while (t < 4.5) { t += pet.dt; g.brain.purr = 0.4; if (t > 2) pet.expr = 'bliss'; yield; }
      if (tired) { pet.asleep = true; let s = 0; while (s < 3) { s += pet.dt; yield; } pet.asleep = false; }
      this.say(tired ? 'rested their head in your lap and dozed off' : 'rested their head in your lap at the bench'); this.joy(1.2);
    } else if (fl >= 2 || tr.cuddly > 0.6) {
      pet.body = 'sit'; pet.o.tilt = -0.09; pet.o.headTilt = 0.3; pet.expr = 'love'; // a lean against you
      let t = 0; while (t < 4) { t += pet.dt; g.brain.purr = 0.25; yield; }
      this.say('leaned against you on the bench'); this.joy(1);
    } else {
      pet.body = 'sit'; pet.expr = 'happy';
      let t = 0, nt = 0; while (t < 4) { t += pet.dt; if (t > nt) { nt = t + rand(0.9, 1.6); pet.lookAt = { x: pet.x + rand(-300, 300), y: rand(250, 450) }; pet.lookCam = 0; } yield; }
      this.say('sat by the bench and watched the world go by'); this.joy(0.6 + (1 - tr.energy) * 0.4);
    }
    const n = g.save.pet.needs; n.energy = clamp01(n.energy + 0.08); n.affection = clamp01(n.affection + 0.08);
    this.tip = ''; g.ui.refresh();
    pet.o = {}; pet.body = 'stand'; pet.lookCam = 0;
  }

  private *evSound(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const sx = st.x + 150, sy = st.y - 120;
    this.focus = { x: sx, y: st.y };
    pet.moving = false;
    if (this.night) g.audio.hoot(); else { g.audio.rustle(); g.audio.squeak(); }
    st.t = 1;
    pet.expr = 'surprised'; pet.o.earPerk = 1;          // freeze, ears up…
    yield* wait(pet, 0.35);
    pet.lookAt = { x: sx, y: sy };                       // …eyes find it…
    yield* wait(pet, 0.3);
    pet.o.headTilt = 0.3;                                // …head tilts…
    yield* wait(pet, 0.5);
    pet.faceToward(sx);                                  // …body turns
    const reveal = () => { if (this.night) this.owl = 3.5; else this.squirrelRun(sx, st.y - 10, true); };
    if (tr.brave > 0.6) {
      pet.expr = 'focus'; pet.o.headTilt = undefined;
      yield* walk(pet, sx - 80, st.y, 170, 4);
      pet.o.headDown = 0.6; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.8); pet.o = {};
      reveal(); pet.expr = 'surprised'; pet.jump(160); yield* wait(pet, 0.6);
      pet.lookAt = { x: sx, y: sy - 80 }; pet.expr = 'happy'; pet.o.tailWag = 1.3; yield* wait(pet, 1.2);
      this.say(this.night ? 'marched over to a spooky hoot — it was just an owl' : 'marched right over to a mystery rustle — a squirrel!'); this.joy(1.1);
    } else if (tr.brave < 0.4) {
      // scoots back toward you, ears flat
      pet.expr = 'surprised'; pet.o.earPerk = -0.8; pet.emote('sweat');
      yield* walk(pet, pet.x - 70, 664, 200, 3);
      pet.face(1); pet.body = 'sit'; pet.lookCam = 1; yield* wait(pet, 0.8);
      pet.lookCam = 0; pet.lookAt = { x: sx, y: sy };
      reveal(); yield* wait(pet, 1);
      pet.o = {}; pet.expr = 'joy'; g.audio.voice('giggle'); pet.lookCam = 1; yield* wait(pet, 0.8);
      this.say(this.night ? 'heard a hoot and scooted right back to you' : 'heard a strange sound and scooted right back to you'); this.joy(0.35);
    } else {
      if (tr.cuddly > 0.55) { pet.lookCam = 1; yield* wait(pet, 0.7); pet.lookCam = 0; } // a look at you for reassurance
      pet.o.headTilt = -0.3; yield* wait(pet, 0.5); pet.o.headTilt = 0.3; yield* wait(pet, 0.5);
      reveal(); pet.o = {}; pet.expr = 'happy'; pet.lookAt = { x: sx, y: sy - 60 }; yield* wait(pet, 1.2);
      this.say(this.night ? 'tilted their head at an owl' : 'tilted their head at a rustling squirrel'); this.joy(0.6);
    }
  }

  private *evDig(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    yield* this.meet(st, st.x - 55, st.y + 2);
    pet.face(1); pet.o.headDown = 0.9; pet.o.sniff = 1; pet.expr = 'focus'; g.audio.sniff();
    yield* wait(pet, 0.8);
    pet.o = { tailWag: 1.5, earPerk: 1 }; pet.emote('!'); yield* wait(pet, 0.3);
    pet.body = 'bow'; pet.expr = 'excited';
    let t = 0, nt = 0;
    while (t < 1.6) { t += pet.dt; pet.o.paw = Math.abs(Math.sin(t * 16)); if (t > nt) { nt = t + 0.17; g.fx.dirt(st.x, st.y - 4, 2); g.audio.dig(); } yield; }
    st.state = 1; pet.o = {}; pet.body = 'stand';
    const n = g.save.pet.needs; n.clean = Math.max(0, n.clean - 0.1);
    const r = Math.random();
    if (r < 0.12) { pet.expr = 'surprised'; pet.lookCam = 1; yield* wait(pet, 0.8); pet.expr = 'happy'; this.say('dug a very nice hole (with nothing in it)'); this.joy(0.7 + tr.energy * 0.3); }
    else if (r < 0.55) {
      const c = weighted(COLLECTIBLES.map((q) => ({ item: q, w: q.weight })))!;
      yield* this.findThing(c.id, `dug up ${an(c.name)}`); this.joy(1.2);
      yield* admire(g.brain);
    } else { const k = this.keepsake(['smoothstone', 'twig', 'mapleleaf']); yield* this.findThing(k.id, `dug up ${an(k.name)}`); this.joy(1.1); }
  }

  private *takeStick(st: Stop, onGround: boolean): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    const big = !!st.big && onGround;
    if (onGround) st.state = 1;
    pet.held = big ? 'c:bigstick' : 'c:twig'; pet.heldScale = big ? 3 : 1.4;
    pet.expr = 'starry'; pet.o.tailWag = 1.6; pet.jump(160); g.audio.voice('excited');
    yield* wait(pet, 0.6);
    const keeps = big || tr.playful > 0.55 || this.mem.sticks >= 5 || chance(0.5);
    if (keeps) {
      this.carry = pet.held; this.mem.sticks++;
      if (this.mem.sticks === 5) addJournal(g.save.memory, 'c:twig', `${this.name} has a thing for sticks. A real thing.`);
      if (big) {
        // wobbles under the weight, completely delighted
        let t = 0; while (t < 1.4) { t += pet.dt; pet.o.tilt = Math.sin(t * 7) * 0.1; yield; }
        pet.o = {}; pet.lookCam = 1; yield* wait(pet, 0.6);
        this.say('found an absurdly huge stick and insisted on carrying it');
      } else if (g.friendLevel >= 2 && tr.playful > 0.5) {
        yield* this.stickThrow();
      } else { yield* admire(g.brain); pet.held = this.carry; this.say('found a stick and carried it proudly'); }
      this.joy(tr.playful > 0.5 || this.mem.sticks > 5 ? 1.3 : 0.9);
    } else if (tr.energy < 0.45) {
      pet.body = 'lie'; pet.expr = 'happy';
      let t = 0; while (t < 2.5) { t += pet.dt; pet.o.mouthOpen = Math.abs(Math.sin(t * 6)) * 0.3; yield; }
      pet.o = {}; pet.held = null; pet.heldScale = 1; pet.body = 'stand';
      this.say('lay down for a good stick chew'); this.joy(0.9);
    } else {
      pet.held = null; pet.heldScale = 1; pet.expr = 'neutral';
      this.say('inspected a stick and decided it wasn\'t worthy'); this.joy(0.3);
    }
  }

  /** Drops the stick at your feet and waits: tap anywhere to throw it. */
  private *stickThrow(): Gen {
    const g = this.g, pet = g.pet;
    yield* walk(pet, pet.x - 40, 650, 160, 3);
    pet.face(1); pet.lookCam = 1; pet.held = null; pet.body = 'bow'; pet.expr = 'excited'; pet.o.tailWag = 1.5;
    const stick = { x: pet.x + 40, y: 656 };
    this.leaves.push({ x: stick.x, y: stick.y, z: 0, vx: 0, vz: 0, rot: 0, vr: 0, col: 'stick', rest: 0 });
    const sObj = this.leaves[this.leaves.length - 1];
    this.throwReady = true; this.throwAt = null;
    this.tip = 'Tap anywhere to throw the stick!'; g.ui.refresh();
    let t = 0; while (t < 6 && this.throwAt === null) { t += pet.dt; yield; }
    this.throwReady = false; this.tip = ''; g.ui.refresh();
    const tx = clamp(this.throwAt ?? pet.x + 260, pet.x + 140, pet.x + 360);
    sObj.vx = (tx - sObj.x) / 0.9; sObj.vz = 380; sObj.z = 2; sObj.vr = 12; g.audio.whoosh();
    pet.body = 'crouch'; pet.lookCam = 0; pet.lookAt = { x: tx, y: 600 }; yield* wait(pet, 0.25);
    pet.body = 'stand'; yield* walk(pet, tx - 30, 640, 330, 3);
    sObj.x = -9999; pet.held = 'c:twig'; pet.heldScale = 1.4; this.carry = pet.held; g.audio.thud();
    yield* wait(pet, 0.3);
    yield* walk(pet, pet.x - 100, 650, 250, 3); pet.face(1); pet.lookCam = 1; pet.body = 'sit'; yield* wait(pet, 0.8);
    this.say(this.throwAt !== null ? 'found a stick and played fetch with you' : 'found a stick and fetched it all by itself');
  }

  private *evStick(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    if (this.carry && !st.big && chance(0.6)) {
      // already has one: a very serious comparison
      yield* this.meet(st, st.x - 60, st.y);
      pet.o.headDown = 0.5; pet.lookAt = { x: st.x, y: st.y }; pet.o.headTilt = 0.3; yield* wait(pet, 1);
      pet.o.headTilt = -0.3; yield* wait(pet, 0.8);
      pet.o = {}; pet.lookCam = 1; pet.expr = 'happy'; yield* wait(pet, 0.6);
      this.say('compared a new stick with their own stick and kept it'); this.joy(0.9);
      return;
    }
    const want = st.big || tr.playful > 0.45 || this.mem.sticks >= 3 || tr.cuddly > 0.35 || chance(0.4);
    yield* this.meet(st, st.x - 55, st.y - 2);
    pet.o.headDown = 0.8; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.6); pet.o = {};
    if (!want) { pet.expr = 'neutral'; pet.o.headTilt = 0.2; yield* wait(pet, 0.7); this.say('sniffed a stick and walked on (very independent)'); this.joy(0.2); return; }
    pet.o.headDown = 0.9; yield* wait(pet, 0.25); pet.o = {};
    yield* this.takeStick(st, true);
  }

  private *evPicnic(st: Stop): Gen {
    const g = this.g, pet = g.pet, tr = this.tr;
    if (tr.appetite > 0.65) {
      // nose up, sniffing the air… suspiciously interested
      pet.moving = false; this.focus = { x: st.x, y: st.y };
      pet.o.sniff = 1; pet.lookAt = { x: st.x, y: 380 }; pet.expr = 'hungry'; g.audio.sniff();
      yield* wait(pet, 0.9); g.audio.sniff(); yield* wait(pet, 0.5);
      pet.o = {}; pet.o.tongue = 0.6; pet.emote('!');
      yield* walk(pet, st.x - 110, st.y + 60, 230, 4);
      pet.o.crouch = 0.5; pet.expr = 'mischief'; yield* walk(pet, st.x - 60, st.y + 44, 60, 3); pet.o.crouch = undefined;
      pet.o.headDown = 0.6; pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.8); pet.o = {};
      pet.lookCam = 1; pet.expr = 'surprised'; pet.o.eyeWide = 0.9; pet.o.blush = 1; yield* wait(pet, 1.1); // "…what? I wasn't doing anything."
      pet.o = {}; pet.lookCam = 0;
      if (chance(0.65)) {
        pet.o.headDown = 0.9; yield* wait(pet, 0.4); pet.o = {};
        pet.held = 'blueberry'; pet.expr = 'starry'; yield* wait(pet, 0.6);
        pet.held = null; pet.expr = 'chew'; g.audio.crunch(); yield* wait(pet, 0.8);
        g.save.pet.needs.hunger = clamp01(g.save.pet.needs.hunger + 0.04);
        pet.expr = 'joy'; pet.lookCam = 1; yield* wait(pet, 0.6);
        this.say('sniffed out a picnic from miles away and found one stray blueberry'); this.joy(1.4);
      } else { pet.expr = 'pout'; yield* wait(pet, 0.8); this.say('sniffed out a picnic from miles away (no crumbs, sadly)'); this.joy(0.9); }
    } else if (tr.appetite < 0.35) {
      yield* this.meet(st, st.x - 90, st.y + 60);
      pet.o.sniff = 1; yield* wait(pet, 0.6); pet.o = {}; pet.expr = 'pout'; pet.o.headTilt = -0.2; yield* wait(pet, 0.8);
      this.say('inspected a picnic and was not impressed'); this.joy(0.3);
    } else {
      yield* this.meet(st, st.x - 30, st.y + 30);
      pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.6); pet.o = {};
      pet.body = 'lie'; pet.expr = 'bliss'; yield* wait(pet, 1.4); pet.body = 'belly'; yield* wait(pet, 1); pet.body = 'lie';
      this.say('tried out a picnic blanket (very soft)'); this.joy(0.8);
    }
  }

  // ---------- the fork ----------
  private *fork(): Generator<void, void, void> {
    const g = this.g, pet = g.pet, tr = this.tr;
    const used = this.stops.map((s) => s.kind);
    this.choice = pickChoice(tr, this.mem, this.night, used, Math.random);
    this.prefer = petPrefers(this.choice, tr, this.mem, this.night);
    const self = this;
    this.setPhase('travel');
    yield* this.doPet((function* (): Gen { pet.o = {}; yield* walk(pet, self.forkX - 70, PATH_Y + 10, 150, 6); })());
    if (this.homeNow) return;
    this.focus = { x: this.forkX, y: 500 };
    this.setPhase('choice');
    const idle = function* (): Gen {
      pet.body = 'sit'; pet.face(1);
      const signs = [{ x: self.forkX - 20, y: 400 }, { x: self.forkX + 30, y: 440 }];
      while (true) {
        for (const i of [0, 1, self.prefer, 2] as number[]) {
          if (i === 2) { pet.lookAt = null; pet.lookCam = 1; yield* wait(pet, 1); pet.lookCam = 0; continue; }
          pet.lookAt = signs[i];
          const mine = i === self.prefer;
          pet.o.tailWag = mine ? 1.4 : 0.4; pet.o.earPerk = mine ? 1 : 0;
          if (mine && (self.mem.fav || tr.curious > 0.6 || tr.energy > 0.6)) pet.think(PATHS[self.choice![i]].icon, 1.5);
          yield* wait(pet, mine ? 1.3 : 0.9);
        }
      }
    };
    pet.run(idle(), 'walk', 2);
    let t = 0;
    while (!this.chosen && !this.homeNow) {
      t += pet.dt;
      if (!pet.action) pet.run(idle(), 'walk', 2);
      if (t > 25) { this.chosen = this.choice[this.prefer]; g.toast('walk', `${this.name} picked the ${PATHS[this.chosen].name}!`, 'walk'); }
      yield;
    }
    if (this.homeNow || !this.chosen) return;
    const chosen = this.chosen;
    const happy = chosen === this.choice[this.prefer];
    // lay out what's down that path
    // two stops from the chosen path, then one or two more before home (5–6 stops in all)
    const next = pickKinds(2, tr, this.mem, this.night, used, Math.random, PATHS[chosen].kinds);
    const more = 3 - next.length + (chance(0.35) ? 1 : 0);
    next.push(...pickKinds(more, tr, this.mem, this.night, [...used, ...next], Math.random));
    for (const k of next) this.stops.push(this.mkStop(k, this.stops.length, chosen));
    this.focus = null;
    this.setPhase('travel');
    yield* this.doPet((function* (): Gen {
      pet.o = {}; pet.lookAt = null; pet.body = 'stand';
      if (happy) { pet.expr = 'joy'; pet.jump(240); g.audio.voice('excited'); } else { pet.expr = 'curious'; pet.o.headTilt = 0.3; g.audio.voice('question'); }
      yield* wait(pet, 0.7);
      pet.o = {}; pet.expr = null;
    })());
  }

  // ---------- between stops ----------
  private *waitForGo(st: Stop): Generator<void, void, void> {
    const g = this.g, pet = g.pet;
    this.goOn = false;
    this.setPhase('wait');
    const idle = function* (): Gen {
      pet.o = {}; pet.expr = null; pet.body = chance(0.5) ? 'sit' : 'stand';
      while (true) {
        pet.lookCam = 1; pet.o.tailWag = 0.9; yield* wait(pet, rand(1.2, 2));
        pet.lookCam = 0; pet.lookAt = { x: pet.x + 300, y: 520 }; yield* wait(pet, rand(0.8, 1.3)); // "onward?"
        pet.lookAt = null;
      }
    };
    pet.run(idle(), 'walk', 2);
    let t = 0;
    while (!this.goOn && !this.homeNow) {
      t += pet.dt;
      if (!pet.action) pet.run(idle(), 'walk', 2);
      if (t > 12) this.goOn = true; // it leads the way if you don't
      yield;
    }
    if (this.homeNow) return;
    // a favourite spot is hard to leave
    if (this.mem.fav === st.kind && chance(0.45)) {
      const self = this;
      yield* this.doPet((function* (): Gen {
        pet.body = 'sit'; pet.face(-1); pet.lookAt = { x: st.x, y: st.y - 20 }; pet.expr = 'pout'; pet.o.tailWag = 0.2;
        yield* wait(pet, 1.6);
        pet.lookAt = null; pet.lookCam = 1; yield* wait(pet, 0.6);
        pet.o.eyeOpen = 0.3; yield* wait(pet, 0.4); // a big sigh
        pet.o = {}; pet.expr = 'happy'; pet.body = 'stand'; pet.lookCam = 0; pet.face(1);
        self.say(`refused to leave ${PLACE[st.kind]} for a moment`, 1.2);
      })());
    }
  }

  // ---------- going home ----------
  private *goHome(): Generator<void, void, void> {
    const g = this.g, pet = g.pet, tr = this.tr, s = g.save, self = this;
    this.setPhase('home');
    this.focus = null;
    yield* this.doPet((function* (): Gen {
      pet.o = {}; pet.lookCam = 1; pet.expr = 'happy'; pet.o.tailWag = 1;
      yield* wait(pet, 0.6);
      pet.lookCam = 0; pet.face(-1);
      yield* walk(pet, pet.x - 120, PATH_Y, 150, 2);
    })());
    yield* this.fadeTo(1);
    // back home (still a walk until the homecoming is over: no other activity can start mid-way)
    this.scene = 'home';
    g.zone = 'room';
    g.world.cacheKey = '';
    pet.stop(); pet.o = {}; pet.lookAt = null;
    pet.x = 985; pet.y = 566; pet.z = 0; pet.face(-1);
    pet.held = this.carry;
    g.cam.x = g.camT.x = clamp(900, 0, 1000); g.cam.y = g.camT.y = g.freeCamY();
    g.ui.refresh();
    this.phase = 'home';
    yield* this.fadeTo(0);
    const tired = s.pet.needs.energy < 0.35;
    const dirty = this.muddy || s.pet.needs.clean < 0.45;
    yield* this.doPet((function* (): Gen {
      pet.expr = 'happy';
      yield* walk(pet, 800, 600, 150, 4);
      pet.face(-1);
      if (self.carry) {
        // proudly presents the stick
        pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'starry'; pet.o.tailWag = 1.6; g.audio.voice('excited');
        yield* wait(pet, 1.2);
        pet.held = null; pet.heldScale = 1;
        const id = self.carry === 'c:bigstick' ? 'bigstick' : 'twig';
        if (!s.memory.collect[id]) { g.collect(id, pet.x - 40, pet.y - 30); self.found.push(id); }
        pet.expr = 'love'; yield* wait(pet, 0.7);
        pet.body = 'stand';
      }
      if (dirty) {
        pet.expr = 'focus'; yield* wait(pet, 0.3);
        pet.o.shake = 1; g.audio.shake();
        for (let i = 0; i < 4; i++) { g.fx.dirt(pet.x, pet.y - 60, 3); yield* wait(pet, 0.13); if (i === 1) pet.hatLeaf = 0; }
        pet.o.shake = 0; pet.expr = 'joy'; pet.lookCam = 1; g.audio.voice('giggle');
        yield* wait(pet, 0.8);
        g.hint('muddyPaws', `Muddy paws! ${s.pet.name} might enjoy a bath (Care → Bath Time).`);
      }
      if (pet.hatLeaf > 0 && !dirty) { pet.o.shake = 1; g.audio.shake(); yield* wait(pet, 0.4); pet.o.shake = 0; }
      pet.hatLeaf = 0;
      if (tired) {
        pet.lookCam = 0; pet.expr = 'sleepy'; g.audio.voice('yawn'); yield* wait(pet, 0.6);
        pet.body = 'lie'; pet.expr = 'bliss'; yield* wait(pet, 1.6);
      } else if (tr.energy > 0.6 && s.pet.needs.energy > 0.5) {
        pet.lookCam = 0; pet.expr = 'excited';
        for (let i = 0; i < 3; i++) yield* walk(pet, i % 2 ? 750 : 350, rand(560, 650), 360, 3);
        pet.expr = 'happy'; pet.body = 'sit'; pet.lookCam = 1; yield* wait(pet, 0.6);
      } else {
        pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'love'; g.fx.hearts(pet.x, pet.y - 160, 3); g.audio.voice('coo');
        yield* wait(pet, 1.2);
      }
    })());
    this.finish(tired, dirty);
    g.brain.idle = 1.5;
  }

  /** Put everything the walk touched back to normal (used by every way a walk can end). */
  private endWalk() {
    const g = this.g, pet = g.pet;
    this.flow = null; this.active = false;
    this.scene = 'park'; this.fade = 0; this.focus = null; this.poke = null; this.tip = '';
    this.throwReady = false; this.throwAt = null; this.allowTouch = false; this.goOn = false; this.homeNow = false;
    this.leaves = []; this.flies = []; this.squirrel = null; this.owl = 0;
    pet.heldScale = 1; pet.nosePetal = 0;
    g.input.cancelAll('walk end');
    if (g.mode === 'walk') g.mode = 'free';
    g.diag.log('walk', 'end');
    g.ui.refresh();
  }

  /** Home was pressed before leaving the garden: no walk after all. */
  private callOff() {
    const pet = this.g.pet;
    this.endWalk();
    pet.stop(); pet.o = {}; pet.lookAt = null; pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'happy';
  }

  /**
   * Emergency exit, used only when something went wrong (an error, or the walk stopped making
   * progress): bring the pet straight home and make sure every control works again. Whatever
   * happened on the walk so far is still kept.
   */
  abort(reason: string) {
    const g = this.g, pet = g.pet;
    g.diag.watchdog(`walk aborted: ${reason}`);
    const hadStops = this.story.length > 0 && !this.finished;
    pet.stop(); pet.carried = false; pet.o = {}; pet.lookAt = null; pet.held = null; pet.hatLeaf = 0;
    pet.x = 800; pet.y = 600; pet.z = 0; pet.vz = 0; pet.body = 'sit'; pet.face(-1);
    g.zone = 'room'; g.world.cacheKey = '';
    g.cam.x = g.camT.x = 900; g.cam.y = g.camT.y = g.freeCamY(); g.cam.zoom = g.camT.zoom = 1;
    this.endWalk();
    if (hadStops) { try { this.finish(false, this.muddy); } catch (e) { g.diag.error('walk finish', e); } }
  }

  private finish(tired: boolean, dirty: boolean) {
    const g = this.g, s = g.save, m = s.memory;
    if (this.finished) return;
    this.finished = true;
    if (g.mode === 'walk' || this.active) this.endWalk();
    const first = this.mem.walks === 0;
    this.mem.walks++;
    const n = s.pet.needs;
    n.fun = clamp01(n.fun + 0.3); n.affection = clamp01(n.affection + 0.15); n.energy = clamp01(n.energy - 0.1);
    g.bump('walks');
    const today = g.bump('walks_' + new Date().toDateString());
    const reward = Math.max(2, Math.round((5 + this.found.length * 2 + this.story.length) / (today > 3 ? 2 : 1)));
    g.earn(reward, true);
    g.addFriend('walk', 8);
    g.brain.grow('walkies', 0.12);
    g.brain.st.mark('walked');
    const line = this.storyLine(tired, dirty);
    addJournal(m, 'walk', line);
    if (first) g.achieve('walkies', 'First Walkies');
    const kinds = KEEPSAKES.filter((k) => m.collect[k.id]).length;
    if (kinds >= 5) g.achieve('keepsake5', 'Keepsake Keeper');
    g.ui.walkResult(line, [...new Set(this.found)], reward);
    this.carry = null;
    g.persist();
  }

  /** "Mochi saw the puddle, tested it with one paw, then jumped in — and came home carrying a stick." */
  storyLine(tired: boolean, dirty: boolean) {
    const n = this.name;
    // the four most memorable moments, told in the order they happened
    const top = [...this.story].sort((a, b) => b.w - a.w).slice(0, 4);
    const p = this.story.filter((e) => top.includes(e)).map((e) => e.s);
    let s: string;
    if (!p.length) s = `${n} had a lovely little stroll in the park`;
    else if (p.length === 1) s = `${n} ${p[0]}`;
    else if (p.length === 2) s = `${n} ${p[0]}, then ${p[1]}`;
    else s = `${n} ${p.slice(0, -1).join(', ')}, then ${p[p.length - 1]}`;
    const end = this.carry === 'c:bigstick' ? 'came home dragging an enormous stick' : this.carry ? 'came home carrying a stick'
      : this.muddy ? 'came home very muddy' : dirty ? 'came home a bit grubby' : tired ? 'came home sleepy and happy' : '';
    return s + (end ? ` — and ${end}.` : '.');
  }

  // ---------- helpers ----------
  private spawnFly(x: number, y: number): Fly {
    const f: Fly = { x, y, tx: x, ty: y - 40, t: rand(0, 5), col: pick(['#ff9ec4', '#ffd23f', '#9fd0ff', '#c9a8ff']), glow: this.night, gone: false, land: null };
    this.flies.push(f);
    return f;
  }

  private squirrelRun(x: number, y: number, up: boolean) {
    this.squirrel = up ? { x, y, vx: 0, vy: -170, t: 0, up: true } : { x, y, vx: -420, vy: 0, t: 0, up: false };
    this.g.audio.squeak();
  }

  private scatter(st: Stop, amt: number) {
    const n = Math.round((this.g.settings.reducedMotion ? 10 : 26) * amt);
    for (let i = 0; i < n; i++) this.leaves.push({ x: st.x + rand(-50, 50), y: st.y + rand(-10, 20), z: rand(5, 30), vx: rand(-160, 160), vz: rand(180, 420), rot: rand(0, 6), vr: rand(-8, 8), col: pick(LEAF_COLS), rest: 0 });
    st.state = Math.min(1, st.state + amt * 0.8);
  }

  // ---------- drawing ----------
  drawBack(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
    const g = this.g, cam = g.cam.x, night = this.night, eve = this.eve, t = g.time;
    // sky
    const sky = ctx.createLinearGradient(0, CACHE_Y0, 0, 470);
    if (night) { sky.addColorStop(0, '#1d2350'); sky.addColorStop(1, '#4a4a8a'); }
    else if (eve) { sky.addColorStop(0, '#7d8fd6'); sky.addColorStop(1, '#ffc49a'); }
    else { sky.addColorStop(0, '#7cc4ff'); sky.addColorStop(1, '#dff3ff'); }
    ctx.fillStyle = sky; ctx.fillRect(x0 - 10, CACHE_Y0, x1 - x0 + 20, 480 - CACHE_Y0);
    if (night) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) { const x = x0 + ((i * 137.5) % (x1 - x0)), y = CACHE_Y0 + 20 + ((i * 71) % 330); ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t + i)); ctx.fillRect(x, y, 2.5, 2.5); }
      ctx.globalAlpha = 1;
      const mx = cam + 260;
      ellipse(ctx, mx, 40, 34, 34); ctx.fillStyle = '#fff6d0'; ctx.fill();
      ellipse(ctx, mx + 14, 32, 30, 30); ctx.fillStyle = '#2a3066'; ctx.fill();
    } else {
      const sx = cam + 240, sy = eve ? 230 : 20;
      ctx.fillStyle = eve ? 'rgba(255,170,90,0.35)' : 'rgba(255,245,170,0.45)'; ellipse(ctx, sx, sy, 80, 80); ctx.fill();
      ctx.fillStyle = eve ? '#ffb070' : '#fff1a0'; ellipse(ctx, sx, sy, 48, 48); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = -1; i < 4; i++) { const cx = cam * 0.85 + ((i * 520 + t * 8) % 2080) - 400; for (const [dx, dy, r] of [[-40, 8, 28], [0, -6, 38], [40, 6, 30]]) { ellipse(ctx, cx + dx, 90 + (i % 2) * 50 + dy, r, r * 0.8); ctx.fill(); } }
    }
    // far hills (parallax)
    const hill = (col: string, par: number, yb: number, h: number, span: number, off: number) => {
      ctx.fillStyle = col;
      const shift = cam * (1 - par);
      const start = Math.floor((x0 - shift) / span) - 1;
      for (let i = start; i < start + Math.ceil((x1 - x0) / span) + 3; i++) { ellipse(ctx, shift + i * span + off, yb, span * 0.7, h); ctx.fill(); }
    };
    hill(night ? '#2f4a45' : eve ? '#9fbf9a' : '#b6e0a0', 0.25, 470, 90, 520, 0);
    hill(night ? '#35524a' : eve ? '#8fb88a' : '#9fd68a', 0.45, 480, 70, 380, 170);
    // tree line
    for (const d of this.deco) if (d.kind === 'tree' && d.x > x0 - 150 && d.x < x1 + 150) this.drawTree(ctx, d.x, d.y, d.s, this.themeAt(d.x));
    // grass
    const gr = ctx.createLinearGradient(0, 465, 0, CACHE_Y1);
    gr.addColorStop(0, night ? '#3f7a4a' : '#8fd070'); gr.addColorStop(1, night ? '#4a8a55' : '#a6e08a');
    ctx.fillStyle = gr; ctx.fillRect(x0 - 10, 470, x1 - x0 + 20, CACHE_Y1 - 470);
    // theme ground details beyond the fork
    if (this.chosen) this.drawThemeGround(ctx, Math.max(x0, this.forkX + 120), x1);
    // path
    ctx.fillStyle = night ? '#8a7a6a' : '#e6cfa3';
    ctx.beginPath();
    const step = 40;
    const a0 = Math.floor(x0 / step) * step - step;
    for (let x = a0; x <= x1 + step; x += step) ctx.lineTo(x, PATH_Y - 38 + Math.sin(x * 0.006) * 8);
    for (let x = x1 + step; x >= a0; x -= step) ctx.lineTo(x, PATH_Y + 42 + Math.sin(x * 0.005 + 1) * 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = night ? 'rgba(60,50,40,0.25)' : 'rgba(170,130,80,0.25)';
    for (let x = a0; x < x1 + step; x += step) { const k = Math.abs(Math.sin(x * 12.9898)) ; if (k > 0.5) { ellipse(ctx, x + k * 30, PATH_Y + (k - 0.75) * 120, 5 + k * 4, 2.5); ctx.fill(); } }
    // grass tufts & rocks (tappable)
    for (const d of this.deco) if ((d.kind === 'grass' || d.kind === 'rock') && d.y < PATH_Y && d.x > x0 - 60 && d.x < x1 + 60) this.drawSmall(ctx, d);
    // fork signpost
    if (this.forkX > x0 - 100 && this.forkX < x1 + 100) this.drawSign(ctx);
    // flat stop things (drawn under the pet)
    for (const st of this.stops) if (st.x > x0 - 200 && st.x < x1 + 200) this.drawStopFlat(ctx, st);
    // home sign at the end
    const ex = this.endX;
    if (ex > x0 - 100 && ex < x1 + 100) { ctx.fillStyle = '#9a6a45'; ctx.fillRect(ex - 4, 470, 8, 70); roundRect2(ctx, ex - 40, 460, 80, 30, 6, '#fff4e2'); drawAt(ctx, 'home', ex, 475, 24); }
  }

  sortables(items: { y: number; draw: (c: CanvasRenderingContext2D) => void }[]) {
    for (const d of this.deco) if (d.kind === 'lamp') items.push({ y: d.y, draw: (c) => this.drawLamp(c, d.x, d.y) });
    for (const st of this.stops) {
      if (st.kind === 'bench' || st.kind === 'bush' || st.kind === 'flowers' || st.kind === 'sound' || st.kind === 'butterfly') items.push({ y: st.kind === 'sound' ? st.y - 80 : st.y, draw: (c) => this.drawStopUpright(c, st) });
    }
  }

  drawFront(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
    const g = this.g, t = g.time;
    // grass & rocks in front of the path
    for (const d of this.deco) if ((d.kind === 'grass' || d.kind === 'rock') && d.y >= PATH_Y && d.x > x0 - 60 && d.x < x1 + 60) this.drawSmall(ctx, d);
    // leaves (and a thrown stick)
    for (const l of this.leaves) {
      if (l.x < x0 - 50 || l.x > x1 + 50) continue;
      ctx.save(); ctx.translate(l.x, l.y - l.z); ctx.rotate(l.rot);
      if (l.col === 'stick') drawAt(ctx, 'c:twig', 0, 0, 40);
      else { ctx.fillStyle = l.col; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(0, -7, 8, 0); ctx.quadraticCurveTo(0, 7, -8, 0); ctx.fill(); }
      ctx.restore();
    }
    // squirrel
    const sq = this.squirrel;
    if (sq) {
      ctx.save(); ctx.translate(sq.x, sq.y); if (sq.vx < 0) ctx.scale(-1, 1); if (sq.up) ctx.rotate(-1.3);
      const b = Math.sin(t * 30) * 2;
      ctx.fillStyle = '#9a6a45'; ellipse(ctx, 0, -10 + b, 16, 10); ctx.fill(); ellipse(ctx, 14, -18 + b, 8, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-34, -40, -14, -44); ctx.quadraticCurveTo(-4, -30, -12, -12); ctx.fill();
      ctx.fillStyle = '#2d1d14'; ellipse(ctx, 17, -20 + b, 1.8, 1.8); ctx.fill();
      ctx.restore();
    }
    // butterflies / fireflies
    for (const f of this.flies) {
      ctx.save(); ctx.translate(f.x, f.y);
      if (f.glow) {
        const a = 0.5 + 0.5 * Math.sin(f.t * 4);
        ctx.fillStyle = `rgba(255,240,140,${0.25 * a})`; ellipse(ctx, 0, 0, 16, 16); ctx.fill();
        ctx.fillStyle = `rgba(255,250,190,${0.6 + 0.4 * a})`; ellipse(ctx, 0, 0, 4, 4); ctx.fill();
      } else {
        ctx.scale(1.8, 1.8);
        const w = Math.abs(Math.sin(f.t * (f.land ? 3 : 14)));
        ctx.fillStyle = f.col; ctx.strokeStyle = '#4a3340'; ctx.lineWidth = 1.5;
        for (const sd of [-1, 1]) { ellipse(ctx, sd * 7 * w, -3, 7 * w + 1, 9); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = '#4a3340'; ellipse(ctx, 0, 0, 2, 6); ctx.fill();
      }
      ctx.restore();
    }
    // ambient fireflies at night, butterflies by day near the flowers path
    if (this.night) {
      for (let i = 0; i < 14; i++) {
        const fx = g.cam.x - 400 + ((i * 97 + t * 12 * (i % 3 + 1)) % 800), fy = 420 + Math.sin(t * 0.7 + i) * 60 + (i % 4) * 40;
        const a = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        ctx.fillStyle = `rgba(255,245,150,${0.18 * a})`; ellipse(ctx, fx, fy, 12, 12); ctx.fill();
        ctx.fillStyle = `rgba(255,250,190,${0.5 + 0.5 * a})`; ellipse(ctx, fx, fy, 3, 3); ctx.fill();
      }
    }
    // foreground grass blades along the bottom
    ctx.strokeStyle = this.night ? '#2f6a3a' : '#5faa4a'; ctx.lineWidth = 3;
    for (let x = Math.floor(x0 / 34) * 34; x < x1 + 34; x += 34) {
      const k = Math.abs(Math.sin(x * 3.1)); const y = 700 + k * 10, sw = Math.sin(t * 1.5 + x) * 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5 + sw, y - 18 - k * 10); ctx.moveTo(x, y); ctx.lineTo(x + 6 + sw, y - 14 - k * 8); ctx.stroke();
    }
  }

  drawTint(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
    if (!this.night && !this.eve) return;
    ctx.fillStyle = this.night ? 'rgba(30,30,80,0.2)' : 'rgba(255,140,80,0.1)';
    ctx.fillRect(x0 - 50, CACHE_Y0, x1 - x0 + 100, CACHE_Y1 - CACHE_Y0);
    if (this.night) for (const d of this.deco) if (d.kind === 'lamp' && d.x > x0 - 300 && d.x < x1 + 300) {
      const gl = ctx.createRadialGradient(d.x, d.y - 150, 5, d.x, d.y - 150, 240);
      gl.addColorStop(0, 'rgba(255,220,140,0.35)'); gl.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = gl; ctx.fillRect(d.x - 250, d.y - 400, 500, 500);
    }
  }

  /** Screen-space fade (between home and park). */
  drawFade(ctx: CanvasRenderingContext2D) {
    if (this.fade <= 0.001) return;
    const g = this.g;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(255,236,214,${this.fade})`;
    ctx.fillRect(0, 0, g.canvas.width, g.canvas.height);
  }

  private themeAt(x: number): PathTheme | null { return this.chosen && x > this.forkX + 60 ? this.chosen : null; }

  private drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, theme: PathTheme | null) {
    const night = this.night;
    const woods = theme === 'woods';
    ctx.fillStyle = '#9a6a45';
    ctx.beginPath(); ctx.moveTo(x - 14 * s, y); ctx.lineTo(x - 9 * s, y - 120 * s); ctx.lineTo(x + 9 * s, y - 120 * s); ctx.lineTo(x + 14 * s, y); ctx.closePath(); ctx.fill();
    const autumn = woods || (Math.abs(Math.sin(x)) > 0.8);
    const c1 = night ? '#2f5a3a' : woods ? '#d9853a' : autumn ? '#e8a23a' : '#6cb85a';
    const c2 = night ? '#3a6a45' : woods ? '#f0a848' : autumn ? '#f2c060' : '#86cc6e';
    ctx.fillStyle = c1;
    for (const [dx, dy, r] of [[-40, -130, 48], [0, -165, 60], [40, -130, 50], [0, -110, 44]]) { ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s * 0.85); ctx.fill(); }
    ctx.fillStyle = c2;
    for (const [dx, dy, r] of [[-18, -170, 24], [22, -150, 26]]) { ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s * 0.8); ctx.fill(); }
  }

  private drawThemeGround(ctx: CanvasRenderingContext2D, xa: number, xb: number) {
    const th = this.chosen!, night = this.night;
    if (th === 'pond') {
      ctx.fillStyle = night ? '#3a5a8a' : '#8fd3ff';
      for (let x = Math.floor(xa / 600) * 600; x < xb + 600; x += 600) { ellipse(ctx, x + 200, 500, 230, 24); ctx.fill(); }
      ctx.strokeStyle = '#4f9a45'; ctx.lineWidth = 3;
      for (let x = Math.floor(xa / 90) * 90; x < xb; x += 90) { ctx.beginPath(); ctx.moveTo(x, 520); ctx.lineTo(x + 3, 488); ctx.stroke(); ctx.fillStyle = '#8a5a33'; ellipse(ctx, x + 3, 486, 3, 7); ctx.fill(); }
    } else if (th === 'flowers') {
      const fc = ['#ff8ab5', '#ffe066', '#ffffff', '#c9a8ff', '#ff9a6b'];
      for (let x = Math.floor(xa / 46) * 46; x < xb; x += 46) {
        const k = Math.abs(Math.sin(x * 7.7)), y = 500 + k * 30;
        ctx.fillStyle = fc[Math.floor(k * 5) % 5];
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ellipse(ctx, x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4, 4); ctx.fill(); }
        ctx.fillStyle = '#ffcf3f'; ellipse(ctx, x, y, 3, 3); ctx.fill();
      }
    } else if (th === 'woods') {
      for (let x = Math.floor(xa / 30) * 30; x < xb; x += 30) { const k = Math.abs(Math.sin(x * 5.3)); ctx.fillStyle = LEAF_COLS[Math.floor(k * 5) % 5]; ellipse(ctx, x, 500 + k * 160, 6, 3, k * 3); ctx.fill(); }
    } else {
      ctx.strokeStyle = night ? '#4a8a55' : '#c8d86a'; ctx.lineWidth = 3;
      for (let x = Math.floor(xa / 22) * 22; x < xb; x += 22) { const k = Math.abs(Math.sin(x * 3.3)); const y = 520 + k * 14; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y - 26 - k * 12); ctx.moveTo(x, y); ctx.lineTo(x + 5, y - 20 - k * 10); ctx.stroke(); }
    }
  }

  private drawSmall(ctx: CanvasRenderingContext2D, d: Deco) {
    if (d.kind === 'rock') {
      ctx.fillStyle = 'rgba(60,40,30,0.15)'; ellipse(ctx, d.x, d.y + 2, 26 * d.s, 6); ctx.fill();
      ctx.fillStyle = this.night ? '#7a7f8f' : '#b4b8c2'; ellipse(ctx, d.x, d.y - 10 * d.s, 24 * d.s, 16 * d.s); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ellipse(ctx, d.x - 7 * d.s, d.y - 16 * d.s, 8 * d.s, 4 * d.s); ctx.fill();
    } else {
      ctx.strokeStyle = this.night ? '#2f6a3a' : '#5faa4a'; ctx.lineWidth = 3;
      const sw = Math.sin(this.g.time * 1.3 + d.x) * 3;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(d.x + i * 5, d.y); ctx.quadraticCurveTo(d.x + i * 7, d.y - 18 * d.s, d.x + i * 9 + sw, d.y - (30 - Math.abs(i) * 5) * d.s); ctx.stroke(); }
    }
  }

  private drawLamp(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#4a4f63'; ctx.fillRect(x - 3, y - 170, 6, 170); ellipse(ctx, x, y, 12, 4); ctx.fill();
    ctx.fillStyle = this.night ? '#ffe9a0' : '#f4f1e6'; roundRect2(ctx, x - 12, y - 196, 24, 28, 6, ctx.fillStyle as string);
    ctx.fillStyle = '#4a4f63'; ctx.fillRect(x - 15, y - 200, 30, 5);
  }

  private drawSign(ctx: CanvasRenderingContext2D) {
    const x = this.forkX;
    ctx.fillStyle = '#9a6a45'; ctx.fillRect(x - 4, 400, 8, 150);
    const signs = this.choice ?? null;
    [0, 1].forEach((i) => {
      const y = 405 + i * 42, dir = i ? 1 : -1;
      ctx.save(); ctx.translate(x + 4 * dir, y);
      ctx.fillStyle = '#fff4e2'; ctx.strokeStyle = '#9a6a45'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-34, -14); ctx.lineTo(28, -14); ctx.lineTo(40, 0); ctx.lineTo(28, 14); ctx.lineTo(-34, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (signs) drawAt(ctx, PATHS[signs[i]].icon, -2, 0, 24);
      else drawAt(ctx, 'walk', -2, 0, 22);
      ctx.restore();
    });
  }

  private drawStopFlat(ctx: CanvasRenderingContext2D, st: Stop) {
    const x = st.x, y = st.y, night = this.night;
    switch (st.kind) {
      case 'puddle': {
        ctx.fillStyle = night ? '#4a6a9a' : '#8fc8ee'; ellipse(ctx, x, y, 92, 22); ctx.fill();
        ctx.fillStyle = night ? '#5a7aaa' : '#b8e2ff'; ellipse(ctx, x - 20, y - 6, 50, 9); ctx.fill();
        // the pet's reflection
        const pet = this.g.pet;
        if (Math.abs(pet.x - x) < 130 && Math.abs(pet.y - y) < 60 && pet.z < 5) {
          ctx.save();
          ellipse(ctx, x, y, 90, 21); ctx.clip();
          ctx.globalAlpha = 0.35;
          const s = pet.depth;
          ctx.translate(pet.x, pet.y + 4); ctx.scale(s * pet.facing, -s * 0.55);
          drawPet(ctx, pet.pose, this.g.save.pet.appearance, this.g.save.equipped.wear, this.scratchRig, pet.growth);
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
        const rp = (this.g.time * 0.8) % 1;
        ellipse(ctx, x + 30, y + 4, 10 + rp * 20, 3 + rp * 5); ctx.globalAlpha = 1 - rp; ctx.stroke(); ctx.globalAlpha = 1;
        break;
      }
      case 'leaves': {
        const sc = st.state;
        for (let i = 0; i < 26; i++) {
          const a = i * 2.39, r = (i / 26) * 60;
          const lx = x + Math.cos(a) * r * (1 + sc * 1.4), ly = y + Math.sin(a) * r * 0.35 * (1 + sc) - (1 - sc) * (26 - r * 0.4);
          ctx.fillStyle = LEAF_COLS[i % 5]; ellipse(ctx, lx, ly, 10, 5, a); ctx.fill();
        }
        break;
      }
      case 'dig':
        if (st.state) { ctx.fillStyle = '#6b4a34'; ellipse(ctx, x, y, 30, 9); ctx.fill(); ctx.fillStyle = '#a0764f'; ellipse(ctx, x + 38, y - 2, 22, 9); ctx.fill(); }
        else {
          ctx.fillStyle = '#a0764f'; ellipse(ctx, x, y - 4, 34, 12); ctx.fill();
          ctx.fillStyle = '#8a5f3a'; for (const [dx, dy] of [[-12, -6], [8, -9], [18, -2]]) { ellipse(ctx, x + dx, y + dy, 4, 3); ctx.fill(); }
          const tw = 0.5 + 0.5 * Math.sin(this.g.time * 4);
          ctx.globalAlpha = tw; drawAt(ctx, 'sparkle', x + 20, y - 26, 16); ctx.globalAlpha = 1;
        }
        break;
      case 'stick':
        if (!st.state) { ctx.save(); ctx.translate(x, y); ctx.rotate(-0.15); drawAt(ctx, st.big ? 'c:bigstick' : 'c:twig', 0, 0, st.big ? 120 : 50); ctx.restore(); }
        break;
      case 'picnic': {
        ctx.fillStyle = '#ff8a8a'; ctx.beginPath(); ctx.moveTo(x - 90, y - 20); ctx.lineTo(x + 70, y - 24); ctx.lineTo(x + 100, y + 22); ctx.lineTo(x - 70, y + 26); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff4f0';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) { ctx.beginPath(); const bx = x - 80 + i * 40 + j * 12, by = y - 20 + j * 22; ctx.moveTo(bx, by); ctx.lineTo(bx + 40, by - 1); ctx.lineTo(bx + 46, by + 21); ctx.lineTo(bx + 6, by + 22); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = '#c8935a'; roundRect2(ctx, x + 20, y - 46, 50, 32, 6, '#c8935a');
        ctx.strokeStyle = '#a56d3a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x + 45, y - 46, 18, Math.PI, 0); ctx.stroke();
        drawAt(ctx, 'apple', x - 30, y - 6, 22);
        break;
      }
      case 'butterfly': break;
    }
  }

  private drawStopUpright(ctx: CanvasRenderingContext2D, st: Stop) {
    const x = st.x, y = st.y, night = this.night, t = this.g.time;
    const shake = st.t > 0 ? Math.sin(t * 40) * 4 * st.t : 0;
    switch (st.kind) {
      case 'flowers': case 'butterfly': {
        const fc = st.kind === 'butterfly' ? ['#c9a8ff', '#b890ff', '#d8c0ff'] : ['#ff8ab5', '#ffe066', '#ffffff', '#c9a8ff', '#ff9a6b'];
        for (let i = 0; i < 9; i++) {
          const fx = x - 60 + i * 15 + ((i * 7) % 9), fy = y - 10 - ((i * 13) % 20), h2 = 26 + ((i * 11) % 18);
          const sw = Math.sin(t * 1.5 + i) * 2;
          ctx.strokeStyle = '#4f9a45'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(fx, fy + 16); ctx.lineTo(fx + sw, fy - h2 + 16); ctx.stroke();
          ctx.fillStyle = fc[i % fc.length];
          if (st.kind === 'butterfly') { for (let k = 0; k < 4; k++) { ellipse(ctx, fx + sw, fy - h2 + 12 + k * 6, 4, 3.5); ctx.fill(); } }
          else { for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; ellipse(ctx, fx + sw + Math.cos(a) * 6, fy - h2 + 16 + Math.sin(a) * 6, 5, 5); ctx.fill(); } ctx.fillStyle = '#ffcf3f'; ellipse(ctx, fx + sw, fy - h2 + 16, 3.5, 3.5); ctx.fill(); }
        }
        break;
      }
      case 'bush': {
        ctx.fillStyle = 'rgba(60,40,30,0.15)'; ellipse(ctx, x, y + 4, 80, 12); ctx.fill();
        ctx.fillStyle = night ? '#2f5a3a' : '#5aa84a';
        for (const [dx, dy, r] of [[-45, -30, 38], [0, -52, 48], [45, -30, 40], [0, -22, 44]]) { ellipse(ctx, x + dx + shake * (dy / -40), y + dy, r, r * 0.85); ctx.fill(); }
        ctx.fillStyle = night ? '#3a6a45' : '#76c060'; ellipse(ctx, x - 10 + shake, y - 66, 24, 16); ctx.fill();
        ctx.fillStyle = '#e8505b'; for (const [dx, dy] of [[-40, -40], [25, -58], [48, -24], [-8, -20]]) { ellipse(ctx, x + dx + shake, y + dy, 4.5, 4.5); ctx.fill(); }
        break;
      }
      case 'bench': {
        ctx.fillStyle = 'rgba(60,40,30,0.15)'; ellipse(ctx, x, y + 4, 100, 10); ctx.fill();
        ctx.fillStyle = '#4a4f63'; for (const dx of [-70, 70]) { ctx.fillRect(x + dx - 4, y - 40, 8, 42); }
        ctx.fillStyle = night ? '#8a5a3a' : '#c08a5a';
        roundRect2(ctx, x - 95, y - 50, 190, 14, 4, ctx.fillStyle as string);
        roundRect2(ctx, x - 95, y - 92, 190, 12, 4, ctx.fillStyle as string);
        roundRect2(ctx, x - 95, y - 74, 190, 12, 4, ctx.fillStyle as string);
        ctx.fillStyle = '#4a4f63'; for (const dx of [-80, 80]) ctx.fillRect(x + dx - 3, y - 95, 6, 50);
        break;
      }
      case 'sound': {
        // an old tree with a hollow, a little off the path
        const tx = x + 150, ty = y - 76;
        ctx.fillStyle = '#8a5a3a';
        ctx.beginPath(); ctx.moveTo(tx - 30, ty); ctx.lineTo(tx - 20, ty - 190); ctx.lineTo(tx + 20, ty - 190); ctx.lineTo(tx + 30, ty); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3a2418'; ellipse(ctx, tx, ty - 110, 12, 16); ctx.fill();
        if (this.owl > 0) { ctx.fillStyle = '#ffe066'; ellipse(ctx, tx - 5, ty - 112, 3.5, 3.5); ctx.fill(); ellipse(ctx, tx + 5, ty - 112, 3.5, 3.5); ctx.fill(); }
        ctx.fillStyle = night ? '#2f5a3a' : '#5aa84a';
        for (const [dx, dy, r] of [[-50, -210, 56], [10, -250, 66], [60, -205, 54]]) { ellipse(ctx, tx + dx + shake, ty + dy, r, r * 0.85); ctx.fill(); }
        break;
      }
    }
  }
}

const an = (n: string) => (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + n;
function drawAt(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, size: number) { ctx.save(); ctx.translate(x, y); drawIcon(ctx, icon, size); ctx.restore(); }
function roundRect2(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}
function* until(pet: { dt: number }, cond: () => boolean, timeout: number): Gen { let t = 0; while (!cond() && t < timeout) { t += pet.dt; yield; } }
