// Game orchestrator: owns the systems, camera, render pipeline, progression & persistence.
import { AudioManager } from './audio';
import { FX } from './fx';
import { Pet } from './pet/Pet';
import { Brain, wait, walk, wakeUp, digAt, TRICK_ANIMS } from './pet/brain';
import type { Gen } from './pet/Pet';
import { World, Zone, ROOM, GARDEN } from './world/world';
import { Toys } from './toys';
import { Interaction } from './interact';
import { CloseUp } from './closeup';
import { MiniGames } from './minigames';
import { UI } from './ui';
import { SaveData, writeSave, friendshipLevel, dayKey, applyOffline, TraitId } from './state';
import { COLLECTIBLES, FRIEND_LEVELS, FRIEND_UNLOCKS, foodDef, toyDef, SPOT_NAMES, PetSpot, TRICKS } from './data';
import { addJournal, bump, playToy, addRecent } from './memory';
import { clamp, damp, rand, chance, pick } from './util';

export type Mode = 'title' | 'adopt' | 'free' | 'closeup' | 'minigame';

const TRAIT_TEXT: Record<TraitId, [string, string, string]> = {
  energy: ['A champion napper who loves slow, cozy days.', 'Likes a good mix of play and naps.', 'A bouncy bundle of energy. Zoomies are life!'],
  brave: ['Careful and thoughtful — likes to sniff new things first.', 'Brave when it counts.', 'Fearless! Tries everything at least once.'],
  cuddly: ['An independent spirit (who secretly adores you).', 'Loves cuddles on their own terms.', 'A total cuddle bug!'],
  appetite: ['A picky little gourmet.', 'Enjoys a good snack.', 'A big foodie. Snacks are the best!'],
  playful: ['Calm and gentle, loves quiet games.', 'Always up for a little game.', 'Always, ALWAYS ready to play!'],
  curious: ['Loves familiar, cozy things.', 'Curious about the world.', 'A nosy little investigator.'],
};
const TRAIT_TITLE: Record<TraitId, string> = { energy: 'Energy', brave: 'Bravery', cuddly: 'Cuddliness', appetite: 'Appetite', playful: 'Playfulness', curious: 'Curiosity' };

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W = 800; H = 600; dpr = 1; base = 1;
  cam = { x: 500, y: 440, zoom: 1 };
  camT = { x: 500, y: 440, zoom: 1 };
  save!: SaveData;
  audio = new AudioManager();
  fx = new FX();
  world!: World;
  pet!: Pet;
  brain!: Brain;
  toys!: Toys;
  input!: Interaction;
  closeup!: CloseUp;
  mini!: MiniGames;
  ui!: UI;
  zone: Zone = 'room';
  mode: Mode = 'title';
  time = 0;
  pointer = { sx: 0, sy: 0, wx: 0, wy: 0, recent: false, lastMove: -10 };
  private recentGain: Record<string, number> = {};
  private saveT = 0;
  private running = true;
  private last = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  get settings() { return this.save.settings; }
  get friendLevel() { return friendshipLevel(this.save.pet.friendship, FRIEND_LEVELS); }
  get S() { return this.base * this.cam.zoom; }

  init(save: SaveData) {
    this.save = save;
    this.world = new World(this);
    this.pet = new Pet(this);
    this.brain = new Brain(this);
    this.toys = new Toys(this);
    this.input = new Interaction(this);
    this.closeup = new CloseUp(this);
    this.mini = new MiniGames(this);
    this.ui = new UI(this);
    this.applySettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.persist(); this.audio.suspend(true); }
      else { this.audio.suspend(false); this.last = performance.now(); }
    });
    window.addEventListener('pagehide', () => this.persist());
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Swap the active save (new game / continue). */
  load(save: SaveData) {
    this.save = save;
    this.zone = 'room';
    this.pet = new Pet(this);
    this.brain = new Brain(this);
    this.toys.clear();
    this.world.cacheKey = '';
    this.pet.x = 480; this.pet.y = 580;
    this.cam.x = this.camT.x = 500;
    this.applySettings();
    this.audio.voicePitch = { round: 1, sleek: 1.12, fluffy: 0.9 }[save.pet.appearance.body] ?? 1;
  }

  applySettings() {
    const s = this.save.settings;
    this.audio.setVolumes(s.music, s.sfx);
    this.fx.reduced = s.reducedMotion;
    document.documentElement.classList.toggle('hc', s.highContrast);
    document.documentElement.classList.toggle('big', s.largeText);
    document.documentElement.classList.toggle('reduced', s.reducedMotion);
    this.world.cacheKey = '';
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.base = Math.max(Math.min(this.H / 700, this.W / 520), this.H / 820);
  }

  persist() {
    if (this.mode === 'title' || this.mode === 'adopt') return;
    writeSave(this.save);
  }

  // ---------- main loop ----------
  private frame(t: number) {
    requestAnimationFrame((tt) => this.frame(tt));
    if (document.hidden) return;
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.update(dt);
    this.render();
  }

  private update(dt: number) {
    this.time += dt;
    if (this.time - this.pointer.lastMove > 1.5) this.pointer.recent = false;
    this.world.update(dt);
    if (this.mode !== 'title') {
      this.brain.update(dt);
      this.pet.update(dt);
      this.toys.update(dt);
      this.input.update(dt);
      this.closeup.update(dt);
      this.mini.update(dt);
    } else {
      this.pet.update(dt);
    }
    this.fx.update(dt);
    for (const k in this.recentGain) this.recentGain[k] *= Math.exp(-dt / 90);
    this.updateCamera(dt);
    if (this.mode === 'free' || this.mode === 'closeup' || this.mode === 'minigame') {
      this.save.playTime += dt;
      this.saveT += dt;
      if (this.saveT > 8) { this.saveT = 0; this.persist(); }
      if (Math.floor(this.save.playTime) % 30 === 0) this.checkTraitReveals();
    }
    this.audio.night = this.world.isNight();
    this.ui.update(dt);
  }

  frontPoint(): [number, number] {
    const b = this.world.zoneBounds(this.zone);
    const halfW = this.W / 2 / this.base;
    const x = clamp(this.camT.x, b.x0 + 60, b.x1 - 60);
    return [clamp(x + (halfW < 300 ? 0 : rand(-40, 40)), b.x0, b.x1), 645];
  }

  private updateCamera(dt: number) {
    const halfW = this.W / 2 / this.base;
    if (this.mode === 'closeup' || (this.mode === 'adopt' && this.ui.adoptStep !== 'meet')) {
      // frame the pet inside the part of the screen not covered by UI
      const a = this.ui.focusArea();
      const petH = 215 * this.pet.depth, petW = 300 * this.pet.depth;
      const S = Math.min((a.h * 0.8) / petH, (a.w * 0.85) / petW, this.base * 2.6);
      this.camT.zoom = Math.max(1, S / this.base);
      const Sz = this.base * this.camT.zoom;
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      this.camT.x = this.pet.x - (cx - this.W / 2) / Sz;
      this.camT.y = this.pet.y - 100 * this.pet.depth - (cy - this.H / 2) / Sz;
    } else {
      this.camT.zoom = 1;
      const zb = this.zone === 'room' ? ROOM : GARDEN;
      const w = zb.x1 - zb.x0;
      if (halfW * 2 >= w) this.camT.x = (zb.x0 + zb.x1) / 2;
      else {
        const follow = this.world.zoneOf(this.pet.x) === this.zone ? this.pet.x : this.camT.x;
        this.camT.x = clamp(follow, zb.x0 + halfW, zb.x1 - halfW);
      }
      const halfH = this.H / 2 / this.base;
      this.camT.y = 700 - halfH + 92 / this.base;
    }
    const r = this.settings.reducedMotion ? 10 : 4;
    this.cam.x = damp(this.cam.x, this.camT.x, r, dt);
    this.cam.y = damp(this.cam.y, this.camT.y, r, dt);
    this.cam.zoom = damp(this.cam.zoom, this.camT.zoom, r, dt);
  }

  toWorld(sx: number, sy: number): [number, number] {
    const S = this.S;
    return [this.cam.x + (sx - this.W / 2) / S, this.cam.y + (sy - this.H / 2) / S];
  }
  toScreen(wx: number, wy: number): [number, number] {
    const S = this.S;
    return [(wx - this.cam.x) * S + this.W / 2, (wy - this.cam.y) * S + this.H / 2];
  }

  private render() {
    const ctx = this.ctx;
    const S = this.S, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f3dcc6';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(d * S, 0, 0, d * S, d * (this.W / 2 - this.cam.x * S), d * (this.H / 2 - this.cam.y * S));
    const x0 = this.cam.x - this.W / 2 / S, x1 = this.cam.x + this.W / 2 / S;
    this.world.ensureCache(clamp(this.base * d, 0.75, 1.5));
    this.world.drawBack(ctx, x0, x1);
    // depth-sorted things
    const items: { y: number; draw: (c: CanvasRenderingContext2D) => void }[] = this.world.sortables();
    if (this.mode !== 'title' || this.ui.titleShowsPet) {
      items.push({ y: this.pet.y, draw: (c) => { this.closeup.drawBehindPet(c); this.pet.draw(c); this.closeup.drawOverPet(c); } });
    }
    this.closeup.sortables(items);
    const thr = this.toys.thr;
    if (thr && !thr.carried) items.push({ y: thr.y + 1, draw: () => {} });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw(ctx);
    this.toys.draw(ctx);
    this.world.drawFront(ctx, x0, x1);
    this.fx.draw(ctx);
    if (this.mode !== 'title') this.pet.drawBubbles(ctx);
    this.world.drawTint(ctx, x0, x1);
    this.closeup.drawTop(ctx);
    this.input.draw(ctx);
    this.mini.draw(ctx);
  }

  // ---------- zone switching ----------
  goZone(z: Zone) {
    if (z === this.zone) return;
    if (z === 'garden' && this.friendLevel < 1) { this.toast('outside', `${this.save.pet.name} isn't ready for the garden yet — play together to become Pals!`); return; }
    this.toys.clear();
    this.zone = z;
    this.audio.open();
    if (!this.pet.busy(2)) { this.pet.stop(); this.brain.idle = 0; }
    if (z === 'garden') {
      this.brain.fulfil('outside');
      if (!this.save.flags.visitedGarden) {
        this.save.flags.visitedGarden = true;
        addJournal(this.save.memory, 'outside', `First trip to the garden together!`);
        this.achieve('garden', 'Garden Explorer');
      }
    }
    this.ui.refresh();
  }

  // ---------- progression ----------
  addFriend(kind: string, amt: number) {
    const r = this.recentGain[kind] ?? 0;
    const gain = amt / (1 + r * 0.12);
    this.recentGain[kind] = r + amt;
    const before = this.friendLevel;
    this.save.pet.friendship += gain;
    const after = this.friendLevel;
    if (after > before) this.levelUp(after);
    this.ui.bumpFriend();
    // twinkles trickle from genuine play, with diminishing returns
    if (chance(Math.min(0.5, gain * 0.12))) this.earn(1);
  }

  private levelUp(lvl: number) {
    const name = this.save.pet.name;
    const L = FRIEND_LEVELS[lvl];
    this.audio.fanfare();
    this.ui.celebrate(`${name} is now your ${L.name}!`, FRIEND_UNLOCKS[lvl]);
    addJournal(this.save.memory, 'heart', `Became ${L.name}s!`);
    this.earn(10 + lvl * 5, true);
    this.fx.hearts(this.pet.x, this.pet.y - 160, 6);
    if (!this.pet.busy(3)) {
      this.pet.run((function* (pet: Pet): Gen {
        pet.lookCam = 1; pet.expr = 'starry';
        pet.jump(320);
        yield* wait(pet, 0.6);
        yield* TRICK_ANIMS.spin(pet);
        pet.expr = 'love'; pet.body = 'sit';
        yield* wait(pet, 1.5);
      })(this.pet), 'levelup', 2);
    }
    this.persist();
  }

  earn(n: number, big = false) {
    this.save.twinkles += n;
    this.ui.earn(n, big);
    if (big) this.audio.reward();
  }

  bump(key: string, n = 1) { return bump(this.save.memory, key, n); }

  toast(id: string, text: string, icon = 'sparkle') { this.ui.toast(text, icon); }

  hint(id: string, text: string) {
    if (this.save.flags['hint_' + id]) return;
    this.save.flags['hint_' + id] = true;
    this.ui.hint(text);
  }

  discover(icon: string, text: string, reward = 8) {
    addJournal(this.save.memory, icon, text);
    this.ui.discovery(text, icon);
    this.earn(reward, true);
    this.brain.excitement = 1;
    this.persist();
  }

  discoverFood(id: string, kind: 'fav' | 'dislike') {
    const n = this.save.pet.name, f = foodDef(id).name;
    if (kind === 'fav') this.discover(id, `${n} LOVES ${f}! It's their favorite food!`, 12);
    else this.discover(id, `${n} isn't a fan of ${f}. That's okay — everyone has tastes!`, 5);
  }

  discoverToy(id: string) {
    this.discover(id, `${this.save.pet.name}'s favorite toy is the ${toyDef(id).name}!`, 12);
  }

  discoverSpot(spot: string) {
    this.discover('heart', `${this.save.pet.name} adores ${SPOT_NAMES[spot as PetSpot]}!`, 10);
  }

  memoryToy(id: string) {
    const r = playToy(this.save.memory, this.save.pet.hidden, id);
    this.bump('play');
    this.observe('play');
    if (r.newFavorite && id !== 'ball' && id !== 'squeaky') this.discoverToy(id);
    return r;
  }
  private lastToyMem = 0;
  memoryToyThrottled(id: string) {
    if (this.time - this.lastToyMem < 3) return;
    this.lastToyMem = this.time;
    this.memoryToy(id);
  }

  observe(kind: string) {
    const c = this.bump('obs_' + kind);
    const first: Record<string, string> = {
      leaf: 'A leaf landed right on {n}\'s head!',
      butterfly: 'A butterfly landed on {n}\'s nose!',
      puddle: '{n} discovered puddle jumping!',
      keepaway: '{n} played keep-away with the ball. Cheeky!',
    };
    if (c === 1 && first[kind]) addJournal(this.save.memory, kind === 'puddle' ? 'water' : kind === 'keepaway' ? 'ball' : 'sparkle', first[kind].replace('{n}', this.save.pet.name));
    this.checkTraitReveals();
  }

  checkTraitReveals() {
    const m = this.save.memory, c = m.counters;
    const want: [TraitId, boolean][] = [
      ['cuddly', (c.pets ?? 0) >= 20],
      ['energy', this.save.playTime > 300],
      ['playful', (c.play ?? 0) >= 8],
      ['appetite', Object.keys(m.foods).length >= 4],
      ['brave', (c.newthings ?? 0) >= 3],
      ['curious', (c.obs_curious ?? 0) + (c.obs_butterfly ?? 0) >= 3],
    ];
    for (const [t, ok] of want) {
      if (!ok || m.traitsRevealed.includes(t)) continue;
      m.traitsRevealed.push(t);
      this.discover('sparkle', `Personality discovered — ${TRAIT_TITLE[t]}: ${this.traitText(t)}`, 6);
      return;
    }
  }

  traitText(t: TraitId) {
    const v = this.save.pet.traits[t];
    return TRAIT_TEXT[t][v < 0.36 ? 0 : v > 0.64 ? 2 : 1];
  }
  traitTitle(t: TraitId) { return TRAIT_TITLE[t]; }

  collect(id: string, x: number, y: number) {
    const m = this.save.memory;
    const first = !m.collect[id];
    m.collect[id] = (m.collect[id] ?? 0) + 1;
    this.fx.icon(x, y - 30, 'c:' + id);
    this.fx.sparkles(x, y - 30, 6);
    const c = COLLECTIBLES.find((q) => q.id === id)!;
    this.bump('treasures');
    if (first) this.discover('c:' + id, `Found a treasure: ${c.name}!`, 5);
    else { this.toast('c', `Found another ${c.name}!`, 'c:' + id); this.earn(2); }
    const kinds = Object.keys(m.collect).length;
    if (kinds >= 5) this.achieve('treasure5', 'Treasure Hunter');
    if (kinds >= COLLECTIBLES.length) this.achieve('treasureAll', 'Master Collector');
  }

  achieve(id: string, name: string) {
    if (this.save.achievements.includes(id)) return;
    this.save.achievements.push(id);
    addJournal(this.save.memory, 'trophy', `Achievement: ${name}`);
    this.toast('ach', `Achievement: ${name}!`, 'trophy');
    this.earn(10, true);
  }

  onHighFive() {
    const [hx, hy] = this.pet.headPos();
    this.audio.highfive();
    this.fx.stars(hx + 60 * this.pet.facing, hy + 20, 8);
    this.closeup.highFiveFlash = 0.6;
  }

  // ---------- session start ----------
  startSession(returning: boolean) {
    const s = this.save;
    const now = Date.now();
    const away = (now - s.lastSeen) / 1000;
    if (returning) applyOffline(s, away);
    const today = dayKey(now);
    const newDay = s.lastDay !== today;
    s.lastDay = today;
    this.mode = 'free';
    this.ui.refresh();
    if (returning && newDay) { this.bump('days'); }
    if (returning && away > 3600) {
      this.ui.banner(away > 86400 ? 'YOU\'RE BACK!' : 'Welcome back!');
      this.pet.run(this.greet(away > 86400 * 0.75 || newDay), 'greet', 3);
      addRecent(s.memory, 'greeted');
    } else if (returning) {
      this.pet.run(this.greet(false), 'greet', 3);
    }
    if (returning && newDay) this.earn(10, true);
    writeSave(s);
  }

  *greet(gift: boolean): Gen {
    const pet = this.pet;
    pet.x = 900; pet.y = 560; pet.body = 'stand';
    if (this.world.isNight() && pet.g.save.pet.needs.energy < 0.5) {
      pet.x = 150; pet.y = 560; pet.body = 'lie'; pet.asleep = true;
      yield* wait(pet, 1.5);
      pet.asleep = false; pet.o = {};
      pet.expr = 'surprised'; pet.emote('!');
      yield* wait(pet, 0.5);
      yield* wakeUp(pet);
    }
    pet.expr = 'excited'; pet.emote('!');
    this.audio.voice('excited');
    const [fx, fy] = this.frontPoint();
    yield* walk(pet, fx, fy, 320);
    pet.lookCam = 1;
    for (let i = 0; i < 3; i++) { pet.jump(280); this.fx.hearts(pet.x, pet.y - 170); yield* wait(pet, 0.45); }
    if (this.friendLevel >= 2) yield* TRICK_ANIMS.spin(pet);
    if (this.friendLevel >= 4) { yield* TRICK_ANIMS.rollover(pet); pet.expr = 'starry'; }
    pet.body = 'sit'; pet.expr = 'love'; pet.lookCam = 1;
    this.fx.hearts(pet.x, pet.y - 170, 4);
    yield* wait(pet, 1.2);
    if (gift) {
      const c = pick(COLLECTIBLES.filter((c) => c.weight >= 5));
      pet.held = 'c:' + c.id; pet.expr = 'happy';
      this.toast('gift', `${this.save.pet.name} saved a gift for you!`, 'c:' + c.id);
      yield* wait(pet, 1.2);
      pet.held = null;
      this.collect(c.id, pet.x + pet.facing * 40, pet.y - 20);
      yield* wait(pet, 1);
    }
  }

  /** Called when player taps floor/garden: pet comes over (personality-flavoured). */
  callPet(wx: number, wy: number) {
    if (this.pet.busy(1)) return;
    const pet = this.pet, tr = this.save.pet.traits;
    const b = this.world.zoneBounds(this.zone);
    const tx = clamp(wx, b.x0, b.x1), ty = clamp(wy, b.y0, b.y1);
    // tap a ready dig spot → dig there
    const dig = this.zone === 'garden' ? this.world.digs.find((d) => d.ready && Math.hypot(d.x - wx, d.y - wy) < 60) : null;
    if (dig) { this.pet.run(digAt(this.brain, dig.x, dig.y, false), 'dig', 1); this.bump('digs'); return; }
    this.brain.noteInteraction(0.05);
    this.pet.run((function* (g: Game): Gen {
      pet.lookAt = { x: tx, y: ty - 30 };
      pet.o.earPerk = 1;
      if (pet.asleep || pet.body === 'lie') { yield* wait(pet, 0.4); }
      yield* wait(pet, tr.cuddly < 0.3 ? 0.9 : 0.25);
      pet.expr = 'happy';
      yield* walk(pet, tx, ty, 150 + tr.energy * 80);
      pet.lookAt = null; pet.lookCam = 1;
      pet.body = 'sit';
      if (chance(0.4)) g.audio.voice('happy');
      yield* wait(pet, 1.5);
    })(this), 'called', 1);
  }

  trickName(id: string) { return TRICKS.find((t) => t.id === id)?.name ?? id; }
}
