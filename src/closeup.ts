// Close-up interaction stage: cuddles, hand-feeding, brushing, bath time, and trick training.
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait, walk, TRICK_ANIMS } from './pet/brain';
import { drawIcon } from './art';
import { foodDef, FOODS, PALETTES } from './data';
import { tasteFood, expectedFood, practiceTrick, trickSuccessChance, addJournal } from './memory';
import { chance, clamp, clamp01, dist, ellipse, rand, roundRect } from './util';

export type Sub = 'cuddle' | 'feed' | 'brush' | 'bath' | 'tricks';
type Tool = 'brush' | 'soap' | 'shower' | 'towel';

export class CloseUp {
  sub: Sub | null = null;
  food: { id: string; x: number; y: number; drag: boolean; bites: number; eating: boolean } | null = null;
  tool: { kind: Tool; x: number; y: number; drag: boolean; id: number } | null = null;
  bathStage = 0; // 0 soap, 1 rinse, 2 shake, 3 towel, 4 done
  bathOn = false;
  private progress = 0;
  private lastSound = 0;
  private brushRecent = -10;
  trick: { id: string; phase: 'listen' | 'doing' | 'reward' | 'fail' | 'idle'; t: number; ok: boolean; fails: number } = { id: '', phase: 'idle', t: 0, ok: false, fails: 0 };
  auto: { zone: string; t: number } | null = null;
  highFiveFlash = 0;
  private fluffyShown = false;

  constructor(public g: Game) {}

  open(sub: Sub) {
    const g = this.g;
    g.toys.clear();
    g.mode = 'closeup';
    this.setSub(sub);
    g.audio.open();
    g.pet.run(this.idleLoop(true), 'closeup', 2);
    if (sub === 'cuddle') g.hint('pet', `Stroke ${g.save.pet.name} with your finger or mouse!`);
    g.ui.refresh();
  }

  close() {
    const g = this.g;
    this.sub = null; this.food = null; this.tool = null; this.bathOn = false; this.auto = null;
    this.trick.phase = 'idle';
    g.mode = 'free';
    g.pet.o = {};
    g.pet.run((function* (): Gen { g.pet.body = 'stand'; g.pet.expr = 'happy'; yield* wait(g.pet, 0.6); })(), 'release', 1);
    g.ui.refresh();
  }

  setSub(sub: Sub) {
    const g = this.g;
    if (this.bathOn && sub !== 'bath') { this.bathOn = false; g.pet.o.foam = 0; g.pet.o.wet = 0; }
    this.sub = sub;
    this.food = null; this.tool = null; this.auto = null;
    this.trick.phase = 'idle';
    if (sub === 'brush') this.tool = { kind: 'brush', ...this.restPos(), drag: false, id: -1 };
    if (sub === 'bath') this.startBath();
    if (sub === 'feed') g.hint('feed', 'Pick a snack, then drag it to your pet\'s mouth (or tap your pet)!');
    if (sub === 'tricks') g.hint('tricks', 'Ask for a trick, then reward a good try with a treat!');
    if (g.pet.actionName !== 'closeup') g.pet.run(this.idleLoop(false), 'closeup', 2);
    g.ui.refresh();
  }

  private restPos() {
    const p = this.g.pet;
    return { x: p.x + 150 * p.depth, y: p.y - 70 };
  }

  /** The pet sits facing you, attentive, reacting to what's going on. */
  *idleLoop(settle: boolean): Gen {
    const g = this.g, pet = g.pet;
    pet.asleep = false;
    if (settle) {
      const b = g.world.zoneBounds(g.zone);
      const tx = clamp(pet.x, b.x0 + 140, b.x1 - 140), ty = Math.max(pet.y, 600);
      if (dist(pet.x, pet.y, tx, ty) > 10) { pet.expr = 'happy'; yield* walk(pet, tx, ty, 200, 3); }
      pet.expr = 'happy'; pet.jump(160); g.audio.voice('happy');
    }
    while (true) {
      pet.moving = false;
      pet.body = this.bathOn && this.bathStage === 2 ? 'stand' : 'sit';
      pet.o.front = 1; pet.lookCam = 1;
      if (this.sub === 'brush' && g.time - this.brushRecent < 0.5) { pet.expr = 'bliss'; g.brain.purr = 0.5; }
      else if (this.food) pet.expr = pet.expr ?? 'happy';
      else if (this.sub === 'tricks') pet.expr = 'focus';
      else pet.expr = null;
      if (this.food) pet.lookAt = { x: this.food.x, y: this.food.y };
      else if (this.tool?.drag) pet.lookAt = { x: this.tool.x, y: this.tool.y };
      else pet.lookAt = null;
      // occasional cute head tilt
      if (chance(pet.dt * 0.25)) pet.o.headTilt = rand(-0.3, 0.3);
      if (chance(pet.dt * 0.3)) pet.o.headTilt = 0;
      yield;
    }
  }

  // ---------- feeding ----------
  offerFood(id: string) {
    const g = this.g, pet = g.pet;
    const inv = g.save.inventory.foods;
    if (id !== 'kibble' && !(inv[id] > 0)) return;
    const [mx, my] = pet.mouthPos();
    this.food = { id, x: mx + 10 * pet.facing, y: my + 48, drag: false, bites: 0, eating: false };
    g.pet.run(this.anticipate(id), 'closeup', 2);
  }

  private *anticipate(id: string): Gen {
    const g = this.g, pet = g.pet;
    const exp = expectedFood(g.save.memory, id);
    const brave = g.save.pet.traits.brave;
    pet.lookAt = { x: this.food!.x, y: this.food!.y };
    if (exp === 'love') {
      pet.expr = 'starry'; pet.emote('heart'); g.audio.voice('excited');
      for (let i = 0; i < 2; i++) { pet.jump(200); yield* wait(pet, 0.4); }
      pet.o.paw = 0.8; pet.expr = 'excited';
    } else if (exp === 'like') {
      pet.expr = 'happy'; pet.o.tongue = 0.6; g.audio.voice('happy');
      yield* wait(pet, 0.6); pet.o.tongue = 0;
    } else if (exp === 'dislike') {
      pet.o.sniff = 1; pet.o.headDown = 0.3; g.audio.sniff();
      yield* wait(pet, 0.8);
      pet.o = {}; pet.expr = 'pout'; pet.o.headTilt = -0.35; pet.lookAt = { x: pet.x - 300 * pet.facing, y: pet.y - 200 };
      g.audio.voice('hmm');
      yield* wait(pet, 1.2);
    } else if (exp === 'unknown') {
      pet.expr = 'curious'; pet.emote('?');
      if (brave < 0.35) { pet.o.tilt = -0.12; yield* wait(pet, 0.8); pet.o.tilt = 0; }
      pet.o.sniff = 1; pet.o.headDown = 0.25; g.audio.sniff();
      yield* wait(pet, 1);
      pet.o.sniff = 0; pet.o.headDown = 0;
    } else {
      pet.expr = 'happy';
    }
    yield* this.idleLoop(false);
  }

  giveFood() {
    const f = this.food;
    if (!f || f.eating) return;
    f.eating = true;
    this.g.pet.run(this.eat(f.id), 'eating', 3);
  }

  private *eat(id: string): Gen {
    const g = this.g, pet = g.pet, s = g.save;
    const def = foodDef(id);
    if (id !== 'kibble') s.inventory.foods[id] = Math.max(0, (s.inventory.foods[id] ?? 0) - 1);
    const r = tasteFood(s.memory, s.pet.hidden, id);
    pet.o = {}; pet.body = 'sit'; pet.o.front = 1; pet.lookCam = 1;
    // lean in & bite
    const bites = r.reaction === 'dislike' ? 1 : 3;
    for (let i = 0; i < bites; i++) {
      pet.o.headDown = 0.35; pet.o.mouthOpen = 0.8;
      yield* wait(pet, 0.18);
      pet.o.mouthOpen = 0; pet.squash(0.15);
      if (this.food) this.food.bites = i + 1;
      g.audio.crunch(); g.fx.crumbs(...pet.mouthPos(), 3, id === 'kibble' ? '#c9853f' : '#ffd0a0');
      pet.o.headDown = 0; pet.expr = 'chew';
      let t = 0; while (t < 0.45) { t += pet.dt; pet.o.mouthOpen = Math.abs(Math.sin(t * 14)) * 0.35; yield; }
      pet.o.mouthOpen = 0;
    }
    this.food = null;
    const n = s.pet.needs;
    n.hunger = clamp01(n.hunger + def.hunger * (r.reaction === 'dislike' ? 0.3 : 1));
    n.fun = clamp01(n.fun + def.fun);
    g.bump('feeds');
    if (r.first) {
      g.bump('newthings');
      addJournal(s.memory, id, `Tried ${def.name} for the first time.`);
    }
    if (!s.flags.firstFeed) { s.flags.firstFeed = true; g.achieve('feed', 'First Snack'); }
    g.brain.fulfil('kibble');
    switch (r.reaction) {
      case 'love':
        pet.expr = 'starry'; g.audio.voice('excited'); g.fx.hearts(pet.x, pet.y - 180, 4);
        pet.jump(300); yield* wait(pet, 0.7);
        if (g.friendLevel >= 1) yield* TRICK_ANIMS.spin(pet);
        pet.o.front = 1; pet.expr = 'love'; pet.o.tongue = 0.7;
        g.addFriend('feed', 4);
        yield* wait(pet, 1);
        break;
      case 'like':
        pet.expr = 'happy'; g.audio.voice('happy'); pet.o.tailWag = 1; pet.o.tongue = 0.6;
        g.fx.hearts(...pet.headPos());
        g.addFriend('feed', 3);
        yield* wait(pet, 1.2);
        break;
      case 'neutral':
        pet.expr = 'neutral'; g.audio.voice('hmm');
        pet.o.headTilt = 0.15; yield* wait(pet, 0.4); pet.o.headTilt = -0.1; yield* wait(pet, 0.4);
        pet.expr = 'happy';
        g.addFriend('feed', 2);
        yield* wait(pet, 0.6);
        break;
      case 'dislike':
        pet.expr = 'yuck'; g.audio.voice('hmm'); pet.o.shake = 0.35;
        yield* wait(pet, 0.5);
        pet.o.shake = 0; pet.o.tongue = 1; pet.o.headTilt = -0.3;
        yield* wait(pet, 1.1);
        pet.o = {}; pet.expr = 'happy'; pet.o.blush = 0.8; pet.lookCam = 1; // no hard feelings
        g.addFriend('feed', 1);
        yield* wait(pet, 0.8);
        break;
    }
    if (r.newFavorite) g.discoverFood(id, 'fav');
    if (r.newDislike) g.discoverFood(id, 'dislike');
    g.ui.refresh();
    yield* this.idleLoop(false);
  }

  refillWater() {
    const g = this.g;
    g.save.room.water = 1;
    g.audio.splash();
    const [x, y] = g.world.poi('bowlWater');
    g.fx.drops(x, y - 30, 8, 120);
    g.brain.fulfil('water');
    g.toast('water', 'Fresh water!', 'water');
  }

  fillBowl() {
    const g = this.g;
    if (g.save.room.bowl > 0.9) { g.toast('bowl', 'The bowl is already full!', 'kibble'); return; }
    g.save.room.bowl = 1;
    g.audio.crunch();
    const [x, y] = g.world.poi('bowlFood');
    g.fx.crumbs(x, y - 40, 6);
    const req = g.brain.fulfil('kibble');
    const pet = g.pet;
    if ((g.save.pet.needs.hunger < 0.8 || req) && !pet.busy(2) && g.zone === 'room') {
      pet.stop(); g.brain.idle = 0;
      pet.expr = 'excited'; pet.emote('!');
      g.brain.cooldowns.eatBowl = 0;
    }
  }

  // ---------- bath ----------
  private startBath() {
    const g = this.g;
    this.bathOn = true; this.bathStage = 0; this.progress = 0;
    this.tool = { kind: 'soap', ...this.restPos(), drag: false, id: -1 };
    g.pet.o.foam = 0; g.pet.o.wet = 0.3;
    g.audio.splash();
    g.pet.jump(250);
    g.hint('bath', 'Scrub bubbles onto your pet!');
    const brave = g.save.pet.traits.brave;
    g.pet.expr = brave < 0.35 ? 'surprised' : 'joy';
  }

  private advanceBath() {
    const g = this.g, pet = g.pet;
    this.bathStage++;
    g.audio.chime();
    g.ui.refresh();
    if (this.bathStage === 1) { this.tool = { kind: 'shower', ...this.restPos(), drag: false, id: -1 }; g.hint('rinse', 'Now rinse off the bubbles!'); }
    if (this.bathStage === 2) {
      this.tool = null;
      pet.run((function* (cu: CloseUp): Gen {
        pet.expr = 'focus'; pet.o.front = 1;
        yield* wait(pet, 0.6);
        pet.o.shake = 1; g.audio.shake();
        for (let i = 0; i < 6; i++) { g.fx.drops(pet.x, pet.y - 100, 6, 380); yield* wait(pet, 0.15); }
        g.ui.splashScreen();
        pet.o.shake = 0; pet.o.wet = 0.6; pet.expr = 'joy'; g.audio.voice('giggle');
        yield* wait(pet, 0.6);
        cu.bathStage = 3; cu.tool = { kind: 'towel', ...cu.restPos(), drag: false, id: -1 };
        g.hint('towel', 'Dry off with the fluffy towel!');
        g.ui.refresh();
        yield* cu.idleLoop(false);
      })(this), 'closeup', 3);
    }
    if (this.bathStage === 4) {
      this.tool = null;
      const s = g.save;
      s.pet.needs.clean = 1;
      pet.o.wet = 0; pet.o.floof = 1;
      g.fx.sparkles(pet.x, pet.y - 110, 12, 90);
      g.bump('baths');
      g.addFriend('bath', 6);
      g.earn(3);
      if (!s.flags.firstBath) { s.flags.firstBath = true; addJournal(s.memory, 'bath', `First bath! ${s.pet.name} came out super fluffy.`); g.achieve('bath', 'Squeaky Clean'); }
      pet.run((function* (cu: CloseUp): Gen {
        pet.expr = 'starry'; pet.jump(260); g.audio.voice('excited');
        yield* wait(pet, 1.2);
        cu.bathOn = false; pet.o = {}; pet.o.floof = 1;
        cu.setSub('cuddle');
      })(this), 'closeup', 3);
    }
  }

  // ---------- tricks ----------
  startTrick(id: string) {
    const g = this.g;
    if (this.trick.phase !== 'idle' && this.trick.phase !== 'reward' && this.trick.phase !== 'fail') return;
    this.trick = { id, phase: 'listen', t: 0, ok: false, fails: this.trick.id === id ? this.trick.fails : 0 };
    g.pet.run(this.trickRun(id), 'closeup', 3);
    g.ui.refresh();
  }

  private *trickRun(id: string): Gen {
    const g = this.g, pet = g.pet, s = g.save;
    pet.o = {}; pet.body = 'sit'; pet.o.front = 1; pet.lookCam = 1;
    pet.expr = 'focus'; pet.o.earPerk = 1;
    pet.o.headTilt = 0.3;
    yield* wait(pet, 0.45 - s.pet.traits.energy * 0.2);
    pet.o.headTilt = -0.25;
    yield* wait(pet, 0.35);
    pet.o = {};
    const excite = g.brain.excitement;
    const p = trickSuccessChance(s.memory, id, excite) + this.trick.fails * 0.25 - (s.pet.needs.energy < 0.25 ? 0.15 : 0);
    const ok = Math.random() < p;
    this.trick.ok = ok; this.trick.phase = 'doing';
    if (ok) {
      yield* TRICK_ANIMS[id](pet);
      pet.o = {}; pet.body = 'sit'; pet.o.front = 1; pet.lookCam = 1; pet.expr = 'excited'; pet.o.tailWag = 1;
      this.trick.phase = 'reward'; this.trick.t = 0; this.trick.fails = 0;
      g.ui.refresh();
      let t = 0; while (this.trick.phase === 'reward' && t < 3) { t += pet.dt; yield; }
      if (this.trick.phase === 'reward') this.rewardTrick('none');
    } else {
      // a silly wrong answer
      this.trick.fails++;
      const oops = pick3();
      if (oops === 0) { pet.body = 'lie'; pet.expr = 'happy'; yield* wait(pet, 1.2); }
      else if (oops === 1) { pet.expr = 'curious'; pet.emote('?'); pet.o.headTilt = 0.45; yield* wait(pet, 1.2); }
      else { yield* TRICK_ANIMS.spin(pet); pet.expr = 'happy'; pet.emote('?'); yield* wait(pet, 0.6); }
      pet.o = {}; pet.body = 'sit';
      this.trick.phase = 'fail';
      g.ui.refresh();
    }
    yield* this.idleLoop(false);
  }

  rewardTrick(kind: 'treat' | 'praise' | 'none') {
    const g = this.g, s = g.save, pet = g.pet;
    if (this.trick.phase !== 'reward') return;
    this.trick.phase = 'idle';
    const id = this.trick.id;
    const gain = kind === 'treat' ? 1 : kind === 'praise' ? 0.75 : 0.35;
    const speed = s.pet.traits.playful * 0.5 + s.pet.traits.brave * 0.2 + 0.3 + g.friendLevel * 0.05;
    const learned = practiceTrick(s.memory, id, gain, speed);
    g.addFriend('trick', kind === 'none' ? 1 : 3);
    g.bump('tricks');
    if (kind !== 'none') {
      pet.run((function* (): Gen {
        if (kind === 'treat') {
          pet.o.headDown = 0.3; pet.o.mouthOpen = 0.7; yield* wait(pet, 0.2); pet.o = {}; pet.expr = 'chew'; g.audio.crunch();
          yield* wait(pet, 0.6);
        }
        pet.expr = 'joy'; g.fx.hearts(...pet.headPos()); g.audio.voice('happy');
        pet.o.front = 1; pet.body = 'sit';
        yield* wait(pet, 0.8);
      })(), 'closeup', 3);
      const cu = this;
      const orig = pet.action!;
      pet.action = (function* (): Gen { yield* orig; yield* cu.idleLoop(false); })();
    }
    if (learned) {
      const name = g.trickName(id);
      g.discover('star', `${s.pet.name} learned ${name.toUpperCase()}!`, 15);
      g.audio.fanfare();
      if (Object.values(s.memory.tricks).every((t) => t.learned)) g.achieve('alltricks', 'Trick Master');
      else g.achieve('trick1', 'First Trick');
    }
    g.ui.refresh();
  }

  autoPet(zone: string) { this.auto = { zone, t: 0 }; }
  private autoToolT = 0;
  /** Button-driven tool use (brush / bath stages) for players who can't drag precisely. */
  autoTool() { if (this.tool) this.autoToolT = 1.6; }

  // ---------- input ----------
  onDown(wx: number, wy: number, id: number): boolean {
    const g = this.g;
    if (this.food && !this.food.eating) {
      if (dist(wx, wy, this.food.x, this.food.y) < 70) { this.food.drag = true; return true; }
      if (g.pet.hitZone(wx, wy, 1.1)) { this.giveFood(); return true; }
    }
    if (this.tool) {
      this.tool.drag = true; this.tool.id = id;
      this.tool.x = wx; this.tool.y = wy;
      if (g.pet.hitZone(wx, wy, 1.2)) this.toolWork(wx, wy, 45);
      return true;
    }
    return false;
  }

  onMove(wx: number, wy: number, id: number) {
    if (this.food?.drag) {
      this.food.x = wx; this.food.y = wy;
      const [mx, my] = this.g.pet.mouthPos();
      if (dist(wx, wy, mx, my) < 55) { this.food.drag = false; this.giveFood(); }
    }
    const t = this.tool;
    if (t?.drag && t.id === id) {
      const d = dist(t.x, t.y, wx, wy);
      t.x = wx; t.y = wy;
      this.toolWork(wx, wy, d);
    }
  }

  onUp(id: number) {
    if (this.food?.drag) {
      this.food.drag = false;
      const [mx, my] = this.g.pet.mouthPos();
      if (dist(this.food.x, this.food.y, mx, my) < 90) this.giveFood();
    }
    if (this.tool && this.tool.id === id) { this.tool.drag = false; }
  }

  private toolWork(wx: number, wy: number, d: number) {
    const g = this.g, pet = g.pet, t = this.tool!;
    const over = pet.hitZone(wx, wy, 1.25);
    const now = g.time;
    if (t.kind === 'brush') {
      if (!over || d < 1) return;
      this.brushRecent = now;
      this.progress += d;
      const n = g.save.pet.needs;
      n.clean = clamp01(n.clean + d * 0.00012);
      n.affection = clamp01(n.affection + d * 0.00005);
      pet.o.floof = Math.min(1, (pet.o.floof ?? pet.pose.floof) + d * 0.0006);
      if (now - this.lastSound > 0.14) { this.lastSound = now; g.audio.brush(); g.fx.fur(wx, wy, PALETTES[g.save.pet.appearance.palette].main); if (chance(0.3)) g.fx.sparkles(wx, wy, 1, 10); }
      if (this.progress > 160) {
        this.progress = 0;
        g.addFriend('brush', 1.2);
        g.bump('brushes');
        g.brain.purr = 0.7;
      }
      if ((pet.o.floof ?? 0) >= 0.98 && !this.fluffyShown) {
        this.fluffyShown = true;
        g.toast('fluffy', 'SO FLUFFY!', 'sparkle');
        g.fx.sparkles(pet.x, pet.y - 100, 10, 80);
        if (!g.save.flags.firstBrush) { g.save.flags.firstBrush = true; addJournal(g.save.memory, 'brush', `Brushed ${g.save.pet.name} into a fluffy puffball!`); g.earn(3); }
      }
    } else if (t.kind === 'soap') {
      if (!over) return;
      pet.o.foam = Math.min(1, (pet.o.foam ?? 0) + d * 0.0006);
      if (now - this.lastSound > 0.12) { this.lastSound = now; g.audio.scrub(); g.fx.foam(wx, wy); }
      if (pet.o.foam > 0.3 && pet.expr === 'surprised') pet.expr = 'joy';
      if (chance(d * 0.0015)) this.floatBubble();
      if ((pet.o.foam ?? 0) >= 1 && this.bathStage === 0) this.advanceBath();
    } else if (t.kind === 'shower') {
      if (now - this.lastSound > 0.1) { this.lastSound = now; g.fx.drops(wx, wy + 20, 3, 40); if (chance(0.3)) g.audio.splash(); }
      if (Math.abs(wx - pet.x) < 120 * pet.depth && wy < pet.y) {
        pet.o.foam = Math.max(0, (pet.o.foam ?? 0) - d * 0.0008);
        pet.o.wet = Math.min(1, (pet.o.wet ?? 0) + d * 0.001);
        if (pet.o.foam <= 0.02 && this.bathStage === 1) this.advanceBath();
      }
    } else if (t.kind === 'towel') {
      if (!over) return;
      pet.o.wet = Math.max(0, (pet.o.wet ?? 0) - d * 0.0007);
      pet.expr = 'bliss';
      if (now - this.lastSound > 0.15) { this.lastSound = now; g.audio.brush(); }
      if (pet.o.wet <= 0.02 && this.bathStage === 3) this.advanceBath();
    }
  }

  private floatBubble() {
    const g = this.g, pet = g.pet;
    const [hx, hy] = pet.headPos();
    const b = g.toys.addBubble(hx + rand(-40, 40), hy - 60, rand(-15, 15), -25, false);
    if (!b || pet.actionName !== 'closeup') return;
    // the pet notices and boops it!
    pet.run((function* (cu: CloseUp): Gen {
      pet.lookAt = { x: b.x, y: b.y }; pet.expr = 'focus';
      let t = 0; while (t < 1.4 && b.on) { t += pet.dt; pet.lookAt = { x: b.x, y: b.y }; yield; }
      if (b.on) { pet.jump(220); yield* wait(pet, 0.15); g.toys.pop(b, true); pet.expr = 'joy'; g.audio.voice('giggle'); }
      yield* wait(pet, 0.5);
      yield* cu.idleLoop(false);
    })(this), 'closeup', 2);
  }

  update(dt: number) {
    const g = this.g;
    this.highFiveFlash = Math.max(0, this.highFiveFlash - dt);
    if (g.mode !== 'closeup') return;
    const pet = g.pet;
    if (!pet.action) pet.run(this.idleLoop(false), 'closeup', 2);
    // accessibility: auto-stroke a spot
    if (this.auto) {
      const a = this.auto;
      a.t += dt;
      const r = pet.rig, s = pet.depth;
      let lx = r.hx, ly = r.hy - r.R * 0.4;
      if (a.zone === 'ears') { lx = r.earN[0]; ly = r.earN[1]; }
      if (a.zone === 'cheeks') { lx = r.hx + r.R * 0.5; ly = r.hy + r.R * 0.4; }
      if (a.zone === 'back') { lx = r.bx - r.brx * 0.3; ly = r.by - r.bry * 0.6; }
      if (a.zone === 'belly') { lx = r.bx; ly = r.by + r.bry * 0.3; }
      const wx = pet.x + lx * s * pet.facing + Math.sin(a.t * 7) * 18, wy = pet.y + ly * s + Math.cos(a.t * 7) * 6;
      g.input.strokeAt(wx, wy, 5 + Math.abs(Math.cos(a.t * 7)) * 8);
      if (a.t > 2.2) this.auto = null;
    }
    // food follows the pet's mouth gently when not dragged
    if (this.food && !this.food.drag && !this.food.eating) {
      const [mx, my] = pet.mouthPos();
      this.food.x += (mx + 10 * pet.facing - this.food.x) * Math.min(1, dt * 3);
      this.food.y += (my + 48 - this.food.y) * Math.min(1, dt * 3);
    }
    if (this.autoToolT > 0 && this.tool) {
      this.autoToolT -= dt;
      const t = this.tool, a = g.time * 6;
      const cx = pet.x, cy = pet.y - 110 * pet.depth;
      const nx = cx + Math.cos(a) * 55 * pet.depth, ny = cy + Math.sin(a * 0.5) * 45 * pet.depth - (t.kind === 'shower' ? 60 : 0);
      const d = Math.hypot(nx - t.x, ny - t.y);
      t.x = nx; t.y = ny;
      this.toolWork(nx, ny, Math.min(d, 30));
      if (!this.tool) this.autoToolT = 0;
    } else if (this.tool && !this.tool.drag) {
      const r = this.restPos();
      this.tool.x += (r.x - this.tool.x) * Math.min(1, dt * 6);
      this.tool.y += (r.y - this.tool.y) * Math.min(1, dt * 6);
    }
  }

  // ---------- drawing ----------
  sortables(_items: unknown[]) { /* nothing */ }

  drawBehindPet(ctx: CanvasRenderingContext2D) {
    if (!this.bathOn) return;
    const p = this.g.pet, s = p.depth;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
    ellipse(ctx, 0, -78, 150, 30); ctx.fillStyle = '#d8eefc'; ctx.fill();
    ellipse(ctx, 0, -76, 132, 22); ctx.fillStyle = '#9fd4f5'; ctx.fill();
    ctx.restore();
  }

  drawOverPet(ctx: CanvasRenderingContext2D) {
    if (!this.bathOn) return;
    const p = this.g.pet, s = p.depth;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
    // water surface in front of the body
    ellipse(ctx, 0, -72, 132, 16); ctx.fillStyle = 'rgba(160,215,250,0.85)'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-150, -78); ctx.lineTo(150, -78);
    ctx.quadraticCurveTo(146, 20, 0, 22); ctx.quadraticCurveTo(-146, 20, -150, -78);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#8fb8de'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#ffd1e6';
    for (let i = 0; i < 5; i++) { ellipse(ctx, -90 + i * 45, -30 + (i % 2) * 18, 9, 9); ctx.fill(); }
    ctx.strokeStyle = '#d9a787'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-110, 18); ctx.lineTo(-122, 40); ctx.moveTo(110, 18); ctx.lineTo(122, 40); ctx.stroke();
    // bubbles on the rim
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = '#8fc4ea'; ctx.lineWidth = 2;
    const f = p.pose.foam;
    for (let i = 0; i < 7; i++) { const r = 10 + (i % 3) * 5 + f * 6; ellipse(ctx, -120 + i * 40, -80 - (i % 2) * 8, r, r); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  drawTop(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const z = 1 / g.cam.zoom;
    if (this.food) {
      const f = this.food;
      ctx.save(); ctx.translate(f.x, f.y);
      const sc = 1 - f.bites * 0.22;
      if (!f.drag && !f.eating) { ctx.save(); ctx.translate(14, 18); ctx.globalAlpha = 0.9; drawIcon(ctx, 'hand', 44); ctx.restore(); }
      ctx.scale(sc, sc);
      drawIcon(ctx, f.id, 56);
      ctx.restore();
    }
    if (this.tool) {
      const t = this.tool;
      ctx.save(); ctx.translate(t.x, t.y);
      const wob = t.drag ? Math.sin(g.time * 20) * 0.15 : 0;
      ctx.rotate(wob);
      drawIcon(ctx, t.kind, 64 * Math.max(0.8, z * 1.6));
      ctx.restore();
    }
    if (this.highFiveFlash > 0 || (this.trick.id === 'highfive' && this.trick.phase === 'doing' && g.pet.pose.paw > 0.6)) {
      const p = g.pet;
      const [hx, hy] = p.headPos();
      ctx.save();
      ctx.translate(hx + 70 * p.facing * p.depth, hy + 10 + (this.highFiveFlash > 0 ? 0 : -10));
      ctx.scale(-p.facing, 1);
      drawIcon(ctx, 'hand', 70);
      ctx.restore();
    }
    if (this.auto) {
      ctx.save(); ctx.globalAlpha = 0.9;
      ctx.translate(g.pointer.wx, g.pointer.wy);
      ctx.restore();
    }
  }
}

function pick3() { return Math.floor(Math.random() * 3); }
export { FOODS, roundRect };
