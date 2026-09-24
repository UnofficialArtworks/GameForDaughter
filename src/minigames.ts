// Two short activities: Bubble Party (pop bubbles together) and Treasure Sniff (hot/cold digging).
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait, walk, digAt } from './pet/brain';
import { chance, clamp, dist, rand } from './util';
import { FLOOR_TOP } from './world/world';
import { drawIcon } from './art';
import { addJournal } from './memory';

export type MiniId = 'bubbles' | 'sniff';

export class MiniGames {
  id: MiniId | null = null;
  t = 0;
  dur = 40;
  score = 0;
  petScore = 0;
  private spawnT = 0;
  private hidden: { x: number; y: number; found: boolean }[] = [];
  private marker: { x: number; y: number; t: number } | null = null;
  private busy = false;

  constructor(public g: Game) {}

  start(id: MiniId) {
    const g = this.g;
    if (g.mode === 'closeup') g.closeup.close();
    g.toys.clear();
    this.id = id; this.t = 0; this.score = 0; this.petScore = 0; this.busy = false;
    g.mode = 'minigame';
    if (id === 'bubbles') {
      this.dur = 40;
      g.toys.active = 'bubbles';
      g.toys.onBubblePop = (byPet, gold) => { const pts = gold ? 5 : 1; this.score += pts; if (byPet) this.petScore += pts; };
      g.pet.run(g.toys.playLoop(), 'toy', 2);
    } else {
      this.dur = 60;
      if (g.zone !== 'garden') g.goZone('garden');
      this.hidden = [];
      const b = g.world.zoneBounds('garden');
      for (let i = 0; i < 3; i++) this.hidden.push({ x: rand(b.x0 + 60, b.x1 - 60), y: rand(b.y0 + 20, b.y1 - 10), found: false });
      g.pet.run(this.sniffIntro(), 'mini', 2);
    }
    g.audio.chime();
    g.ui.refresh();
  }

  private *sniffIntro(): Gen {
    const pet = this.g.pet;
    pet.lookCam = 1; pet.body = 'sit'; pet.expr = 'focus'; pet.o.sniff = 1;
    this.g.audio.sniff();
    yield* wait(pet, 1.2);
    pet.o = {}; pet.expr = 'excited';
    yield* wait(pet, 0.5);
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
    const m = g.save.memory;
    const key = id === 'bubbles' ? 'best_bubbles' : 'best_sniff';
    const best = m.counters[key] ?? 0;
    const newBest = this.score > best;
    if (newBest) m.counters[key] = this.score;
    const plays = g.bump('mini_' + id + '_' + new Date().toDateString());
    const reward = Math.max(1, Math.round((id === 'bubbles' ? Math.min(20, this.score / 2) : this.score * 6) / (plays > 3 ? 3 : 1)));
    g.earn(reward, true);
    g.addFriend('mini', 6);
    g.save.pet.needs.fun = Math.min(1, g.save.pet.needs.fun + 0.25);
    if (newBest && this.score > 0) addJournal(m, id === 'bubbles' ? 'bubbles' : 'dig', id === 'bubbles' ? `New Bubble Party record: ${this.score} pops!` : `Found ${this.score} treasures in Treasure Sniff!`);
    if (id === 'bubbles' && this.score >= 30) g.achieve('bubble30', 'Bubble Champion');
    g.ui.miniResult(id, this.score, reward, newBest, this.petScore);
    g.pet.run((function* (): Gen { g.pet.lookCam = 1; g.pet.expr = 'starry'; g.pet.jump(280); yield* wait(g.pet, 1.5); })(), 'mini', 1);
  }

  update(dt: number) {
    const g = this.g;
    if (!this.id || g.mode !== 'minigame') return;
    this.t += dt;
    if (this.t >= this.dur) { this.end(); return; }
    if (this.id === 'bubbles') {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = rand(0.35, 0.7);
        const halfW = g.W / 2 / g.S;
        const x = clamp(g.cam.x + rand(-halfW * 0.8, halfW * 0.8), g.cam.x - halfW + 40, g.cam.x + halfW - 40);
        g.toys.addBubble(x, 700, rand(-20, 20), rand(-90, -60), chance(0.08));
      }
      if (g.pet.actionName !== 'toy') g.pet.run(g.toys.playLoop(), 'toy', 2);
    }
    if (this.id === 'sniff' && !g.pet.action) g.pet.run((function* (): Gen { g.pet.lookCam = 1; g.pet.body = 'sit'; g.pet.expr = 'excited'; g.pet.o.tailWag = 1; while (true) yield; })(), 'mini', 1);
    if (this.marker) { this.marker.t -= dt; if (this.marker.t <= 0) this.marker = null; }
  }

  onDown(wx: number, wy: number): boolean {
    const g = this.g;
    if (this.id === 'bubbles') return g.toys.onDown(wx, wy, 99);
    if (this.id === 'sniff') {
      if (this.busy || wy < FLOOR_TOP) return true;
      const b = g.world.zoneBounds('garden');
      const x = clamp(wx, b.x0, b.x1), y = clamp(wy, b.y0, b.y1);
      this.marker = { x, y, t: 3 };
      this.busy = true;
      g.pet.run(this.sniffAt(x, y), 'mini', 2);
      return true;
    }
    return false;
  }
  onMove(wx: number, wy: number) { if (this.id === 'bubbles') this.g.toys.onMove(wx, wy, 99); }

  private *sniffAt(x: number, y: number): Gen {
    const g = this.g, pet = g.pet;
    pet.o = {}; pet.expr = 'focus';
    yield* walk(pet, x, y, 260, 4);
    pet.o.headDown = 0.9; pet.o.sniff = 1;
    g.audio.sniff();
    yield* wait(pet, 0.7);
    pet.o = {};
    let best = this.hidden.find((h) => !h.found)!;
    let bd = 1e9;
    for (const h of this.hidden) if (!h.found) { const d = dist(x, y, h.x, h.y); if (d < bd) { bd = d; best = h; } }
    if (!best) { this.busy = false; return; }
    if (bd < 85) {
      best.found = true;
      this.score++;
      const spot = { x: best.x, y: best.y, ready: true, t: 0 };
      g.world.digs.push(spot);
      yield* digAt(g.brain, best.x, best.y, true);
      if (this.hidden.every((h) => h.found)) { this.t = this.dur; }
    } else if (bd < 220) {
      pet.faceToward(best.x); pet.body = 'bow'; pet.expr = 'excited'; pet.emote('!'); pet.o.tailWag = 1.3;
      g.audio.voice('excited');
      pet.lookAt = { x: best.x, y: best.y };
      yield* wait(pet, 1.2);
      g.ui.miniHint('So close! 🔥');
    } else if (bd < 420) {
      pet.faceToward(best.x); pet.expr = 'happy'; pet.o.tailWag = 0.8; pet.emote('note');
      pet.lookAt = { x: best.x, y: best.y };
      yield* wait(pet, 1);
      g.ui.miniHint('Getting warmer…');
    } else {
      pet.expr = 'curious'; pet.emote('?'); pet.o.headTilt = 0.4;
      if (chance(0.3)) { g.audio.sneeze(); pet.squash(0.4); }
      yield* wait(pet, 1);
      g.ui.miniHint('Brrr, cold!');
    }
    pet.o = {}; pet.body = 'stand';
    this.busy = false;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.marker) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.marker.t);
      ctx.translate(this.marker.x, this.marker.y - 10);
      drawIcon(ctx, 'paw', 30);
      ctx.restore();
    }
  }
}
