// Two short activities: Bubble Party (pop bubbles together) and Treasure Sniff (hot/cold digging).
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait, walk, admire } from './pet/brain';
import { chance, clamp, dist, ellipse, lerp, rand, weighted } from './util';
import { FLOOR_BOT, FLOOR_TOP, GARDEN } from './world/world';
import { drawIcon } from './art';
import { addJournal } from './memory';
import { COLLECTIBLES } from './data';

export type MiniId = 'bubbles' | 'sniff';

// Treasure Sniff: how far (world units) the sniffed spot is from the buried treasure.
// Passing within NOTICE_R of it on the way makes the pet stop and point it out.
const FOUND_R = 75, NOTICE_R = 110, HOT_R = 210, WARM_R = 400;
type Heat = 0 | 1 | 2; // cold, warm, hot

export class MiniGames {
  id: MiniId | null = null;
  t = 0;
  dur = 40;
  score = 0;
  petScore = 0;
  tip = '';
  tipHeat = -1;
  private spawnT = 0;
  // --- Treasure Sniff ---
  /** The one treasure currently buried (a new one is hidden after each find). */
  treasure: { x: number; y: number } | null = null;
  /** intro: pet runs in (timer paused) · search: player taps, pet sniffs · dig: digging it up (timer paused) */
  phase: 'intro' | 'search' | 'dig' = 'search';
  private reacting = false;
  private walking = false;
  private queued: { x: number; y: number } | null = null;
  private marker: { x: number; y: number; t: number } | null = null;
  private heat = 0; // shown heat (0 cold … 2 hot), eased
  private heatT: Heat = 0;
  private holes: { x: number; y: number }[] = [];
  private popItem: { icon: string; x0: number; y0: number; t: number } | null = null;
  private taps = 0;
  /** The last treasure dug up this round (the pet shows it off at the end). */
  private lastFound: string | null = null;
  private hotIdle = 0;

  constructor(public g: Game) {}

  start(id: MiniId) {
    const g = this.g;
    if (id === 'sniff' && g.friendLevel < 1) return;
    if (g.mode === 'closeup') g.closeup.close();
    g.toys.clear();
    g.pet.held = null;
    this.id = id; this.t = 0; this.score = 0; this.petScore = 0; this.lastFound = null;
    g.mode = 'minigame';
    if (id === 'bubbles') {
      this.dur = 40;
      this.tip = 'Pop bubbles together! Gold = 5'; this.tipHeat = -1;
      g.toys.active = 'bubbles';
      g.toys.onBubblePop = (byPet, gold) => { const pts = gold ? 5 : 1; this.score += pts; if (byPet) this.petScore += pts; };
      g.pet.run(g.toys.playLoop(), 'toy', 2);
      g.audio.chime();
      g.ui.refresh();
      return;
    }
    this.dur = 60;
    this.phase = 'intro';
    this.reacting = false; this.walking = false; this.queued = null; this.marker = null; this.popItem = null;
    this.heat = 0; this.heatT = 0; this.holes = []; this.taps = 0; this.hotIdle = 0;
    this.say(`Tap the grass — ${g.save.pet.name} will sniff there!`, -1);
    if (g.zone !== 'garden') g.goZone('garden');
    const pet = g.pet;
    // your pet comes outside with you
    if (g.world.zoneOf(pet.x) !== 'garden') { pet.x = GARDEN.x0 + 20; pet.y = 600; pet.z = 0; }
    g.audio.chime();
    g.ui.refresh();
    this.treasure = null;
    this.bury(this.introSpot(), 600);
    pet.run(this.sniffIntro(), 'mini', 3);
  }

  end() {
    const g = this.g;
    if (!this.id) return;
    const id = this.id;
    this.id = null;
    g.toys.onBubblePop = null;
    g.toys.clear();
    g.mode = 'free';
    g.pet.stop();
    g.pet.held = null;
    this.treasure = null; this.queued = null; this.marker = null; this.popItem = null; this.holes = [];
    this.reacting = false; this.walking = false; this.phase = 'search';
    const m = g.save.memory;
    const key = id === 'bubbles' ? 'best_bubbles' : 'best_sniff';
    const best = m.counters[key] ?? 0;
    const newBest = this.score > best;
    if (newBest) m.counters[key] = this.score;
    const plays = g.bump('mini_' + id + '_' + new Date().toDateString());
    const reward = Math.max(1, Math.round((id === 'bubbles' ? Math.min(20, this.score / 2) : Math.min(30, this.score * 6)) / (plays > 3 ? 3 : 1)));
    g.earn(reward, true);
    g.addFriend('mini', 6);
    g.save.pet.needs.fun = Math.min(1, g.save.pet.needs.fun + 0.25);
    if (newBest && this.score > 0) addJournal(m, id === 'bubbles' ? 'bubbles' : 'dig', id === 'bubbles' ? `New Bubble Party record: ${this.score} pops!` : `Found ${this.score} treasures in Treasure Sniff!`);
    if (id === 'bubbles' && this.score >= 30) g.achieve('bubble30', 'Bubble Champion');
    g.ui.miniResult(id, this.score, reward, newBest, this.petScore);
    g.brain.st.mark('played', id);
    const found = id === 'sniff' ? this.lastFound : null, won = this.score > 0;
    g.pet.run((function* (): Gen {
      const pet = g.pet;
      pet.lookCam = 1; pet.expr = 'starry'; pet.jump(280);
      yield* wait(pet, 1.5);
      // proud of the haul: carries the last treasure around for a moment and admires it
      if (found) { pet.held = 'c:' + found; yield* admire(g.brain); pet.held = null; }
      // a pet that knows High Five offers one after a good game
      if (won && g.friendLevel >= 2 && chance(0.6)) yield* g.brain.offerHighFive();
    })(), 'mini', 1);
  }

  update(dt: number) {
    const g = this.g;
    if (!this.id || g.mode !== 'minigame') return;
    if (this.id === 'bubbles') {
      this.t += dt;
      if (this.t >= this.dur) { this.end(); return; }
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = rand(0.35, 0.7);
        const halfW = g.W / 2 / g.S;
        const x = clamp(g.cam.x + rand(-halfW * 0.8, halfW * 0.8), g.cam.x - halfW + 40, g.cam.x + halfW - 40);
        g.toys.addBubble(x, 700, rand(-20, 20), rand(-90, -60), chance(0.08));
      }
      if (g.pet.actionName !== 'toy') g.pet.run(g.toys.playLoop(), 'toy', 2);
      return;
    }
    // ---- Treasure Sniff ----
    const pet = g.pet;
    // safety net: if something else took over the pet mid-intro/dig, carry on searching
    if (this.phase !== 'search' && pet.actionName !== 'mini') { this.phase = 'search'; this.reacting = false; this.walking = false; this.popItem = null; pet.held = null; }
    if (!pet.action) { this.walking = false; this.reacting = false; }
    if (this.phase === 'search') {
      this.t += dt; // the clock only runs while searching (never while digging or celebrating)
      if (this.t >= this.dur) { this.end(); return; }
    }
    if (!pet.action) pet.run(this.waitLoop(), 'mini', 3);
    this.heat += (this.heatT - this.heat) * Math.min(1, dt * 4);
    if (this.marker) { this.marker.t -= dt; if (this.marker.t <= 0) this.marker = null; }
    if (this.popItem) this.popItem.t += dt;
  }

  /** Pointer down on the canvas during an activity. Returns true when handled. */
  onDown(wx: number, wy: number): boolean {
    const g = this.g;
    if (this.id === 'bubbles') return g.toys.onDown(wx, wy, 99);
    if (this.id !== 'sniff') return false;
    if (this.phase === 'dig') return true; // busy digging: nothing to do yet
    const [x, y] = this.clampSpot(wx, wy);
    this.marker = { x, y, t: 2.2 };
    this.taps++;
    g.audio.pop();
    // mid-sniff (or mid-trot): remember the newest spot; the pet heads there as soon as it can
    if (this.phase === 'intro' || this.reacting || this.walking) this.queued = { x, y };
    else g.pet.run(this.sniffAt(x, y), 'mini', 3);
    return true;
  }
  onMove(wx: number, wy: number) { if (this.id === 'bubbles') this.g.toys.onMove(wx, wy, 99); }

  // ---------- Treasure Sniff: places ----------

  /** Rows of the garden that are on screen, clear of the HUD at the top and the screen edge below. */
  private safeRows(): [number, number] {
    const g = this.g;
    const toWy = (sy: number) => g.freeCamY() + (sy - g.H / 2) / g.base;
    const hud = g.ui.miniHud.getBoundingClientRect();
    const y0 = Math.max(FLOOR_TOP + 50, toWy((hud.height ? hud.bottom : 0) + 40));
    const y1 = Math.min(FLOOR_BOT - 40, toWy(g.H - 56));
    return y1 - y0 >= 40 ? [y0, y1] : [(y0 + y1) / 2 - 20, (y0 + y1) / 2 + 20];
  }

  /** Where a tap sends the pet: always somewhere on the grass it can reach. */
  private clampSpot(wx: number, wy: number): [number, number] {
    const [y0, y1] = this.safeRows();
    return [clamp(wx, GARDEN.x0 + 90, GARDEN.x1 - 70), clamp(wy, y0 - 25, y1 + 15)];
  }

  /** Where the pet runs to first: the middle of the garden if it all fits on screen, else near the door. */
  private introSpot() {
    const halfW = this.g.W / 2 / this.g.base;
    return halfW * 2 >= GARDEN.x1 - GARDEN.x0 ? (GARDEN.x0 + GARDEN.x1) / 2 : GARDEN.x0 + 260;
  }

  /** Bury the next treasure: reachable, clear of the HUD and of the puddle/flowers/tree, not under the pet. */
  private bury(fromX: number, fromY: number) {
    const w = this.g.world;
    const [y0, y1] = this.safeRows();
    const avoid: [number, number, number][] = [[...w.poi('puddle'), 110], [...w.poi('flowers'), 90], [...w.poi('decor'), 80], [1840, 505, 90]];
    let spot: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const x = rand(GARDEN.x0 + 150, GARDEN.x1 - 110), y = rand(y0, y1);
      const d = dist(x, y, fromX, fromY);
      if (d < 280 || d > 760) continue;
      if (avoid.some(([ax, ay, r]) => dist(x, y, ax, ay) < r)) continue;
      if (this.holes.some((h) => dist(x, y, h.x, h.y) < 120)) continue;
      spot = { x, y };
    }
    this.treasure = spot ?? { x: fromX < (GARDEN.x0 + GARDEN.x1) / 2 ? GARDEN.x1 - 200 : GARDEN.x0 + 250, y: (y0 + y1) / 2 };
  }

  private heatAt(x: number, y: number): Heat {
    const tr = this.treasure;
    if (!tr) return 0;
    const d = dist(x, y, tr.x, tr.y);
    return d < HOT_R ? 2 : d < WARM_R ? 1 : 0;
  }

  private say(text: string, heat: number) {
    this.tip = text; this.tipHeat = heat;
    this.g.ui.miniHint(text, heat);
  }

  // ---------- Treasure Sniff: the pet ----------

  private *sniffIntro(): Gen {
    const g = this.g, pet = g.pet;
    pet.body = 'stand'; pet.expr = 'excited'; pet.o.tailWag = 1;
    yield* walk(pet, this.introSpot(), 585, 250, 6);
    // sniff the air: "there's something buried out here!"
    pet.body = 'sit'; pet.lookCam = 1; pet.expr = 'focus'; pet.o.earPerk = 1; pet.o.tailWag = 0.6;
    for (let i = 0; i < 3; i++) { pet.o.sniff = 1; g.audio.sniff(); yield* wait(pet, 0.3); }
    pet.o.sniff = 0; pet.emote('!'); pet.expr = 'excited'; pet.o.tailWag = 1.3; g.audio.voice('excited');
    pet.jump(230);
    yield* wait(pet, 0.8);
    pet.body = 'stand';
    this.phase = 'search';
    const q = this.queued;
    if (q) { this.queued = null; yield* this.sniffAt(q.x, q.y); }
  }

  /** Waiting for the next tap: the pet keeps "reading" the air, more eagerly the closer it is. */
  private *waitLoop(): Gen {
    const g = this.g, pet = g.pet;
    let t = 0, next = rand(0.6, 1.2), sniffUntil = 0;
    this.hotIdle = 0;
    while (true) {
      t += pet.dt;
      const tr = this.treasure;
      const heat = this.heatAt(pet.mouthPos()[0], pet.y);
      this.heatT = heat;
      pet.o = { tailWag: [0.3, 0.9, 1.4][heat], earPerk: [0, 0.5, 1][heat], tailUp: [0.45, 0.8, 1][heat], sniff: t < sniffUntil ? 1 : 0 };
      pet.expr = heat === 2 ? 'excited' : heat === 1 ? 'happy' : null;
      pet.body = heat === 2 ? 'bow' : 'stand';
      if (tr) pet.faceToward(tr.x); // the body always points toward the smell…
      if (tr && heat > 0) { pet.lookAt = { x: tr.x, y: tr.y - 10 }; pet.lookCam = 0; }
      else { pet.lookAt = null; pet.lookCam = 0.5; } // …but when it's faint, it looks to you for help
      if (heat === 2 && tr) {
        // so close it can't sit still: paws at the ground toward the spot
        pet.o.paw = Math.abs(Math.sin(t * 9)) * 0.8;
        this.hotIdle += pet.dt;
        if (this.hotIdle > 6) { yield* this.digUp(); return; } // can't wait any longer!
      }
      if (t > next) {
        next = t + [2.2, 1.4, 0.7][heat];
        sniffUntil = t + 0.35;
        g.audio.sniff();
        if (heat === 0 && chance(0.4)) pet.emote('?', 1);
      }
      yield;
    }
  }

  /** Trot to the tapped spot (nose down), sniff it, and show how close the treasure is. */
  private *sniffAt(tx: number, ty: number): Gen {
    const g = this.g, pet = g.pet, name = g.save.pet.name;
    const tr = this.treasure;
    if (!tr) return;
    this.reacting = false;
    this.hotIdle = 0;
    pet.body = 'stand'; pet.expr = 'focus'; pet.lookCam = 0; pet.lookAt = null;
    pet.o = { headDown: 0.3, sniff: 0.7, earPerk: 0.3, tailWag: 0.6 };
    let x = tx, y = ty;
    pet.moveTo(x, y, 250);
    let t = 0, since = 0, walked = 0;
    // only a *new* whiff counts: if it was already standing near the treasure, the player chose to leave
    const startNear = dist(pet.mouthPos()[0], pet.y, tr.x, tr.y) < NOTICE_R;
    this.walking = true;
    while (pet.moving && t < 9) {
      t += pet.dt; since += pet.dt; walked += pet.dt;
      // changed their mind right away? head for the newest tap instead (a few times a second at most).
      // Later taps wait until this spot has been sniffed, so every trip ends with a clue.
      const q = this.queued;
      if (q && since > 0.3 && walked < 0.9) { this.queued = null; x = q.x; y = q.y; pet.moveTo(x, y, 250); since = 0; t = 0; }
      const [nx] = pet.mouthPos();
      const heat = this.heatAt(nx, pet.y);
      this.heatT = heat;
      pet.o.tailWag = [0.5, 0.9, 1.3][heat];
      pet.o.earPerk = [0.2, 0.6, 1][heat];
      // caught a strong whiff on the way: stop right here and show it
      if (!startNear && dist(nx, pet.y, tr.x, tr.y) < NOTICE_R && dist(x, y, tr.x, tr.y) >= FOUND_R) { x = pet.x; y = pet.y; break; }
      yield;
    }
    this.walking = false;
    pet.moving = false;
    // sniff sniff…
    this.reacting = true;
    const d = dist(x, y, tr.x, tr.y);
    const heat: Heat = d < HOT_R ? 2 : d < WARM_R ? 1 : 0;
    this.heatT = heat;
    pet.o = { headDown: 0.85, sniff: 1, earPerk: [0, 0.5, 1][heat], tailWag: [0.3, 0.8, 1.2][heat] };
    const n = d < FOUND_R ? 5 : [2, 3, 4][heat];
    for (let i = 0; i < n; i++) { g.audio.sniff(); yield* wait(pet, d < FOUND_R ? 0.1 : [0.3, 0.22, 0.14][heat]); }
    if (d < FOUND_R) { yield* this.digUp(); return; }
    if (heat === 2) {
      // HOT: bounces, fast sniffing, follows its nose closer and paws at the ground
      pet.o = { earPerk: 1, tailWag: 1.5, tailUp: 1 };
      pet.expr = 'excited'; pet.faceToward(tr.x); pet.lookAt = { x: tr.x, y: tr.y };
      pet.emote('!'); g.audio.voice('excited');
      this.say(`So close! Tap the wiggly spot!`, 2);
      pet.jump(200); yield* wait(pet, 0.45); pet.jump(170); yield* wait(pet, 0.45);
      pet.o.headDown = 0.55; pet.o.sniff = 1;
      yield* walk(pet, lerp(pet.x, tr.x, 0.45), lerp(pet.y, tr.y, 0.45), 170, 1.4);
      pet.faceToward(tr.x);
      this.reacting = false;
    } else if (heat === 1) {
      // WARM: happy wag, turns and points its nose toward the smell, a few steps that way
      pet.o = { earPerk: 0.6, tailWag: 0.9, tailUp: 0.8 };
      pet.expr = 'happy'; pet.faceToward(tr.x); pet.lookAt = { x: tr.x, y: tr.y - 10 };
      pet.emote('note'); g.audio.voice('happy');
      this.say(`Warmer! Follow ${name}'s nose…`, 1);
      pet.o.bow = 0.4; pet.o.sniff = 1;
      for (let i = 0; i < 2; i++) { g.audio.sniff(); if (yield* this.waitOrTap(0.3)) break; }
      pet.o.bow = 0;
      yield* walk(pet, lerp(pet.x, tr.x, 0.18), lerp(pet.y, tr.y, 0.18), 140, 1);
      pet.faceToward(tr.x);
      this.reacting = false;
    } else {
      // COLD: a puzzled shrug and a look around, but it turns toward the faint smell before shrugging
      const dir = Math.sign(tr.x - pet.x) || pet.facing;
      pet.face(dir);
      pet.o = { earPerk: -0.25, tailWag: 0.15, tailUp: 0.35, headTilt: 0.3 };
      pet.expr = 'curious'; pet.emote('?'); g.audio.voice('hmm');
      this.say(this.taps <= 2 ? `Nothing here… follow ${name}'s nose!` : 'Brrr, cold!', 0);
      pet.lookAt = { x: pet.x + dir * 90, y: pet.y - 160 };
      if (!(yield* this.waitOrTap(0.5))) {
        pet.o.headTilt = -0.25;
        pet.lookAt = { x: pet.x + dir * 260, y: pet.y - 40 };
        if (!(yield* this.waitOrTap(0.5))) {
          if (chance(0.25)) { g.audio.sneeze(); pet.squash(0.4); }
          pet.o.headTilt = 0; pet.lookAt = { x: tr.x, y: tr.y - 40 };
        }
      }
      this.reacting = false;
    }
    const q = this.queued;
    if (q) { this.queued = null; yield* this.sniffAt(q.x, q.y); }
  }

  /** Wait, but stop early (after a moment) if the player already tapped somewhere new. */
  private *waitOrTap(s: number): Generator<void, boolean, void> {
    let t = 0;
    while (t < s) { t += this.g.pet.dt; if (this.queued && t > 0.15) return true; yield; }
    return !!this.queued;
  }

  /** Found it! Dig, reveal the treasure, celebrate, then catch the scent of the next one. */
  private *digUp(): Gen {
    const g = this.g, pet = g.pet, tr = this.treasure;
    if (!tr) return;
    this.phase = 'dig'; this.reacting = true; this.queued = null; this.marker = null; this.heatT = 2;
    pet.o = { earPerk: 1, tailWag: 1.6, tailUp: 1 };
    pet.lookCam = 0; pet.expr = 'excited'; pet.emote('!'); g.audio.voice('excited');
    this.say('Found the spot! Dig, dig, dig!', 3);
    // stand beside the spot with the nose right over it
    const sx = pet.x <= tr.x ? -1 : 1;
    yield* walk(pet, tr.x + sx * 50, tr.y + 3, 210, 3);
    pet.face(-sx); pet.lookAt = { x: tr.x, y: tr.y };
    pet.o.headDown = 0.9; pet.o.sniff = 1;
    for (let i = 0; i < 4; i++) { g.audio.sniff(); yield* wait(pet, 0.1); }
    pet.o.sniff = 0; pet.o.headDown = 0.5; pet.body = 'bow';
    this.holes.push({ x: tr.x, y: tr.y });
    let t = 0, nt = 0;
    while (t < 1.5) {
      t += pet.dt;
      pet.o.paw = Math.abs(Math.sin(t * 16));
      if (t > nt) { nt = t + 0.16; g.fx.dirt(tr.x, tr.y - 4, 3); g.audio.dig(); }
      yield;
    }
    // the treasure pops out of the ground and into the pet's mouth
    const c = weighted(COLLECTIBLES.map((q) => ({ item: q, w: q.weight })))!;
    this.score++;
    this.treasure = null; this.heatT = 0;
    g.fx.stars(tr.x, tr.y - 16, 10); g.fx.sparkles(tr.x, tr.y - 30, 8, 50);
    g.audio.reward();
    this.popItem = { icon: 'c:' + c.id, x0: tr.x, y0: tr.y - 10, t: 0 };
    pet.o = { tailWag: 1.6, tailUp: 1, earPerk: 1 };
    pet.body = 'sit'; pet.lookAt = null; pet.lookCam = 1; pet.expr = 'starry';
    yield* wait(pet, 0.55);
    this.popItem = null;
    pet.held = 'c:' + c.id;
    pet.jump(260); g.audio.voice('excited');
    g.collect(c.id, pet.x + pet.facing * 30, pet.y - 70);
    this.lastFound = c.id;
    g.brain.st.mark('treasure', c.id);
    this.say(`${g.save.pet.name} found ${/^[aeiou]/i.test(c.name) ? 'an' : 'a'} ${c.name}! Sniff out another!`, 3);
    yield* wait(pet, 1.3);
    pet.held = null;
    // …and there's another smell out there
    this.bury(pet.x, pet.y);
    pet.expr = 'focus'; pet.body = 'stand'; pet.lookCam = 0.4; pet.o = { sniff: 1, earPerk: 1, tailWag: 0.8 };
    g.audio.sniff(); yield* wait(pet, 0.3); g.audio.sniff(); yield* wait(pet, 0.3);
    const nt2 = this.treasure as { x: number; y: number } | null;
    if (nt2) { pet.faceToward(nt2.x); pet.lookAt = { x: nt2.x, y: nt2.y - 30 }; pet.emote('!', 1); }
    pet.o = { tailWag: 1, earPerk: 0.6 };
    pet.expr = 'excited';
    this.phase = 'search'; this.reacting = false;
    yield* wait(pet, 0.5);
  }

  // ---------- drawing ----------

  /** Ground layer (under the pet): dug holes, and the soil stirring over a treasure the pet is very close to. */
  drawGround(ctx: CanvasRenderingContext2D) {
    if (this.id !== 'sniff') return;
    for (const h of this.holes) {
      ctx.fillStyle = '#8a6040'; ellipse(ctx, h.x, h.y, 34, 11); ctx.fill();
      ctx.fillStyle = '#5e3f28'; ellipse(ctx, h.x, h.y + 1, 22, 6); ctx.fill();
      ctx.fillStyle = '#a8784a'; ellipse(ctx, h.x + 30, h.y - 3, 14, 7); ctx.fill();
    }
    const tr = this.treasure;
    if (tr && this.heat > 1.2 && this.phase === 'search') {
      // the ground wiggles where it's buried
      const a = Math.min(1, (this.heat - 1.2) / 0.6), t = this.g.time;
      const bump = Math.max(0, Math.sin(t * 5)) * 3;
      ctx.save();
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#9a7048'; ellipse(ctx, tr.x, tr.y, 20, 6); ctx.fill();
      ctx.fillStyle = '#b8895a'; ellipse(ctx, tr.x, tr.y - 2 - bump, 13, 5 + bump * 0.4); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const ph = (t * 1.6 + i / 3) % 1;
        ctx.fillStyle = i % 2 ? '#8a5f3a' : '#a8784a';
        ellipse(ctx, tr.x + (i - 1) * 12, tr.y - 4 - Math.sin(ph * Math.PI) * 12, 3, 3); ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Top layer: tap marker, the scent wafting to the pet's nose, the treasure popping out, a first-time tap hint. */
  draw(ctx: CanvasRenderingContext2D) {
    if (this.id === 'sniff') {
      const g = this.g, pet = g.pet, tr = this.treasure, t = g.time;
      // scent wisps drifting toward the nose (from the treasure's direction) when warm or hot
      if (tr && this.heat > 0.4 && this.phase !== 'dig') {
        const [nx, ny] = pet.mouthPos();
        let dx = tr.x - nx, dy = (tr.y - 30) - ny;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const reach = Math.min(l, 70 + this.heat * 45);
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.9 + i / 3) % 1; // travels toward the nose
          const along = reach * (1 - ph);
          const a = Math.sin(ph * Math.PI) * Math.min(1, this.heat - 0.3) * 0.75;
          const off = (i - 1) * 14;
          const cx = nx + dx * along - dy * off, cy = ny + dy * along + dx * off;
          ctx.globalAlpha = a;
          ctx.beginPath();
          for (let k = 0; k <= 8; k++) {
            const s = (k / 8 - 0.5) * 40, w = Math.sin(k * 1.4 + t * 6 + i) * 6;
            const px = cx + dx * s - dy * w, py = cy + dy * s + dx * w;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = 'rgba(110,90,60,0.35)'; ctx.lineWidth = 8; ctx.stroke();
          ctx.strokeStyle = '#fffdf2'; ctx.lineWidth = 4; ctx.stroke();
        }
        ctx.restore();
      }
      if (this.popItem) {
        // arc from the hole up to the pet's mouth
        const p = this.popItem, k = Math.min(1, p.t / 0.55);
        const [mx, my] = pet.mouthPos();
        const x = lerp(p.x0, mx, k), y = lerp(p.y0, my, k) - Math.sin(k * Math.PI) * 90;
        ctx.save(); ctx.translate(x, y); ctx.rotate(k * 6.3); drawIcon(ctx, p.icon, 40 + Math.sin(k * Math.PI) * 14); ctx.restore();
      }
      // first time: show where to tap (until the player does)
      if (this.taps === 0 && g.save.memory.counters.best_sniff === undefined && (this.phase === 'search' || pet.body === 'sit')) {
        const hx = clamp(pet.x + pet.facing * 170, GARDEN.x0 + 90, GARDEN.x1 - 70), hy = clamp(pet.y + 30, FLOOR_TOP + 60, FLOOR_BOT - 30);
        const k = (t * 1.2) % 1;
        ctx.save();
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
        ellipse(ctx, hx, hy, 14 + k * 30, (14 + k * 30) * 0.35); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.translate(hx + 6, hy - 22 - Math.abs(Math.sin(t * 4)) * 10);
        drawIcon(ctx, 'hand', 44);
        ctx.restore();
      }
    }
    if (this.marker) {
      const m = this.marker, k = 1 - Math.min(1, m.t / 2.2);
      ctx.save();
      ctx.globalAlpha = Math.min(1, m.t * 2) * 0.9;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ellipse(ctx, m.x, m.y, 16 + k * 26, (16 + k * 26) * 0.35); ctx.stroke();
      ctx.translate(m.x, m.y - 12);
      drawIcon(ctx, 'paw', 34);
      ctx.restore();
    }
  }
}
