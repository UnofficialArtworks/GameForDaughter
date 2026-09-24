// Pointer / touch handling: stroke-detected petting, pick-up & carry, taps on the pet and world.
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait } from './pet/brain';
import { petSpot, addJournal } from './memory';
import { drawIcon } from './art';
import { chance, clamp, clamp01, dist, rand } from './util';

interface Touch { id: number; zone: string | null; t0: number; sx: number; sy: number; wx: number; wy: number; moved: number; mode: 'pending' | 'stroke' | 'carry' | 'none'; floorY: number; }

export class Interaction {
  touch: Touch | null = null;
  // petting state (read by the petting action)
  strokeRate = 0; // smoothed local-units/sec
  lastStroke = -10;
  strokeZone: string | null = null;
  private chunk: Record<string, number> = {};
  private handX = 0; handY = 0; handA = 0;
  private lastGiggle = 0;
  private lastVoice = 0;

  constructor(public g: Game) {
    const c = g.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent) {
    const g = this.g;
    g.audio.unlock();
    if (g.mode === 'title' || g.mode === 'adopt' && g.ui.adoptStep !== 'look' && g.ui.adoptStep !== 'meet') return;
    const [wx, wy] = g.toWorld(e.clientX, e.clientY);
    this.setPointer(e, wx, wy);
    try { g.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (g.mode === 'adopt') { g.ui.adoptTap(wx, wy); return; }
    if (g.mode === 'minigame' && g.mini.onDown(wx, wy)) return;
    if (g.mode === 'closeup' && g.closeup.onDown(wx, wy, e.pointerId)) return;
    const zone = g.pet.hitZone(wx, wy, g.mode === 'closeup' ? 1.05 : 1.15);
    if (zone && g.toys.active && g.toys.thr?.carried) { g.toys.petTaps++; return; }
    if (!zone && g.toys.onDown(wx, wy, e.pointerId)) return;
    if (zone) {
      this.touch = { id: e.pointerId, zone, t0: g.time, sx: e.clientX, sy: e.clientY, wx, wy, moved: 0, mode: 'pending', floorY: g.pet.y };
      return;
    }
    if (g.toys.onDown(wx, wy, e.pointerId)) return;
    if (g.mode === 'free') this.tapWorld(wx, wy);
  }

  private setPointer(e: PointerEvent, wx: number, wy: number) {
    const p = this.g.pointer;
    p.sx = e.clientX; p.sy = e.clientY; p.wx = wx; p.wy = wy;
    p.recent = true; p.lastMove = this.g.time;
  }

  private move(e: PointerEvent) {
    const g = this.g;
    if (g.mode === 'title') return;
    const [wx, wy] = g.toWorld(e.clientX, e.clientY);
    this.setPointer(e, wx, wy);
    if (g.mode === 'closeup') g.closeup.onMove(wx, wy, e.pointerId);
    g.toys.onMove(wx, wy, e.pointerId);
    if (g.mode === 'minigame') g.mini.onMove(wx, wy);
    const t = this.touch;
    if (!t || t.id !== e.pointerId) return;
    const dsx = e.clientX - t.sx, dsy = e.clientY - t.sy;
    const d = Math.hypot(dsx, dsy);
    t.moved += d; t.sx = e.clientX; t.sy = e.clientY;
    const dw = dist(t.wx, t.wy, wx, wy);
    t.wx = wx; t.wy = wy;
    if (t.mode === 'pending' && t.moved > 9) t.mode = 'stroke';
    if (t.mode === 'stroke') this.strokeAt(wx, wy, dw);
    if (t.mode === 'carry') this.carryTo(wx, wy);
  }

  private up(e: PointerEvent) {
    const g = this.g;
    if (g.mode === 'closeup') g.closeup.onUp(e.pointerId);
    g.toys.onUp(e.pointerId);
    const t = this.touch;
    if (!t || t.id !== e.pointerId) return;
    this.touch = null;
    if (t.mode === 'pending') {
      if (g.time - t.t0 < 0.45) this.tapPet(t.zone ?? 'back', t.wx, t.wy);
      else this.strokeAt(t.wx, t.wy, 60); // a gentle held touch counts as a pat
    } else if (t.mode === 'carry') this.drop();
  }

  update(dt: number) {
    const g = this.g;
    this.strokeRate *= Math.exp(-dt * 3);
    const t = this.touch;
    if (t && t.mode === 'pending' && g.time - t.t0 > 0.45 && t.moved < 9) {
      if (g.mode === 'free' && !g.toys.active) this.startCarry();
      else { t.mode = 'stroke'; }
    }
    if (t && t.mode === 'stroke' && g.time - this.lastStroke > 0.25) {
      // finger resting on the pet still counts, gently
      this.strokeAt(t.wx, t.wy, 25 * dt * 10);
    }
  }

  // ---------- petting ----------
  strokeAt(wx: number, wy: number, dWorld: number) {
    const g = this.g, pet = g.pet;
    const zoneRaw = pet.hitZone(wx, wy, 1.25);
    if (!zoneRaw) return;
    let zone = zoneRaw === 'nose' ? 'cheeks' : zoneRaw === 'tail' ? 'back' : zoneRaw;
    const local = dWorld / pet.depth;
    this.strokeRate = this.strokeRate * 0.8 + (local / Math.max(0.016, g.time - this.lastStroke)) * 0.2;
    this.lastStroke = g.time;
    this.strokeZone = zone;
    this.handX = wx; this.handY = wy; this.handA = 1;
    if (g.pet.actionName !== 'petting' && !g.pet.carried) {
      if (g.pet.busy(3) && g.pet.actionName !== 'greet') return;
      g.pet.run(this.pettingLoop(), 'petting', 3);
    }
    // accumulate memory in chunks
    this.chunk[zone] = (this.chunk[zone] ?? 0) + local;
    if (this.chunk[zone] > 190) {
      this.chunk[zone] = 0;
      const s = g.save;
      const r = petSpot(s.memory, s.pet.hidden, zone, 1);
      s.pet.needs.affection = clamp01(s.pet.needs.affection + 0.035 * r.intensity);
      g.bump('pets');
      g.addFriend('pet', 1.2 * r.intensity);
      g.brain.noteInteraction(0.03);
      if (zone === 'belly') g.brain.fulfil('belly');
      else g.brain.fulfil('heart');
      if (r.newFavorite) g.discoverSpot(zone);
      if (!s.flags.firstPet) { s.flags.firstPet = true; addJournal(s.memory, 'heart', `First cuddles with ${s.pet.name}.`); }
      if (chance(0.5)) g.fx.hearts(...pet.headPos());
    }
  }

  private *pettingLoop(): Gen {
    const g = this.g, pet = g.pet;
    const s = g.save;
    pet.moving = false;
    const close = g.mode === 'closeup';
    const lying = pet.body === 'lie' || pet.body === 'belly';
    if (!lying && !close) pet.body = 'sit';
    let level = 0, t = 0;
    let offeredBelly = false;
    while (g.time - this.lastStroke < 1.4) {
      t += pet.dt;
      const zone = this.strokeZone ?? 'head';
      const liking = (s.memory.spots[zone]?.liking ?? 0.3);
      const truth = s.pet.hidden.spot[zone] ?? 0.3;
      const fav = s.memory.favSpot === zone || truth > 0.9;
      const rate = this.strokeRate;
      const stroking = g.time - this.lastStroke < 0.3;
      const tickle = rate > 2200;
      const target = stroking ? clamp01(0.35 + liking * 0.5 + (s.pet.traits.cuddly - 0.5) * 0.3) * (tickle ? 0.6 : 1) : level * 0.97;
      level += (target - level) * Math.min(1, pet.dt * 2.2);
      const [hx] = pet.headPos();
      // lean into the hand
      pet.o.tilt = clamp((this.handX - hx) * 0.0015 * pet.facing, -0.12, 0.12) * level;
      pet.o.headTilt = clamp((this.handX - hx) * 0.004 * pet.facing, -0.35, 0.35) * level;
      pet.lookCam = close ? 1 : 0.7;
      if (close && !lying) pet.o.front = 1;
      if (tickle && stroking) {
        pet.expr = 'joy';
        pet.o.tilt = Math.sin(t * 30) * 0.08;
        if (g.time - this.lastGiggle > 0.9) { this.lastGiggle = g.time; g.audio.voice('giggle'); }
        pet.o.eyeOpen = undefined;
      } else if (level > 0.55) {
        pet.expr = 'bliss';
      } else if (level > 0.25) {
        pet.expr = 'love';
      } else {
        pet.expr = 'happy';
      }
      pet.o.earPerk = zone === 'head' || zone === 'ears' ? -0.8 * level : undefined;
      pet.o.tailWag = 0.4 + level * 0.8;
      pet.o.kick = fav && level > 0.6 && (zone === 'back' || zone === 'belly' || zone === 'ears') && stroking ? 1 : 0;
      g.brain.purr = Math.max(g.brain.purr, level * (0.6 + truth * 0.6));
      if (stroking && g.time - this.lastVoice > 3.5 && chance(pet.dt * 2)) { this.lastVoice = g.time; g.audio.voice('coo'); }
      // a very happy pet may roll over to offer its belly
      if (!offeredBelly && level > 0.6 && t > 3 && (s.pet.hidden.spot.belly > 0.6 || g.friendLevel >= 3) && chance(pet.dt * 0.4)) {
        offeredBelly = true;
        pet.body = 'belly'; pet.o.front = 0;
        g.observe('bellyup');
      }
      yield;
    }
    pet.o = {};
    pet.expr = 'love';
    pet.lookCam = 1;
    if (level > 0.5) { g.fx.hearts(...pet.headPos()); }
    yield* wait(pet, 1.2);
    if (pet.body === 'belly') { pet.body = 'lie'; yield* wait(pet, 0.5); }
  }

  // ---------- taps ----------
  private tapPet(zone: string, wx: number, wy: number) {
    const g = this.g, pet = g.pet;
    g.brain.noteInteraction(0.08);
    if (g.mode === 'free' && !g.toys.active && !pet.busy(2)) { g.closeup.open('cuddle'); return; }
    if (g.mode !== 'closeup' && g.toys.active) return;
    if (pet.busy(4)) return;
    const tr = g.save.pet.traits;
    pet.run((function* (): Gen {
      pet.lookCam = 1;
      if (pet.asleep) {
        pet.o.eyeOpen = 0.4; pet.expr = 'sleepy';
        yield* wait(pet, 1); pet.asleep = true; pet.expr = 'asleep'; return;
      }
      switch (zone) {
        case 'nose':
          // boop! cross-eyed look at your finger
          pet.expr = 'surprised'; pet.o.lookX = 0; pet.squash(0.3); g.audio.voice('surprise');
          pet.lookAt = { x: pet.headPos()[0] + 10 * pet.facing, y: pet.headPos()[1] + 10 };
          yield* wait(pet, 0.5);
          if (chance(0.3)) { const b = yield* sneezeInline(); void b; }
          else { pet.expr = 'joy'; g.audio.voice('giggle'); yield* wait(pet, 0.8); }
          g.observe('boop');
          break;
        case 'belly':
          pet.expr = 'joy'; g.audio.voice('giggle'); pet.squash(0.3);
          for (let i = 0; i < 5; i++) { pet.o.tilt = i % 2 ? 0.1 : -0.1; yield* wait(pet, 0.08); }
          break;
        case 'tail':
          pet.expr = 'surprised'; pet.face(-pet.facing); pet.emote('!');
          yield* wait(pet, 0.5);
          pet.expr = 'mischief';
          for (let i = 0; i < 4; i++) { pet.face(-pet.facing); yield* wait(pet, 0.17); }
          pet.expr = 'happy'; pet.lookCam = 1;
          break;
        case 'ears':
          pet.o.earPerk = 1; pet.expr = 'surprised'; yield* wait(pet, 0.15);
          pet.o.earPerk = -0.5; pet.expr = 'happy'; g.audio.voice('coo'); yield* wait(pet, 0.6);
          break;
        default:
          pet.squash(0.25); pet.expr = tr.playful > 0.6 ? 'joy' : 'happy';
          g.audio.voice(chance(0.5) ? 'happy' : 'question');
          pet.o.headTilt = rand(-0.3, 0.3);
          yield* wait(pet, 0.7);
      }
      pet.o = {};
      pet.expr = 'happy';
      yield* wait(pet, 0.6);
    })(), 'tap', 2);
    function* sneezeInline(): Gen {
      pet.o.eyeOpen = 0.2; pet.o.headTilt = -0.2; yield* wait(pet, 0.4);
      g.audio.sneeze(); yield* wait(pet, 0.35);
      pet.squash(0.5); pet.o.eyeOpen = 0; pet.o.mouthOpen = 0.6; g.fx.drops(...pet.mouthPos(), 4, 80);
      yield* wait(pet, 0.3); pet.o = {}; pet.expr = 'happy'; pet.o.blush = 1;
      yield* wait(pet, 0.5);
    }
  }

  private tapWorld(wx: number, wy: number) {
    const g = this.g, w = g.world;
    const near = (poi: string, r: number) => { const [x, y] = w.poi(poi); return Math.hypot(x - wx, (y - 20) - wy) < r; };
    if (g.zone === 'room') {
      if (near('bowlWater', 60)) { g.closeup.refillWater(); return; }
      if (near('bowlFood', 60)) { g.closeup.fillBowl(); return; }
      if (Math.abs(wx - 985) < 40 && wy > 170 && wy < 460) { g.goZone('garden'); return; }
      if (near('basket', 70)) { g.ui.openTray('play'); return; }
      if (wy < 430) { g.pet.lookAt = { x: wx, y: wy }; g.pet.emote('?', 1); g.brain.noteInteraction(0.02); return; }
    } else {
      if (wx < 1030 && wy < 460) { g.goZone('room'); return; }
    }
    if (wy >= 430) g.callPet(wx, wy);
  }

  // ---------- carrying ----------
  private startCarry() {
    const g = this.g, pet = g.pet, t = this.touch!;
    t.mode = 'carry';
    pet.run((function* (): Gen {
      const brave = g.save.pet.traits.brave;
      pet.carried = true; pet.body = 'stand'; pet.lookCam = 1; pet.o.front = 0.8;
      pet.expr = 'surprised'; g.audio.voice('surprise');
      yield* wait(pet, brave > 0.5 ? 0.3 : 0.8);
      pet.expr = brave > 0.4 ? 'joy' : 'happy';
      if (brave > 0.4) g.audio.voice('giggle');
      g.observe('carried');
      while (pet.carried) { pet.o.tilt = Math.sin(g.time * 3) * 0.05; yield; }
    })(), 'carried', 4);
    t.floorY = pet.y;
  }

  private carryTo(wx: number, wy: number) {
    const g = this.g, pet = g.pet;
    const b = g.world.zoneBounds(g.zone);
    pet.x = clamp(wx, b.x0, b.x1);
    pet.y = clamp(wy + 60, b.y0, b.y1);
    pet.z = clamp(pet.y - wy - 20, 0, 600);
    pet.vz = 0;
  }

  private drop() {
    const g = this.g, pet = g.pet;
    pet.carried = false;
    pet.run((function* (): Gen {
      pet.o = {};
      pet.expr = 'surprised';
      while (pet.z > 0) yield;
      pet.expr = 'happy'; g.audio.thud();
      yield* wait(pet, 0.3);
      pet.o.shake = 0.7; yield* wait(pet, 0.35); pet.o.shake = 0;
      pet.lookCam = 1; pet.expr = 'joy'; g.audio.voice('happy');
      g.addFriend('carry', 1);
      yield* wait(pet, 0.8);
    })(), 'dropped', 3);
  }

  // ---------- draw ----------
  draw(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    this.handA = Math.max(0, this.handA - 0.03);
    if (g.time - this.lastStroke < 0.4 && g.mode !== 'closeup' || (g.mode === 'closeup' && g.closeup.sub === 'cuddle' && g.time - this.lastStroke < 0.4)) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(this.handX + 6, this.handY + 10);
      ctx.rotate(-0.2 + Math.sin(g.time * 8) * 0.08);
      drawIcon(ctx, 'hand', 52 / g.cam.zoom * 1.4);
      ctx.restore();
    }
  }
}
